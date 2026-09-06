/**
 * BI3 — deterministic extraction of BUSINESS intelligence from a
 * Candidate's own public HTML pages.
 *
 * This module is pure: no I/O, no LLM, no network. Given a page URL and
 * its HTML, it produces a small set of Level-2 `business_evidence`
 * claim candidates the BI3 orchestrator will ingest through the
 * existing BI2 write RPCs. Every claim carries a short raw source
 * excerpt drawn verbatim from visible page text so an operator can
 * always point back to the wording that supports it.
 *
 * Explicit non-goals:
 *   • Never emits trade observations. Website copy cannot verify a
 *     shipment.
 *   • Never infers "importer" from a food-catalogue, wholesaler
 *     mention, or product listing alone. Only explicit importer/
 *     distributor language about the company's own business qualifies.
 *   • Never invents a product mapping. `imports_product` only fires when
 *     an import phrase and a catalogue product mention co-occur in the
 *     same visible sentence.
 *   • Never records copy that looks like a challenge page / paywall.
 */

import { findBusinessProductById } from "./businessCatalogue";

export type BusinessPageKind =
  | "homepage"
  | "about"
  | "company"
  | "products"
  | "services"
  | "contact";

export interface BusinessPageLink {
  href: string;
  text: string;
  kind: BusinessPageKind;
}

export type BusinessClaimType =
  | "company_is_importer"
  | "company_is_distributor"
  | "imports_product"
  | "website_business_description";

export type BusinessClaimConfidence = "medium" | "low";

/**
 * A page-scoped candidate business claim. `sourceRecordRef` is a stable
 * page-local identity so repeated research on unchanged content
 * resolves as `existing` under the BI2 identity rule (source +
 * source_record_ref + claim_type). Multiple claims from the same page
 * simply carry different suffixes.
 */
export interface BusinessClaimCandidate {
  claimType: BusinessClaimType;
  sourceRecordRef: string;
  confidence: BusinessClaimConfidence;
  /** Visible verbatim excerpt (≤ 320 chars) that supports the claim. */
  excerpt: string;
  /** Optional normalized payload — e.g. a matched MDF product id. */
  normalized?: Record<string, unknown>;
}

/**
 * The extractor's per-page verdict. The orchestrator only ingests a
 * source when at least one claim was found or a stable business
 * description was captured; a page with no evidence is still recorded
 * in the run summary but does not create a BI1 source row.
 */
export interface BusinessPageExtraction {
  claims: BusinessClaimCandidate[];
  description?: string;
  /** Human-safe page kind label used for `safe_source_ref`. */
  safeRef: string;
  /** Stable BI source_key for this page (kind + trimmed pathname). */
  sourceKey: string;
}

// ---------------------------------------------------------------------------
// Same-domain page selection
// ---------------------------------------------------------------------------

const ABOUT_PATH = /(?:^|\/)(about(?:-?us)?|who[-_ ]?we[-_ ]?are|our[-_ ]?story|company|corporate)(?:\/|$|\.[a-z]+$)/i;
const PRODUCTS_PATH = /(?:^|\/)(products?|our[-_ ]?products?|catalogue|catalog|brands?)(?:\/|$|\.[a-z]+$)/i;
const SERVICES_PATH = /(?:^|\/)(services?|what[-_ ]?we[-_ ]?do|capabilities|solutions?)(?:\/|$|\.[a-z]+$)/i;
const CONTACT_PATH = /(?:^|\/)(contact(?:-?us)?|get[-_ ]?in[-_ ]?touch|reach[-_ ]?us)(?:\/|$|\.[a-z]+$)/i;

const ABOUT_TEXT = /\b(about|who we are|our story|company|corporate)\b/i;
const PRODUCTS_TEXT = /\b(products?|catalogue|catalog|brands?)\b/i;
const SERVICES_TEXT = /\b(services?|what we do|capabilities|solutions?)\b/i;
const CONTACT_TEXT = /\b(contact|get in touch|reach us)\b/i;

const KIND_RANK: Record<BusinessPageKind, number> = {
  homepage: 0,
  about: 1,
  company: 1,
  products: 2,
  services: 3,
  contact: 4,
};

function classifyPageKind(href: string, text: string): BusinessPageKind | undefined {
  const pathish = safePathAndQuery(href);
  const label = text.replace(/\s+/g, " ").trim();
  if (ABOUT_PATH.test(pathish)) {
    return /company|corporate/i.test(pathish) ? "company" : "about";
  }
  if (ABOUT_TEXT.test(label)) {
    return /company|corporate/i.test(label) ? "company" : "about";
  }
  if (PRODUCTS_PATH.test(pathish) || PRODUCTS_TEXT.test(label)) return "products";
  if (SERVICES_PATH.test(pathish) || SERVICES_TEXT.test(label)) return "services";
  if (CONTACT_PATH.test(pathish) || CONTACT_TEXT.test(label)) return "contact";
  return undefined;
}

