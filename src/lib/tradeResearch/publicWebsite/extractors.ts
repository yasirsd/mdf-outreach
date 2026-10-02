/**
 * TH04B — Public-website signal extractors for the trade-research
 * pipeline.
 *
 * These helpers consume RAW HTML already fetched by the executor
 * and project signals using the TH03 Thailand helpers. Pure
 * functions over strings — no I/O, no external deps.
 *
 * Scope deliberately narrow: Thai V1 cares about product
 * relevance, role signals, public contact information, and
 * supporting identity hints. Nothing here promotes company
 * shipment, India-origin, regulatory registration, or buyer
 * intent.
 */

import {
  compareThaiCompanyIdentity,
  normalizeThaiLegalName,
  normalizeThaiTextForComparison,
  normalizeThaiTextForDisplay,
  normalizeThailandPhone,
  type ThaiCompanyIdentityComparison,
} from "@/lib/buyerFinder/thailand";
import { THAILAND_KEYWORDS } from "@/lib/buyerFinder/thailand/keywords";

export interface PublicWebsiteSignalExtractionInput {
  readonly html: string;
  readonly url: string;
  readonly candidateCompanyName?: string | null;
  readonly candidateDomain?: string | null;
  readonly candidateJuristicRegistrationNumber?: string | null;
}

export interface PublicWebsiteSignals {
  readonly pageUrl: string;
  readonly pageTitle: string | null;
  readonly productSignals: readonly string[];
  readonly roleSignals: readonly string[];
  readonly contactSignals: readonly string[];
  readonly observedPublicEmails: readonly string[];
  readonly observedPublicPhones: readonly string[];
  readonly observedThaiLegalNameSnapshot: string | null;
  readonly observedEnglishLegalNameSnapshot: string | null;
  readonly observedJuristicNumberSnapshot: string | null;
  readonly identityComparison: ThaiCompanyIdentityComparison | null;
  readonly rawTextLengthChars: number;
}

const SCRIPT_STYLE_PATTERN = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_RUN = /[ \t\r\n\f\v ]+/g;
const TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

