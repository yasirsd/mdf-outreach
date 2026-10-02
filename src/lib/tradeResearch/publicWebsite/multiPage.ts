/**
 * TH04C Step 0B — bounded multi-page helpers.
 *
 * Pure functions. Given raw homepage HTML, pick at most TWO
 * same-origin subpages worth fetching next:
 *
 *   - one `contact/about` candidate,
 *   - one `product/import/distribution` candidate.
 *
 * Prefers REAL discovered same-site links (English + Thai) over
 * guessed path hints. Prefers `/en/` localised versions where
 * discoverable. Does NOT recurse, does NOT leave same origin, does
 * NOT request every hint. The executor fetches at most 3 content
 * pages total (homepage + the two picks) and merges extracted
 * signals with per-page provenance.
 */

import type { PublicWebsiteSignals } from "./extractors";

export type SubpageCategory = "contact" | "product";

const HREF_PATTERN = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))[^>]*>([\s\S]*?)<\/a>/gi;

const CONTACT_PATH_TOKENS = ["contact", "contact-us", "contact_us", "about", "about-us"] as const;
const PRODUCT_PATH_TOKENS = ["products", "product", "import", "imports", "distribution"] as const;

const THAI_CONTACT_TOKENS = ["ติดต่อ", "ติดต่อเรา", "เกี่ยวกับเรา"] as const;
const THAI_PRODUCT_TOKENS = ["สินค้า", "ผลิตภัณฑ์"] as const;

const CONTACT_ANCHOR_TEXT = ["contact", "contact us", "about", "about us", ...THAI_CONTACT_TOKENS] as const;
const PRODUCT_ANCHOR_TEXT = [
  "product", "products", "import", "imports", "distribution", "importer",
  ...THAI_PRODUCT_TOKENS,
] as const;

interface Candidate {
  readonly url: string;
  readonly category: SubpageCategory;
  /** Lower score = more preferred. Primary: whether the match came from a real link vs a path hint. Secondary: `/en/` preference. Tertiary: insertion order. */
  readonly score: number;
}

function sanitizeAnchorText(raw: string): string {
  return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function hostSuffixMatches(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/^www\./, "");
  const nb = b.toLowerCase().replace(/^www\./, "");
  if (na === nb) return true;
  // Allow one-level subdomain difference under the same registrable domain,
  // best-effort: only when both share the last two labels.
  const la = na.split(".");
  const lb = nb.split(".");
  if (la.length < 2 || lb.length < 2) return false;
  return la.slice(-2).join(".") === lb.slice(-2).join(".");
}

function hasToken(path: string, tokens: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return tokens.some((t) => lower.includes(`/${t.toLowerCase()}`) || lower.endsWith(`/${t.toLowerCase()}`));
}

function hasThai(path: string, tokens: readonly string[]): boolean {
  for (const t of tokens) if (path.includes(t)) return true;
  return false;
}

function isPreferredLanguagePath(path: string): boolean {
  return /\/en(\/|$)/i.test(path);
}

/**
 * Discover same-origin contact and product subpages from homepage
 * HTML. Returns up to one per category, preferring:
 *   1. real anchor whose href has the token
 *   2. real anchor whose visible text has the token (English or Thai)
 *   3. `/en/` localised variants of the above
 * Deterministic: within a tier the first discovered anchor wins.
 */
export function selectSameOriginSubpages(input: {
  homepageHtml: string;
  homepageUrl: string;
}): { contact?: string; product?: string } {
  const picks = new Map<SubpageCategory, Candidate>();
  const homepage = (() => { try { return new URL(input.homepageUrl); } catch { return null; } })();
  if (!homepage) return {};

  let order = 0;
  for (const m of input.homepageHtml.matchAll(HREF_PATTERN)) {
    const hrefRaw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!hrefRaw || hrefRaw.startsWith("mailto:") || hrefRaw.startsWith("tel:") || hrefRaw.startsWith("javascript:")) continue;
    let next: URL;
    try { next = new URL(hrefRaw, homepage); } catch { continue; }
    if (next.protocol !== "http:" && next.protocol !== "https:") continue;
    if (!hostSuffixMatches(next.hostname, homepage.hostname)) continue;
    const path = (next.pathname || "/").split("#")[0] ?? "/";
    const absolute = `${next.origin}${path}`;
    const text = sanitizeAnchorText(m[4] ?? "");
    const lowerText = text.toLowerCase();

    const pathHitContact = hasToken(path, CONTACT_PATH_TOKENS) || hasThai(path, THAI_CONTACT_TOKENS);
    const textHitContact = CONTACT_ANCHOR_TEXT.some((t) => lowerText === t || lowerText.startsWith(t) || text.includes(t));
    const pathHitProduct = hasToken(path, PRODUCT_PATH_TOKENS) || hasThai(path, THAI_PRODUCT_TOKENS);
    const textHitProduct = PRODUCT_ANCHOR_TEXT.some((t) => lowerText === t || lowerText.startsWith(t) || text.includes(t));

    const preferred = isPreferredLanguagePath(path) ? -0.5 : 0;
    const insertion = (order += 1) * 0.0001;

    if (pathHitContact || textHitContact) {
      const score = (pathHitContact ? 0 : 1) + preferred + insertion;
      const current = picks.get("contact");
      if (!current || score < current.score) picks.set("contact", { url: absolute, category: "contact", score });
    }
    if (pathHitProduct || textHitProduct) {
      const score = (pathHitProduct ? 0 : 1) + preferred + insertion;
      const current = picks.get("product");
      if (!current || score < current.score) picks.set("product", { url: absolute, category: "product", score });
    }
  }
  return {
    contact: picks.get("contact")?.url,
    product: picks.get("product")?.url,
  };
}

