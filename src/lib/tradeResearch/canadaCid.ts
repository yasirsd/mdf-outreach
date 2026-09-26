import "server-only";

import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";

/**
 * BI4F Phase 2B — Canadian Importers Database (CID) adapter.
 *
 * Publisher : Innovation, Science and Economic Development Canada
 *             (ISED), using CBSA import data collected by CBSA.
 * Dataset   : "Major Importers by HS6, country" — the ONLY CID
 *             resource whose row-grain is `(HS6, country of origin,
 *             importer company)`. This is the only legitimate
 *             single-row join of company + product + origin. Every
 *             other CID resource is either company-only (no origin)
 *             or origin-only (no company); this adapter deliberately
 *             refuses to synthesise a company+origin claim from
 *             separate resources.
 * Licence   : Open Government Licence – Canada, v2.0. Attribution
 *             string emitted on every result: CANADA_CID_ATTRIBUTION.
 * Cadence   : annual; cache horizon 365 days.
 *
 * Boundary  : this adapter yields company-specific product AND origin
 *             evidence when a row matches. It NEVER yields shipment
 *             evidence — CID confidentiality suppressions mean per-
 *             company quantity and value are not divulged. It never
 *             composes a company+origin claim from the by-product
 *             list plus the by-country list; only the combined
 *             `by-HS6-by-country` resource supports that.
 */

export const CANADA_CID_DATASET_ID = "cid-major-importers-by-hs6-by-country" as const;
export const CANADA_CID_PARSE_VERSION = "canada-cid-xlsx-v1" as const;
export const CANADA_CID_MAX_BYTES = 40 * 1024 * 1024;
export const CANADA_CID_ATTRIBUTION =
  "Contains information licensed under the Open Government Licence – Canada." as const;

/**
 * Build the official Open Government file URL for a given dataset
 * year. Mirrors the pattern observed on the 2023 and 2024 dataset
 * records; the actual file's extension is `.xls` on the server even
 * though the content is XLSX (Office Open XML zip) — this matches
 * ISED's published resource naming.
 */
export function canadaCidByHs6ByCountryUrl(year: number): string {
  return `https://ised-isde.canada.ca/site/ised/sites/default/files/documents/cid-bdic-majorimportersbyhs6bycountry${year}.xls`;
}

export interface CanadaCidRow {
  /** HS6 code, zero-padded to 6 digits (leading zero preservation). */
  hs6: string;
  /** ISO-3166-1 alpha-3 country of origin as published in the CID row. */
  originCountry: string;
  /** Importer legal name exactly as published. */
  companyName: string;
  /** Two-letter province code where the importer is located (best-effort). */
  province?: string;
  /** City where the importer is located (best-effort). */
  city?: string;
}

export interface ParsedCanadaCidDataset {
  /** e.g. "2024" — 4-digit dataset year as declared on the row's period column. */
  publishedPeriod: string;
  rows: CanadaCidRow[];
  malformedRowCount: number;
}

export class CanadaCidParserError extends Error {
  readonly code = "PARSER_INCOMPATIBLE";
  constructor(message: string) { super(message); this.name = "CanadaCidParserError"; }
}

function xmlDecode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"").replaceAll("&apos;", "'");
}

function textNodes(xml: string): string {
  return Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (m) => xmlDecode(m[1])).join("");
}

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g), (m) => textNodes(m[1]));
}

function cellValue(cellXml: string, shared: readonly string[]): string {
  const type = /\bt="([^"]+)"/.exec(cellXml)?.[1];
  if (type === "inlineStr") return textNodes(cellXml).trim();
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
  if (raw === undefined) return "";
  if (type === "s") return shared[Number(raw)]?.trim() ?? "";
  return xmlDecode(raw).trim();
}

function columnFromRef(ref: string): string {
  return /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
}

/**
 * Case-insensitive header matcher — CID publishes bilingual headers
 * so both the English label and the French label are accepted. Only
 * the English label is required for a successful parse; French is a
 * disambiguation aid. Every regex here is intentionally strict enough
 * to reject an accidental substring collision.
 */