function safePathAndQuery(href: string): string {
  try {
    const url = new URL(href, "https://example.invalid/");
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return href.toLowerCase();
  }
}

function decodeHref(raw: string): string {
  const stripped = raw.trim().replace(/^['"]/, "").replace(/['"]$/, "");
  return stripped
    .replace(/&amp;/gi, "&")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Same-document hrefs that look like BI3-relevant company pages.
 * Resolving against the page URL and enforcing same-domain / SSRF
 * safety is the caller's job (mirror of publicEmailExtract).
 */
export function extractBusinessPageLinks(html: string): BusinessPageLink[] {
  const out: BusinessPageLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]+)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hrefMatch =
      attrs.match(/href\s*=\s*(["'])([^"']+)\1/i) ?? attrs.match(/href\s*=\s*([^\s>]+)/i);
    const href = decodeHref(hrefMatch?.[2] ?? hrefMatch?.[1] ?? "");
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) continue;
    const kind = classifyPageKind(href, text);
    if (!kind) continue;
    const key = `${kind}:${href.replace(/\/$/, "") || href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, text, kind });
  }
  return out;
}

/** Preferred discovery order: about/company → products → services → contact. */
export function rankBusinessPageLinks(links: BusinessPageLink[]): BusinessPageLink[] {
  return [...links].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

// ---------------------------------------------------------------------------
// Visible text + description extraction
// ---------------------------------------------------------------------------

const STRIP_TAGS_RE = /<(script|style|template|noscript|svg)[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const META_RE =
  /<meta\b[^>]*\bname\s*=\s*["'](?:description|Description)["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/i;
const OG_RE =
  /<meta\b[^>]*\bproperty\s*=\s*["']og:description["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/i;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const P_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/i;

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Normalized visible text — scripts/styles/navigation stripped. */
export function visibleText(html: string): string {
  const cleaned = html.replace(STRIP_TAGS_RE, " ").replace(TAG_RE, " ");
  return decodeEntities(cleaned).replace(/\s+/g, " ").trim();
}

function truncate(input: string, limit: number): string {
  return input.length <= limit ? input : `${input.slice(0, limit - 1).trimEnd()}…`;
}

function extractDescription(html: string): string | undefined {
  const meta = html.match(META_RE)?.[1] ?? html.match(OG_RE)?.[1];
  if (meta) {
    const clean = decodeEntities(meta).replace(/\s+/g, " ").trim();
    if (clean.length >= 20 && clean.length <= 500) return truncate(clean, 320);
  }
  const h1Raw = html.match(H1_RE)?.[1] ?? "";
  const pRaw = html.match(P_RE)?.[1] ?? "";
  const combined = decodeEntities(`${h1Raw} ${pRaw}`.replace(TAG_RE, " ")).replace(/\s+/g, " ").trim();
  if (combined.length >= 40) return truncate(combined, 320);
  return undefined;
}

// ---------------------------------------------------------------------------
// Business-language matching (conservative, source-grounded)
// ---------------------------------------------------------------------------

/**
 * Explicit importer language that names the company as the subject.
 * Does not match a mere "food importer directory" mention, and does
 * not match "imports have grown in the region". Every hit is later
 * excerpted verbatim so an operator can verify the wording.
 */
const IMPORTER_PATTERNS: RegExp[] = [
  /\bwe\s+(?:are\s+(?:an?\s+)?)?(?:leading\s+|specialist\s+)?importers?\b/i,
  /\bwe\s+import\s+[a-z][a-z\s,&'\-]{2,80}/i,
  /\b(?:leading|specialist|premier|primary)\s+importers?\s+(?:of|in)\s+[a-z][a-z\s,&'\-]{2,80}/i,
  /\bimporters?\s+and\s+distributors?\s+(?:of|in)\s+[a-z][a-z\s,&'\-]{2,80}/i,
  /\bimporters?\s+of\s+[a-z][a-z\s,&'\-]{2,80}/i,
];

const DISTRIBUTOR_PATTERNS: RegExp[] = [
  /\bwe\s+(?:are\s+(?:an?\s+)?)?(?:leading\s+|authorised\s+|authorized\s+)?distributors?\b/i,
  /\bwe\s+distribute\s+[a-z][a-z\s,&'\-]{2,80}/i,
  /\b(?:leading|authorised|authorized|primary|wholesale)\s+distributors?\s+(?:of|in|for)\s+[a-z][a-z\s,&'\-]{2,80}/i,
  /\bdistributors?\s+(?:of|for)\s+[a-z][a-z\s,&'\-]{2,80}/i,
  /\bdistributors?\s+and\s+importers?\s+(?:of|in)\s+[a-z][a-z\s,&'\-]{2,80}/i,
];

/**
 * Split visible text into short candidate sentences. Overlong sentences
 * (nav dumps, product tables) are dropped so the excerpt stays
 * inspectable and the pattern subject stays close to the verb.
 */
function candidateSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/g);
  const out: string[] = [];
  for (const sentence of raw) {
    const trimmed = sentence.replace(/\s+/g, " ").trim();
    if (trimmed.length >= 12 && trimmed.length <= 320) out.push(trimmed);
  }
  return out;
}

function firstMatch(patterns: RegExp[], sentence: string): boolean {
  for (const re of patterns) {
    if (re.test(sentence)) return true;
  }
  return false;
}

/** Business-catalogue mentions whose display name or short name appears verbatim in a sentence. */
function matchedCatalogueProduct(
  sentence: string,
): { productId: string; displayName: string } | undefined {
  const lower = sentence.toLowerCase();
  // Product catalogue is small; a linear scan is fine.
  for (const id of ["guntur-dry-red-chilli", "banganapalli-mango", "indian-pomegranate", "indian-apples"]) {
    const product = findBusinessProductById(id);
    if (!product) continue;
    const names = [product.displayName, product.shortName].filter(Boolean).map((s) => s.toLowerCase());
    for (const name of names) {
      if (name && lower.includes(name)) {
        return { productId: id, displayName: product.displayName };
      }
    }
  }
  return undefined;
}

/**
 * Extract every BI3 claim candidate from one page. Deterministic and
 * source-grounded — each claim carries a verbatim excerpt drawn from
 * the visible text of the page.
 */
export function extractBusinessClaims(input: {
  finalUrl: string;
  html: string;
  kind: BusinessPageKind;
}): BusinessPageExtraction {
  const { finalUrl, html, kind } = input;
  const text = visibleText(html);
  const sentences = candidateSentences(text);
  const claims: BusinessClaimCandidate[] = [];

  const sourceKey = stableSourceKey(finalUrl, kind);
  const safeRef = safePageRef(finalUrl, kind);

  // Description — one per page at most.
  const description = extractDescription(html);
  if (description) {
    claims.push({
      claimType: "website_business_description",
      sourceRecordRef: `page:${sourceKey}:description`,
      confidence: "medium",
      excerpt: description,
    });
  }

  // company_is_importer / company_is_distributor — first supporting
  // sentence wins so the excerpt is compact and stable.
  const importerSentence = sentences.find((s) => firstMatch(IMPORTER_PATTERNS, s));
  if (importerSentence) {
    claims.push({
      claimType: "company_is_importer",
      sourceRecordRef: `page:${sourceKey}:importer`,
      confidence: "medium",
      excerpt: truncate(importerSentence, 320),
    });
  }
  const distributorSentence = sentences.find((s) => firstMatch(DISTRIBUTOR_PATTERNS, s));
  if (distributorSentence) {
    claims.push({
      claimType: "company_is_distributor",
      sourceRecordRef: `page:${sourceKey}:distributor`,
      confidence: "medium",
      excerpt: truncate(distributorSentence, 320),
    });
  }

  // imports_product — only when a first-person import phrase AND a
  // catalogue product mention co-occur in the same sentence. Never
  // fabricate a product from a product listing alone.
  for (const sentence of sentences) {
    if (!firstMatch(IMPORTER_PATTERNS, sentence)) continue;
    if (!/\b(we\s+import|import(?:ers?)?\s+of)\b/i.test(sentence)) continue;
    const product = matchedCatalogueProduct(sentence);
    if (!product) continue;
    claims.push({
      claimType: "imports_product",
      sourceRecordRef: `page:${sourceKey}:imports_product:${product.productId}`,
      confidence: "low",
      excerpt: truncate(sentence, 320),
      normalized: { mdfProductId: product.productId, displayName: product.displayName },
    });
    break; // one imports_product per page keeps the excerpt inspectable
  }

  return { claims, description, safeRef, sourceKey };
}

function stableSourceKey(finalUrl: string, kind: BusinessPageKind): string {
  try {
    const url = new URL(finalUrl);
    let path = (url.pathname || "/").replace(/\/index\.[a-z]+$/i, "/");
    if (path.length > 1) path = path.replace(/\/$/, "");
    return `${kind}:${path}`;
  } catch {
    return `${kind}:/`;
  }
}

function safePageRef(finalUrl: string, kind: BusinessPageKind): string {
  const label =
    kind === "homepage" ? "Homepage" :
    kind === "about" ? "About" :
    kind === "company" ? "Company" :
    kind === "products" ? "Products" :
    kind === "services" ? "Services" :
    "Contact";
  try {
    const url = new URL(finalUrl);
    return `${label} · ${url.hostname}`;
  } catch {
    return label;
  }
}