export interface MergedPublicWebsiteSignals {
  readonly homepageUrl: string;
  readonly pagesEvaluated: readonly { url: string; category: "homepage" | SubpageCategory }[];
  readonly productSignals: readonly { term: string; sourceUrl: string }[];
  readonly roleSignals: readonly { term: string; sourceUrl: string }[];
  readonly contactSignals: readonly { term: string; sourceUrl: string }[];
  readonly observedPublicEmails: readonly { email: string; sourceUrl: string }[];
  readonly observedPublicPhones: readonly { e164: string; sourceUrl: string }[];
  readonly observedThaiLegalNameSnapshot: string | null;
  readonly observedEnglishLegalNameSnapshot: string | null;
  readonly observedJuristicNumberSnapshot: string | null;
  /** Highest match-level across evaluated pages, if any. */
  readonly identityMatchLevel: "exact" | "strong" | "possible" | "no_match" | null;
}

/**
 * Deterministic merge of per-page `PublicWebsiteSignals`.
 * - Keyword hits are deduped by term (first observed sourceUrl wins).
 * - Public contacts (emails, phones) are deduped (first wins).
 * - Legal-name snapshots prefer the longest observed value.
 * - identityMatchLevel is the strongest level seen across pages.
 */
export function mergePublicWebsiteSignals(input: {
  homepageUrl: string;
  perPage: readonly { category: "homepage" | SubpageCategory; signals: PublicWebsiteSignals }[];
}): MergedPublicWebsiteSignals {
  const pages = input.perPage.map((p) => ({ url: p.signals.pageUrl, category: p.category }));
  const dedupe = <T>(acc: Map<string, { term: T; sourceUrl: string }>, term: string, sourceUrl: string, as: T) => {
    if (!acc.has(term)) acc.set(term, { term: as, sourceUrl });
  };

  const productMap = new Map<string, { term: string; sourceUrl: string }>();
  const roleMap = new Map<string, { term: string; sourceUrl: string }>();
  const contactMap = new Map<string, { term: string; sourceUrl: string }>();
  const emailMap = new Map<string, { email: string; sourceUrl: string }>();
  const phoneMap = new Map<string, { e164: string; sourceUrl: string }>();

  let thaiLegalName: string | null = null;
  let englishLegalName: string | null = null;
  let juristicNumber: string | null = null;
  let bestLevel: MergedPublicWebsiteSignals["identityMatchLevel"] = null;
  const levelOrder: Record<string, number> = { no_match: 0, possible: 1, strong: 2, exact: 3 };

  for (const { signals } of input.perPage) {
    for (const t of signals.productSignals) dedupe(productMap, t, signals.pageUrl, t);
    for (const t of signals.roleSignals) dedupe(roleMap, t, signals.pageUrl, t);
    for (const t of signals.contactSignals) dedupe(contactMap, t, signals.pageUrl, t);
    for (const e of signals.observedPublicEmails) if (!emailMap.has(e)) emailMap.set(e, { email: e, sourceUrl: signals.pageUrl });
    for (const p of signals.observedPublicPhones) if (!phoneMap.has(p)) phoneMap.set(p, { e164: p, sourceUrl: signals.pageUrl });
    if (signals.observedThaiLegalNameSnapshot && (!thaiLegalName || signals.observedThaiLegalNameSnapshot.length > thaiLegalName.length)) {
      thaiLegalName = signals.observedThaiLegalNameSnapshot;
    }
    if (signals.observedEnglishLegalNameSnapshot && (!englishLegalName || signals.observedEnglishLegalNameSnapshot.length > englishLegalName.length)) {
      englishLegalName = signals.observedEnglishLegalNameSnapshot;
    }
    if (signals.observedJuristicNumberSnapshot && !juristicNumber) juristicNumber = signals.observedJuristicNumberSnapshot;
    if (signals.identityComparison) {
      const lvl = signals.identityComparison.matchLevel;
      if (bestLevel === null || levelOrder[lvl]! > levelOrder[bestLevel]!) bestLevel = lvl;
    }
  }

  return {
    homepageUrl: input.homepageUrl,
    pagesEvaluated: pages,
    productSignals: [...productMap.values()],
    roleSignals: [...roleMap.values()],
    contactSignals: [...contactMap.values()],
    observedPublicEmails: [...emailMap.values()],
    observedPublicPhones: [...phoneMap.values()],
    observedThaiLegalNameSnapshot: thaiLegalName,
    observedEnglishLegalNameSnapshot: englishLegalName,
    observedJuristicNumberSnapshot: juristicNumber,
    identityMatchLevel: bestLevel,
  };
}