const HEADER_MATCHERS = {
  hs6: /^(?:hs\s*6|hs6\s*code|code\s*sh\s*6|sh6)$/i,
  originCountry: /^(?:country\s*of\s*origin|origin\s*country|country|pays\s*d.?origine)$/i,
  companyName: /^(?:importer\s*name|company\s*name|importer|nom(?:\s*de\s*l.?)?importateur|entreprise)$/i,
  province: /^(?:province|prov\.?)$/i,
  city: /^(?:city|ville)$/i,
} as const;

function findColumn(header: Record<string, string>, matcher: RegExp): string | undefined {
  for (const [column, value] of Object.entries(header)) {
    if (matcher.test((value ?? "").trim())) return column;
  }
  return undefined;
}

const HS6_PATTERN = /^(\d{6})$/;
const ISO3_PATTERN = /^[A-Z]{3}$/;
const PROVINCE_PATTERN = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/i;

export function normalizeHs6(value: string | number): string | undefined {
  const raw = typeof value === "number" ? Math.round(value).toString() : (value ?? "").trim();
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  const padded = digits.padStart(6, "0").slice(-6);
  return HS6_PATTERN.test(padded) ? padded : undefined;
}

export function parseCanadaCidXlsx(bytes: Uint8Array): ParsedCanadaCidDataset {
  let archive: Record<string, Uint8Array>;
  try { archive = unzipSync(bytes); }
  catch { throw new CanadaCidParserError("Canada CID workbook is not a valid XLSX archive."); }
  const sheetBytes = archive["xl/worksheets/sheet1.xml"];
  if (!sheetBytes) throw new CanadaCidParserError("Canada CID workbook has no first worksheet.");
  const sheet = strFromU8(sheetBytes);
  const shared = parseSharedStrings(archive["xl/sharedStrings.xml"] ? strFromU8(archive["xl/sharedStrings.xml"]) : undefined);
  const matrix: Array<Record<string, string>> = [];
  for (const rowMatch of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row: Record<string, string> = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = /\br="([^"]+)"/.exec(cellMatch[1])?.[1];
      if (ref) row[columnFromRef(ref)] = cellValue(`<c ${cellMatch[1]}>${cellMatch[2]}</c>`, shared);
    }
    matrix.push(row);
  }
  return parseCanadaCidRows(matrix);
}

