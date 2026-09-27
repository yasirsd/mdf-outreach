import "server-only";

import { createHash } from "node:crypto";
import { extractUsState } from "./fdaFsvp";

/**
 * BI4F Phase 2C — FDA VQIP adapter.
 *
 * Publisher : U.S. Food & Drug Administration.
 * Source    : "Public List of Approved VQIP Importers" —
 *             https://www.fda.gov/food/importing-food-products-united-states/
 *             voluntary-qualified-importer-program-vqip-public-list-approved-vqip-importers
 * Format    : Single HTML `<table>` inline on the page (~40 KB total).
 *             Columns: Firm Name, Address, Email, Website. No
 *             XLSX/CSV/PDF download exists.
 * Cadence   : annual (fiscal year). Current FY2026 covers
 *             10/1/2025 – 9/30/2026.
 * Licence   : U.S. Government work — public federal publication.
 *             No explicit copyright / reuse restriction on the page.
 *             VQIP importers are a voluntary opt-in universe; the
 *             site itself states listing is optional and non-listing
 *             does not affect participation.
 * Cost      : ₹0.
 * Automation: no login, no captcha, no rate limit observed. Public
 *             federal information.
 *
 * Boundary  : VQIP establishes ONLY company-level FDA program
 *             participation. It does NOT include product, origin,
 *             shipment, quantity, value, or supplier fields. Any
 *             product / origin evidence must remain the sole
 *             responsibility of a legitimate provider whose row
 *             grain actually carries it (e.g. Canada CID).
 */

export const FDA_VQIP_DATASET_ID = "fda-vqip-participant-list" as const;
export const FDA_VQIP_SOURCE_URL =
  "https://www.fda.gov/food/importing-food-products-united-states/voluntary-qualified-importer-program-vqip-public-list-approved-vqip-importers" as const;
export const FDA_VQIP_PARSE_VERSION = "fda-vqip-html-v1" as const;
export const FDA_VQIP_MAX_BYTES = 4 * 1024 * 1024;
export const FDA_VQIP_ATTRIBUTION =
  "Source: U.S. Food & Drug Administration — Public List of Approved VQIP Importers." as const;

export interface FdaVqipRow {
  /** Firm legal name exactly as published in the FDA table. */
  firmName: string;
  /** Two-letter U.S. state code parsed from the address column. */
  stateCode?: string;
  /** Full address text as published (address column, whitespace-collapsed). */
  address: string;
}

export interface ParsedFdaVqipDataset {
  /** e.g. "FY2026 (10/1/2025 – 9/30/2026)" — extracted from page copy when present. */
  publishedPeriod: string;
  rows: FdaVqipRow[];
  malformedRowCount: number;
}

export class FdaVqipParserError extends Error {
  readonly code: "PARSER_INCOMPATIBLE" | "VQIP_SOURCE_HTML_MISSING_TABLE" | "VQIP_REQUIRED_HEADERS_MISSING" | "VQIP_OVERSIZE" | "VQIP_EMPTY";
  constructor(message: string, code: FdaVqipParserError["code"] = "PARSER_INCOMPATIBLE") {
    super(message); this.name = "FdaVqipParserError"; this.code = code;
  }
}

function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(html: string): string {
  return html.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

/**
 * Extract rows from the VQIP HTML page. The page contains exactly
 * one `<table>` with headers Firm Name / Address / Email / Website
 * (verified against the live source, 2026-09-27). We refuse to
 * accept any page that does not match this shape.
 */
export function parseFdaVqipHtml(bytes: Uint8Array): ParsedFdaVqipDataset {
  if (bytes.byteLength === 0) throw new FdaVqipParserError("VQIP response body is empty.", "VQIP_EMPTY");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // Find <table>...</table>. There's exactly one on the current page.
  const tableMatch = /<table[\s\S]*?<\/table>/i.exec(text);
  if (!tableMatch) {
    throw new FdaVqipParserError("VQIP page does not contain the expected HTML table.", "VQIP_SOURCE_HTML_MISSING_TABLE");
  }
  const table = tableMatch[0];
  const headerRow = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(table);
  if (!headerRow) throw new FdaVqipParserError("VQIP table has no header row.", "VQIP_REQUIRED_HEADERS_MISSING");
  const headerCells = Array.from(headerRow[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi), (m) => stripTags(m[1]).toLowerCase());
  if (!headerCells.length) throw new FdaVqipParserError("VQIP table has no <th> header cells.", "VQIP_REQUIRED_HEADERS_MISSING");
  const firmNameIdx = headerCells.findIndex((h) => /^firm\s*name$/.test(h));
  const addressIdx = headerCells.findIndex((h) => /^address$/.test(h));
  if (firmNameIdx < 0 || addressIdx < 0) {
    throw new FdaVqipParserError(
      "VQIP table is missing required Firm Name / Address headers.",
      "VQIP_REQUIRED_HEADERS_MISSING",
    );
  }

  // Data rows come from within <tbody>, or from all <tr> after the header row.
  const bodyMatch = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(table);
  const bodyHtml = bodyMatch ? bodyMatch[1] : table;
  const rowMatches = Array.from(bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));

  // Fiscal-year period, if published inline. Pattern used on the
  // current page: "fiscal year 2026 (FY2026) Benefit Period (i.e.,
  // 10/1/2025 to 9/30/2026)". Fallback: current FY inferred by
  // scanning the page for FY\d{4}.
  const periodMatch = /fiscal\s+year\s+(\d{4})\s*\((FY\d{4})\)\s*Benefit\s+Period[\s\S]{0,100}?(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]{0,10}?(?:to|through|–|-)[\s\S]{0,10}?(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  const fyMatch = /\b(FY\d{4})\b/.exec(text);
  const publishedPeriod = periodMatch
    ? `${periodMatch[2]} (${periodMatch[3]} – ${periodMatch[4]})`
    : (fyMatch ? fyMatch[1] : "current");

  const rows: FdaVqipRow[] = [];
  const seen = new Set<string>();
  let malformedRowCount = 0;
  for (const rowMatch of rowMatches) {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi), (m) => decodeHtmlEntities(m[1]));
    if (!cells.length) continue; // header row is <th> only
    const firmName = stripTags(cells[firmNameIdx] ?? "").replace(/\s+/g, " ").trim();
    const address = stripTags(cells[addressIdx] ?? "").replace(/\s+/g, " ").trim();
    if (!firmName && !address) continue;
    if (!firmName) { malformedRowCount += 1; continue; }
    const stateCode = extractUsState(address);
    const key = normalizeCompanyName(firmName);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ firmName, stateCode, address });
  }
  return { publishedPeriod, rows, malformedRowCount };
}