const EMAIL_PATTERN = /(?:[A-Za-z0-9._%+\-]+)@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?))+/g;
const MAILTO_PATTERN = /mailto:([^"'\s<>]+)/gi;
const TEL_PATTERN = /(?:tel|phone)\s*[:\.]\s*([+0-9][0-9 \-()]{6,})/gi;
const PHONE_LOOSE_PATTERN = /(?<![0-9])(?:\+?66|0)[0-9 \-()]{8,}/g;
const JURISTIC_PATTERN = /(?<![0-9])[0-9]{13}(?![0-9])/g;

function sanitizeHtmlToText(html: string): string {
  if (typeof html !== "string" || !html.length) return "";
  const noScripts = html.replace(SCRIPT_STYLE_PATTERN, " ");
  const noTags = noScripts.replace(TAG_PATTERN, " ");
  const decoded = noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(WHITESPACE_RUN, " ").trim();
}

function extractTitle(html: string): string | null {
  const m = TITLE_PATTERN.exec(html);
  if (!m) return null;
  const text = sanitizeHtmlToText(m[1] ?? "");
  return text || null;
}

/**
 * Detect which product / role / contact keywords appear in a
 * comparison-normalized text form. Returns deterministic lists in
 * insertion order of the dictionary.
 */
function detectSignals(normalizedText: string, dict: readonly string[]): string[] {
  if (!normalizedText) return [];
  const hits: string[] = [];
  for (const term of dict) {
    const needle = normalizeThaiTextForComparison(term);
    if (!needle) continue;
    if (normalizedText.includes(needle)) hits.push(term);
  }
  return hits;
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort();
}

function extractEmails(text: string, html: string): string[] {
  const emails = new Set<string>();
  for (const m of html.matchAll(MAILTO_PATTERN)) {
    const addr = m[1]?.trim().toLowerCase();
    if (addr) emails.add(addr);
  }
  for (const m of text.matchAll(EMAIL_PATTERN)) {
    const addr = m[0].trim().toLowerCase();
    if (addr) emails.add(addr);
  }
  return [...emails].sort();
}

function extractPhones(text: string, html: string): string[] {
  const normalized = new Set<string>();
  const consider = (candidate: string | null) => {
    if (!candidate) return;
    const r = normalizeThailandPhone(candidate);
    if (r.validFormat && r.normalizedE164) normalized.add(r.normalizedE164);
  };
  for (const m of html.matchAll(TEL_PATTERN)) consider(m[1] ?? null);
  for (const m of text.matchAll(PHONE_LOOSE_PATTERN)) consider(m[0]);
  return [...normalized].sort();
}

function extractThaiLegalNameSnapshot(text: string): string | null {
  // Capture up to ~120 chars after the opening Thai bracket phrase.
  const idx = text.indexOf("บริษัท");
  if (idx < 0) return null;
  const window = text.slice(idx, idx + 120);
  const closed = /จำกัด(?:\s*\(?มหาชน\)?)?/.exec(window);
  if (!closed) return null;
  const end = closed.index + closed[0].length;
  return normalizeThaiTextForDisplay(window.slice(0, end)) || null;
}

function extractEnglishLegalNameSnapshot(text: string): string | null {
  // Simple capture: look for the first `… Co., Ltd.` / `… Ltd` /
  // `… Public Company Limited` phrase on the page.
  const patterns: RegExp[] = [
    /\b([A-Z][A-Za-z0-9&'.,\- ]{2,80}?\s+(?:Public\s+Company\s+Limited|P\.?C\.?L\.?))/i,
    /\b([A-Z][A-Za-z0-9&'.,\- ]{2,80}?\s+(?:Co\.?,?\s*Ltd\.?|Company\s+Limited|Ltd\.?))/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m && m[1]) return normalizeThaiTextForDisplay(m[1]);
  }
  return null;
}

function extractJuristicNumberSnapshot(text: string): string | null {
  for (const m of text.matchAll(JURISTIC_PATTERN)) return m[0];
  return null;
}

/**
 * Pure extraction. The HTML is treated as public data — no
 * normalization of the raw input (callers persist raw page bytes
 * elsewhere if needed). Return value is JSON-safe.
 */
export function extractPublicWebsiteSignals(input: PublicWebsiteSignalExtractionInput): PublicWebsiteSignals {
  const rawText = sanitizeHtmlToText(input.html);
  const comparisonText = normalizeThaiTextForComparison(rawText);
  const pageTitle = extractTitle(input.html);

  const productSignals = detectSignals(comparisonText, THAILAND_KEYWORDS.productSignals);
  const roleSignals = detectSignals(comparisonText, THAILAND_KEYWORDS.roleSignals);
  const contactSignals = detectSignals(comparisonText, THAILAND_KEYWORDS.contactSignals);

  const observedPublicEmails = uniqueSorted(extractEmails(rawText, input.html));
  const observedPublicPhones = uniqueSorted(extractPhones(rawText, input.html));

  const observedThaiLegalNameSnapshot = extractThaiLegalNameSnapshot(rawText);
  const observedEnglishLegalNameSnapshot = extractEnglishLegalNameSnapshot(rawText);
  const observedJuristicNumberSnapshot = extractJuristicNumberSnapshot(rawText);

  let identityComparison: ThaiCompanyIdentityComparison | null = null;
  if (input.candidateCompanyName || input.candidateDomain || input.candidateJuristicRegistrationNumber) {
    const siteA = {
      thaiLegalName: observedThaiLegalNameSnapshot,
      englishLegalName: observedEnglishLegalNameSnapshot,
      domain: safeUrlHost(input.url),
      juristicRegistrationNumber: observedJuristicNumberSnapshot,
    };
    const candidate = {
      thaiLegalName: input.candidateCompanyName ?? null,
      englishLegalName: input.candidateCompanyName ?? null,
      domain: input.candidateDomain ?? null,
      juristicRegistrationNumber: input.candidateJuristicRegistrationNumber ?? null,
    };
    identityComparison = compareThaiCompanyIdentity(siteA, candidate);
  }

  return {
    pageUrl: input.url,
    pageTitle,
    productSignals,
    roleSignals,
    contactSignals,
    observedPublicEmails,
    observedPublicPhones,
    observedThaiLegalNameSnapshot,
    observedEnglishLegalNameSnapshot,
    observedJuristicNumberSnapshot,
    identityComparison,
    rawTextLengthChars: rawText.length,
  };
}

function safeUrlHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/**
 * `normalizeThaiLegalName` re-exported here so callers only import
 * from the trade-research publicWebsite barrel.
 */
export { normalizeThaiLegalName };