export function parseCanadaCidRows(matrix: readonly Record<string, string>[]): ParsedCanadaCidDataset {
  const headerIndex = matrix.findIndex((row) => {
    const values = Object.values(row);
    return values.some((v) => HEADER_MATCHERS.hs6.test((v ?? "").trim())) &&
           values.some((v) => HEADER_MATCHERS.originCountry.test((v ?? "").trim())) &&
           values.some((v) => HEADER_MATCHERS.companyName.test((v ?? "").trim()));
  });
  if (headerIndex < 0) {
    throw new CanadaCidParserError(
      "Canada CID workbook headers changed; expected HS6, Country of Origin, Importer Name.",
    );
  }
  const header = matrix[headerIndex];
  const hs6Col = findColumn(header, HEADER_MATCHERS.hs6);
  const originCol = findColumn(header, HEADER_MATCHERS.originCountry);
  const nameCol = findColumn(header, HEADER_MATCHERS.companyName);
  if (!hs6Col || !originCol || !nameCol) {
    throw new CanadaCidParserError("Canada CID header mapping is incomplete.");
  }
  const provinceCol = findColumn(header, HEADER_MATCHERS.province);
  const cityCol = findColumn(header, HEADER_MATCHERS.city);

  const preheader = matrix.slice(0, headerIndex).flatMap((row) => Object.values(row)).filter(Boolean);
  const yearFromPreheader = preheader.map((text) => /\b(20\d{2})\b/.exec(text)?.[1]).find(Boolean);
  // Fallback to picking a year from ANY cell — CID files publish the
  // dataset year in the first row of every sheet.
  const yearFromMatrix = yearFromPreheader ??
    (matrix.slice(headerIndex + 1, headerIndex + 5)
      .flatMap((row) => Object.values(row))
      .map((text) => /\b(20\d{2})\b/.exec(text)?.[1])
      .find(Boolean));
  if (!yearFromMatrix) throw new CanadaCidParserError("Canada CID dataset year is missing.");
  const publishedPeriod = String(yearFromMatrix);

  const seen = new Set<string>();
  const rows: CanadaCidRow[] = [];
  let malformedRowCount = 0;
  for (const row of matrix.slice(headerIndex + 1)) {
    const rawHs6 = (row[hs6Col] ?? "").trim();
    const rawOrigin = (row[originCol] ?? "").trim().toUpperCase();
    const rawName = (row[nameCol] ?? "").trim().replace(/\s+/g, " ");
    if (!rawHs6 && !rawOrigin && !rawName) continue;
    const hs6 = normalizeHs6(rawHs6);
    if (!hs6) { malformedRowCount += 1; continue; }
    if (!rawOrigin || !ISO3_PATTERN.test(rawOrigin)) { malformedRowCount += 1; continue; }
    if (!rawName) { malformedRowCount += 1; continue; }
    const province = provinceCol ? (row[provinceCol] ?? "").trim().toUpperCase() : "";
    const city = cityCol ? (row[cityCol] ?? "").trim().replace(/\s+/g, " ") : "";
    const key = `${hs6}\u0000${rawOrigin}\u0000${normalizeCompanyName(rawName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      hs6, originCountry: rawOrigin, companyName: rawName,
      province: province && PROVINCE_PATTERN.test(province) ? province : undefined,
      city: city || undefined,
    });
  }
  return { publishedPeriod, rows, malformedRowCount };
}

const LEGAL_SUFFIXES = new Set([
  "LLC", "L L C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY",
  "LTD", "LIMITED", "LTEE", "LTÉE", "LP", "L P", "LLP", "PLC", "ULC", "SA", "S A",
  "SARL", "SPA", "GMBH", "AG", "NV", "BV",
]);

/**
 * Deterministic company-name normalization.
 * NFKD → strip accents → uppercase → collapse punctuation → drop legal
 * suffixes (English + French). Never fuzzy-similarity.
 */
export function normalizeCompanyName(value: string): string {
  const words = value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

export function extractCanadianProvince(address?: string, city?: string): string | undefined {
  const raw = [address, city].filter(Boolean).join(", ").trim().toUpperCase();
  if (!raw) return undefined;
  const explicit = /(?:,\s*|\s)(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)(?=\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\b|\s*$|\s*,)/g;
  for (const match of raw.matchAll(explicit)) if (PROVINCE_PATTERN.test(match[1])) return match[1];
  const map: Record<string, string> = {
    "ALBERTA": "AB", "BRITISH COLUMBIA": "BC", "MANITOBA": "MB", "NEW BRUNSWICK": "NB",
    "NEWFOUNDLAND AND LABRADOR": "NL", "NEWFOUNDLAND": "NL", "LABRADOR": "NL",
    "NOVA SCOTIA": "NS", "NORTHWEST TERRITORIES": "NT", "NUNAVUT": "NU",
    "ONTARIO": "ON", "PRINCE EDWARD ISLAND": "PE", "QUEBEC": "QC", "QUÉBEC": "QC",
    "SASKATCHEWAN": "SK", "YUKON": "YT",
  };
  for (const [name, code] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${name.replaceAll(" ", "\\s+")}\\b`).test(raw)) return code;
  }
  return undefined;
}

export interface CanadaCidMatchResult {
  /** Company identity decision. */
  decision: "exact" | "strong" | "ambiguous" | "rejected" | "none";
  reason: string;
  candidateProvince?: string;
  /**
   * Rows that matched by normalized company name AND target HS6.
   * These are ALL company+HS6+origin joined rows from the same
   * dataset — a company may appear multiple times with different
   * origin countries. NEVER cross-composed with a separate resource.
   */
  matchedRows: CanadaCidRow[];
  /**
   * Distinct origin countries the matched company appears under for
   * the target HS6. Populated ONLY from `matchedRows` above — the
   * caller must not populate it from any other CID resource.
   */
  originCountries: string[];
}

/**
 * Deterministic company match against the `Major Importers by HS6,
 * country` CID resource for a specific target HS6. The caller is
 * responsible for supplying rows already filtered to a single HS6 OR
 * relying on this function's `targetHs6` filter.
 */