/**
 * Deterministic company name normalization — identical to the FSVP
 * / CID convention. NFKD → strip accents → uppercase → drop
 * English + French legal suffixes → collapse whitespace.
 */
const LEGAL_SUFFIXES = new Set([
  "LLC", "L L C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY",
  "LTD", "LIMITED", "LTEE", "LTÉE", "LP", "L P", "LLP", "PLC", "ULC", "SA", "S A",
  "SARL", "SPA", "GMBH", "AG", "NV", "BV",
]);
export function normalizeCompanyName(value: string): string {
  const words = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

export interface FdaVqipMatchResult {
  decision: "exact" | "strong" | "ambiguous" | "rejected" | "none";
  reason: string;
  candidateState?: string;
  matchedRows: FdaVqipRow[];
}

export function matchFdaVqipCompany(input: {
  companyName: string;
  address?: string;
  city?: string;
  rows: readonly FdaVqipRow[];
}): FdaVqipMatchResult {
  const normalized = normalizeCompanyName(input.companyName);
  const candidateState = extractUsState(input.address, input.city);
  if (!normalized) return { decision: "none", reason: "Candidate company name is empty after normalization.", candidateState, matchedRows: [] };
  const deduped = new Map<string, FdaVqipRow>();
  for (const row of input.rows) {
    if (normalizeCompanyName(row.firmName) !== normalized) continue;
    deduped.set(`${normalizeCompanyName(row.firmName)}\u0000${row.stateCode ?? ""}`, row);
  }
  const matches = [...deduped.values()];
  if (!matches.length) return { decision: "none", reason: "No normalized company-name match in the current VQIP participant list.", candidateState, matchedRows: [] };
  if (!candidateState) return { decision: "ambiguous", reason: "Name matched, but the candidate has no unambiguous U.S. state for corroboration.", matchedRows: matches };
  const sameState = matches.filter((row) => row.stateCode === candidateState);
  if (sameState.length) return { decision: "strong", reason: "Normalized company name and U.S. state match with no conflicting identity field.", candidateState, matchedRows: sameState };
  return { decision: "rejected", reason: "A normalized name match exists, but every VQIP row has a conflicting state.", candidateState, matchedRows: matches };
}

export interface FdaVqipFetchResult {
  outcome: "downloaded" | "not_modified";
  bytes?: Uint8Array;
  etag?: string;
  lastModified?: string;
  materialHash?: string;
}

export async function fetchFdaVqipDataset(input: {
  etag?: string;
  lastModified?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<FdaVqipFetchResult> {
  const headers: Record<string, string> = { Accept: "text/html" };
  if (input.etag) headers["If-None-Match"] = input.etag;
  if (input.lastModified) headers["If-Modified-Since"] = input.lastModified;
  const response = await (input.fetchImpl ?? fetch)(FDA_VQIP_SOURCE_URL, {
    headers, redirect: "follow", signal: input.signal, cache: "no-store",
  });
  if (response.status === 304) return { outcome: "not_modified", etag: input.etag, lastModified: input.lastModified };
  if (!response.ok) {
    throw Object.assign(new Error("FDA VQIP request failed."), {
      status: response.status,
      code: response.status >= 500 || response.status === 429 ? "TRANSIENT_HTTP" : "HTTP_ERROR",
    });
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) {
    throw new FdaVqipParserError("FDA VQIP response is not the expected HTML page.");
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > FDA_VQIP_MAX_BYTES) throw new FdaVqipParserError("FDA VQIP response exceeds bounded download size.", "VQIP_OVERSIZE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > FDA_VQIP_MAX_BYTES) throw new FdaVqipParserError("FDA VQIP response exceeds bounded download size.", "VQIP_OVERSIZE");
  return {
    outcome: "downloaded", bytes,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    materialHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
