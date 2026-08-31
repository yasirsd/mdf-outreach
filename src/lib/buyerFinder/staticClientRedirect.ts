/**
 * BF3A.5E — static client-redirect discovery.
 *
 * Reads already-fetched HTML for explicit destinations only.
 * Never executes JavaScript (no eval, Function, vm, or DOM).
 */

import { isSameCompanySite } from "./sameSite";
import { UnsafeUrlError, parsePublicHttpUrl } from "./ssrf";

export const MAX_STATIC_CLIENT_REDIRECT_HOPS = 2;

const RESERVED_IDENT = new Set([
  "window",
  "document",
  "location",
  "href",
  "this",
  "self",
  "top",
  "parent",
  "eval",
  "function",
]);

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:(["'])([\\s\\S]*?)\\1|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  if (!m) return undefined;
  return decodeBasicEntities((m[2] ?? m[3] ?? "").trim());
}

function parseMetaRefreshContent(content: string): string | undefined {
  const decoded = decodeBasicEntities(content).trim();
  const m = decoded.match(/url\s*=\s*/i);
  if (!m || m.index == null) return undefined;
  let rest = decoded.slice(m.index + m[0].length).trim();
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    rest = end >= 0 ? rest.slice(1, end) : rest.slice(1);
  } else {
    rest = rest.split(/[\s;>]/)[0] ?? rest;
  }
  const dest = rest.trim();
  return dest.length > 0 ? dest : undefined;
}

function extractMetaRefreshTargets(html: string): string[] {
  const out: string[] = [];
  const re = /<meta\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    if ((attr(attrs, "http-equiv") ?? "").toLowerCase() !== "refresh") continue;
    const content = attr(attrs, "content");
    if (!content) continue;
    const dest = parseMetaRefreshContent(content);
    if (dest) out.push(dest);
  }
  return out;
}

function isJsScriptAttrs(attrs: string): boolean {
  if (/\bsrc\s*=/i.test(attrs)) return false;
  const type = (attr(attrs, "type") ?? "").toLowerCase();
  if (!type) return true;
  if (type.includes("ld+json") || type.includes("json") || type.includes("importmap")) return false;
  return type.includes("javascript") || type === "module" || type === "text/javascript";
}

function extractInlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!isJsScriptAttrs(m[1] ?? "")) continue;
    const body = (m[2] ?? "").trim();
    if (body) out.push(body);
  }
  return out;
}

function stripUnevaluatedCalls(script: string): string {
  return script
    .replace(/\beval\s*\(\s*(['"])[\s\S]*?\1\s*\)/g, " ")
    .replace(/\bnew\s+Function\s*\(\s*(['"])[\s\S]*?\1\s*\)/g, " ")
    .replace(/\bFunction\s*\(\s*(['"])[\s\S]*?\1\s*\)/g, " ");
}

function isBareLiteralEnd(script: string, endIndex: number): boolean {
  const rest = script.slice(endIndex).replace(/^[ \t]+/, "");
  if (!rest) return true;
  const c = rest[0];
  return c === ";" || c === "," || c === ")" || c === "}" || c === "\n" || c === "\r" || rest.startsWith("//");
}

function quotedLiteralDests(script: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:window\s*\.\s*)?location\s*\.\s*href\s*=\s*(['"])([^'"\r\n]+)\1/g,
    /(?:window\s*\.\s*)?location\s*\.\s*replace\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g,
    /(?:window\s*\.\s*)?location\s*=\s*(['"])([^'"\r\n]+)\1/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(script))) {
      if (!isBareLiteralEnd(script, m.index + m[0].length)) continue;
      const dest = (m[2] ?? "").trim();
      if (dest && !dest.includes("${") && !dest.includes("+")) out.push(dest);
    }
  }
  return out;
}

function assignmentCount(script: string, ident: string): number {
  const re = new RegExp(`\\b${ident}\\s*=`, "g");
  return (script.match(re) ?? []).length;
}

function hasIdentifierSink(script: string, ident: string): boolean {
  const href = new RegExp(
    `(?:window\\s*\\.\\s*)?location\\s*\\.\\s*href\\s*=\\s*${ident}\\b(?!\\s*[.(\\[+])`,
  );
  const replace = new RegExp(
    `(?:window\\s*\\.\\s*)?location\\s*\\.\\s*replace\\s*\\(\\s*${ident}\\s*\\)`,
  );
  const bare = new RegExp(
    `(?:window\\s*\\.\\s*)?location\\s*=\\s*${ident}\\b(?!\\s*[.(\\[+])`,
  );
  return href.test(script) || replace.test(script) || bare.test(script);
}

/**
 * Same-script `var ident = "literal"` used later as a location sink.
 * Single assignment only. No expressions, no reassignment, no eval.
 */
function quotedIdentDests(script: string): string[] {
  const out: string[] = [];
  const decl =
    /\b(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(['"])([^'"\r\n]+)\2/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(script))) {
    const ident = m[1] ?? "";
    const dest = (m[3] ?? "").trim();
    if (!ident || RESERVED_IDENT.has(ident.toLowerCase())) continue;
    if (!dest || dest.includes("${") || dest.includes("+")) continue;
    if (!isBareLiteralEnd(script, m.index + m[0].length)) continue;
    if (assignmentCount(script, ident) !== 1) continue;
    if (!hasIdentifierSink(script, ident)) continue;
    out.push(dest);
  }
  return out;
}

function normalizeRedirectDest(
  raw: string,
  baseUrl: string,
  candidateDomain: string,
): string | undefined {
  const trimmed = decodeBasicEntities(raw).trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("vbscript:")
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(trimmed, baseUrl);
  } catch {
    return undefined;
  }
  try {
    parsePublicHttpUrl(url.toString());
  } catch (err) {
    if (err instanceof UnsafeUrlError) return undefined;
    return undefined;
  }
  if (!isSameCompanySite(candidateDomain, url.hostname)) return undefined;
  url.hash = "";
  return url.toString();
}

export function extractStaticClientRedirects(
  html: string,
  baseUrl: string,
  candidateDomain: string,
): string[] {
  const raw: string[] = [];
  raw.push(...extractMetaRefreshTargets(html));
  for (const script of extractInlineScripts(html)) {
    const scanned = stripUnevaluatedCalls(script);
    raw.push(...quotedLiteralDests(scanned));
    raw.push(...quotedIdentDests(scanned));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dest of raw) {
    const normalized = normalizeRedirectDest(dest, baseUrl, candidateDomain);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