export function matchCanadaCidCompany(input: {
  companyName: string;
  address?: string;
  city?: string;
  targetHs6: string;
  rows: readonly CanadaCidRow[];
}): CanadaCidMatchResult {
  const normalized = normalizeCompanyName(input.companyName);
  const candidateProvince = extractCanadianProvince(input.address, input.city);
  const target = normalizeHs6(input.targetHs6);
  if (!target) {
    return {
      decision: "none",
      reason: "Target HS6 is missing or malformed; refusing to run a CID match without a canonical HS.",
      candidateProvince, matchedRows: [], originCountries: [],
    };
  }
  if (!normalized) {
    return {
      decision: "none",
      reason: "Candidate company name is empty after normalization.",
      candidateProvince, matchedRows: [], originCountries: [],
    };
  }
  const hs6Rows = input.rows.filter((row) => row.hs6 === target);
  const nameMatches = hs6Rows.filter((row) => normalizeCompanyName(row.companyName) === normalized);
  if (!nameMatches.length) {
    return {
      decision: "none",
      reason: "No normalized company-name match for the target HS6 in the checked CID dataset.",
      candidateProvince, matchedRows: [], originCountries: [],
    };
  }
  const origins = Array.from(new Set(nameMatches.map((row) => row.originCountry))).sort();
  if (!candidateProvince) {
    return {
      decision: "ambiguous",
      reason: "Company name matched for the target HS6, but the candidate has no unambiguous Canadian province for corroboration.",
      candidateProvince, matchedRows: nameMatches, originCountries: origins,
    };
  }
  const provinceMatches = nameMatches.filter((row) => row.province && row.province === candidateProvince);
  if (provinceMatches.length) {
    return {
      decision: "strong",
      reason: "Normalized company name and Canadian province match with no conflicting identity field.",
      candidateProvince, matchedRows: provinceMatches,
      originCountries: Array.from(new Set(provinceMatches.map((row) => row.originCountry))).sort(),
    };
  }
  // Some CID rows do not carry province at all — that is a soft
  // absence, not a rejection. Downgrade to ambiguous rather than
  // rejecting a valid name-only match.
  const hasProvinceField = nameMatches.some((row) => Boolean(row.province));
  if (hasProvinceField) {
    return {
      decision: "rejected",
      reason: "A normalized name match exists, but every CID row has a conflicting Canadian province.",
      candidateProvince, matchedRows: nameMatches, originCountries: origins,
    };
  }
  return {
    decision: "ambiguous",
    reason: "Company name matched for the target HS6; no province field is populated on the CID rows to corroborate.",
    candidateProvince, matchedRows: nameMatches, originCountries: origins,
  };
}

export interface CanadaCidFetchResult {
  outcome: "downloaded" | "not_modified";
  bytes?: Uint8Array;
  etag?: string;
  lastModified?: string;
  materialHash?: string;
  sourceUrl: string;
  year: number;
}

/**
 * Fetch the "Major Importers by HS6, by country" workbook for a
 * given dataset year from the official ISED origin. Respects
 * conditional refresh via ETag / Last-Modified. Refuses any
 * response that is not XLSX-shaped or exceeds the bounded size.
 */
export async function fetchCanadaCidByHs6ByCountry(input: {
  year: number;
  etag?: string;
  lastModified?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<CanadaCidFetchResult> {
  const sourceUrl = canadaCidByHs6ByCountryUrl(input.year);
  const headers: Record<string, string> = {
    Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel",
  };
  if (input.etag) headers["If-None-Match"] = input.etag;
  if (input.lastModified) headers["If-Modified-Since"] = input.lastModified;
  const response = await (input.fetchImpl ?? fetch)(sourceUrl, {
    headers, redirect: "follow", signal: input.signal, cache: "no-store",
  });
  if (response.status === 304) {
    return { outcome: "not_modified", etag: input.etag, lastModified: input.lastModified, sourceUrl, year: input.year };
  }
  if (!response.ok) {
    throw Object.assign(new Error("Canada CID request failed."), {
      status: response.status,
      code: response.status >= 500 || response.status === 429 ? "TRANSIENT_HTTP" : "HTTP_ERROR",
    });
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > CANADA_CID_MAX_BYTES) throw new CanadaCidParserError("Canada CID dataset exceeds bounded download size.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > CANADA_CID_MAX_BYTES) throw new CanadaCidParserError("Canada CID dataset exceeds bounded download size.");
  return {
    outcome: "downloaded", bytes, sourceUrl, year: input.year,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    materialHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
