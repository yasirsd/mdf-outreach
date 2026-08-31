/**
 * Extract published emails from fetched public HTML.
 *
 * Sources: mailto: links, visible text after stripping script/style/noscript,
 * and JSON-LD `email` fields. Never invents local-part@domain.
 */

import { isJunkPublicEmail } from "./publicMailbox";

export const PUBLIC_EMAIL_MAX_LENGTH = 254;

const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;

export function normalizeDiscoveredEmail(raw: string): string | undefined {
  let s = (raw ?? "").trim();
  if (!s) return undefined;
  if (s.toLowerCase().startsWith("mailto:")) s = s.slice(7);
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  s = s.replace(/^[\s<]+/, "").replace(/[>\s]+$/, "");
  s = s.replace(/[.,;:!?)]+$/g, "");
  s = decodeUriComponentSafe(s).trim().toLowerCase();
  if (!s || s.length > PUBLIC_EMAIL_MAX_LENGTH) return undefined;
  if (/[\r\n\0]/.test(s)) return undefined;
  if (s.includes("&") || s.includes("<") || s.includes(">")) return undefined;
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(s)) return undefined;
  if (s.startsWith(".") || s.includes("..") || s.endsWith(".")) return undefined;
  if (isJunkPublicEmail(s)) return undefined;
  return s;
}

function decodeUriComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function decodeBasicEntities(html: string): string {
  return html
    .replace(/&#0*64;|&#x0*40;/gi, "@")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripNonContent(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
}

function collectFromText(text: string, into: Set<string>): void {
  const decoded = decodeBasicEntities(text);
  for (const match of decoded.match(EMAIL_RE) ?? []) {
    const email = normalizeDiscoveredEmail(match);
    if (email) into.add(email);
  }
}

function extractMailto(html: string, into: Set<string>): void {
  const re = /mailto:([^"'>\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const email = normalizeDiscoveredEmail(m[1] ?? "");
    if (email) into.add(email);
  }
}

function extractJsonLd(html: string, into: Set<string>): void {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      walkJsonLd(JSON.parse(raw), into, 0);
    } catch {
      // Malformed JSON-LD is ignored. Do not regex the bundle.
    }
  }
}

function walkJsonLd(value: unknown, into: Set<string>, depth: number): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "string") {
    const email = normalizeDiscoveredEmail(value);
    if (email) into.add(email);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) walkJsonLd(item, into, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  if (typeof rec.email === "string") {
    const email = normalizeDiscoveredEmail(rec.email);
    if (email) into.add(email);
  }
  if (Array.isArray(rec.email)) {
    for (const item of rec.email.slice(0, 20)) {
      if (typeof item === "string") {
        const email = normalizeDiscoveredEmail(item);
        if (email) into.add(email);
      }
    }
  }
  for (const v of Object.values(rec).slice(0, 40)) walkJsonLd(v, into, depth + 1);
}

/**
 * Extract unique normalized emails from one HTML page. Does not guess.
 */
export function extractPublishedEmails(html: string): string[] {
  const found = new Set<string>();
  extractMailto(html, found);
  extractJsonLd(html, found);
  const visible = stripNonContent(html).replace(/<[^>]+>/g, " ");
  collectFromText(visible, found);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Path or host-relative href that looks like a contact page. */
const CONTACT_PATH =
  /contact-us|\/contact(?:\/|$|\?)|get-in-touch|connect-with-us|reach-us|\/connect(?:\/|$|\?)/i;

const ABOUT_PATH = /about-us|\/about(?:\/|$|\?)|\/company(?:\/|$|\?)|locations/i;

const CONTACT_TEXT =
  /\b(contact(?:\s+us)?|connect\s+with\s+us|get\s+in\s+touch|reach\s+us)\b/i;

const ABOUT_TEXT = /\b(about(?:\s+us)?|company|locations)\b/i;

export type CandidatePageKind = "contact" | "about";

export interface CandidatePageLink {
  href: string;
  text: string;
  kind: CandidatePageKind;
}

function decodeHref(raw: string): string {
  const entities = raw
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  return decodeUriComponentSafe(entities).trim();
}

function pathAndQuery(href: string): string {
  try {
    const url = new URL(href, "https://example.invalid/");
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return href.toLowerCase();
  }
}

/**
 * Classify from path OR anchor text. Either side is enough.
 * Contact ranks ahead of about. Undefined = not a candidate page.
 */
export function classifyCandidatePageLink(href: string, text: string): CandidatePageKind | undefined {
  const pathish = pathAndQuery(href);
  const label = text.replace(/\s+/g, " ").trim();
  if (CONTACT_PATH.test(pathish) || CONTACT_TEXT.test(label)) return "contact";
  if (ABOUT_PATH.test(pathish) || ABOUT_TEXT.test(label)) return "about";
  return undefined;
}

/** Contact pages before about/company/locations. Stable within a kind. */
export function rankCandidatePageLinks(links: CandidatePageLink[]): CandidatePageLink[] {
  return [...links].sort((a, b) => {
    const rank = (k: CandidatePageKind) => (k === "contact" ? 0 : 1);
    const d = rank(a.kind) - rank(b.kind);
    if (d !== 0) return d;
    return 0;
  });
}

/**
 * Collect same-document hrefs that look like contact/about pages.
 * Resolution against the page URL is the caller's job (SSRF/same-site).
 */
export function extractCandidatePageLinks(html: string): CandidatePageLink[] {
  const visible = stripNonContent(html);
  const out: CandidatePageLink[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]+)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(visible))) {
    const attrs = m[1] ?? "";
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const hrefMatch = attrs.match(/href\s*=\s*(["'])([^"']+)\1/i) ?? attrs.match(/href\s*=\s*([^\s>]+)/i);
    const href = decodeHref(hrefMatch?.[2] ?? hrefMatch?.[1] ?? "");
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) continue;
    const kind = classifyCandidatePageLink(href, text);
    if (!kind) continue;
    const key = href.replace(/\/$/, "") || href;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, text, kind });
  }
  return out;
}
