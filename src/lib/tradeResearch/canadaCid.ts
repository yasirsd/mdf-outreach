import "server-only";

import { createHash } from "node:crypto";

import { codeForCountryName } from "@/lib/catalogue/countries";

/**
 * BI4F Phase 2B — Canadian Importers Database (CID) adapter.
 *
 * Publisher : Innovation, Science and Economic Development Canada
 *             (ISED), using CBSA import data.
 * Licence   : Open Government Licence – Canada, v2.0. Attribution
 *             string emitted on every result: CANADA_CID_ATTRIBUTION.
 *
 * Resource  : "Major Importers by HS6, by country" — the ONLY CID
 *             resource whose row-grain legitimately joins company +
 *             HS6 + origin country in a single row. Every other CID
 *             resource is either company-only (no origin) or
 *             origin-only (no company); this adapter deliberately
 *             refuses to synthesise a company+origin claim from
 *             separate resources.
 *
 * Format    : The 2023 and 2024 releases of that resource are XLSB
 *             (Excel Binary Workbook, `xl/worksheets/sheet1.bin`
 *             inside a ZIP container) served under an `.xls`
 *             extension with `content-type: application/vnd.ms-excel`.
 *             We deliberately do NOT parse XLSB — its binary sheet
 *             stream (~219 MB uncompressed for 2024) would exceed
 *             the Vercel Hobby function budget and its parsing
 *             requires either a substantial new dependency or a
 *             hand-rolled BIFF12 reader. Instead we use the
 *             Open-Government-published CSV releases (2015–2021).
 *             CSV is UTF-8 with BOM, bilingual headers, and one row
 *             per (HS6, importer_company, origin_country) — the
 *             exact grain the adapter needs.
 *
 * Cadence   : annual; cache horizon 365 days.
 *
 * Boundary  : this adapter yields company-specific product AND
 *             origin evidence when a row matches. It NEVER yields
 *             shipment evidence — CID confidentiality suppressions
 *             mean per-company quantity and value are not divulged.
 */

export const CANADA_CID_DATASET_ID = "cid-major-importers-by-hs6-by-country" as const;
/**
 * v2 parse — streams the response body, computes SHA-256
 * incrementally over the full source bytes, and normalizes ONLY
 * rows whose HS6 is one of the canonical MDF product mappings.
 * The 2020 file has 371 k data rows total but only 718 rows match
 * MDF HS6s — filtering during parse reduces the cached JSONB
 * payload from ~40 MB to ~70 KB and keeps parse under ~1.5 s.
 */
export const CANADA_CID_PARSE_VERSION = "canada-cid-csv-v2" as const;
export const CANADA_CID_MAX_BYTES = 40 * 1024 * 1024;
export const CANADA_CID_ATTRIBUTION =
  "Contains information licensed under the Open Government Licence – Canada." as const;

/**
 * Runtime budget error class distinguishing "we voluntarily aborted
 * to preserve cleanup headroom" from "the source format is
 * incompatible". The worker treats this as a retryable release.
 */
export class CanadaCidRuntimeBudgetError extends Error {
  readonly code = "CID_RUNTIME_BUDGET_CHECKPOINT";
  constructor(message: string) { super(message); this.name = "CanadaCidRuntimeBudgetError"; }
}

/**
 * Build the official Open Government CSV URL for a given dataset
 * year. The 2015–2021 releases publish CSV directly; 2023 and 2024
 * publish only XLSB (unsupported here). 2022 exists as an empty
 * placeholder on ISED.
 */
export function canadaCidByHs6ByCountryUrl(year: number): string {
  return `https://ised-isde.canada.ca/site/ised/sites/default/files/documents/cid-bdic-majorimportersbyhs6bycountry${year}.csv`;
}

export interface CanadaCidRow {
  /** HS6 code, zero-padded to 6 digits. */
  hs6: string;
  /** ISO-3166-1 alpha-2 country of origin (normalized from CID's English display name). */
  originCountry: string;
  /** Importer legal name exactly as published. */
  companyName: string;
  /** Two-letter Canadian province code where the importer is located. */
  province?: string;
  /** City where the importer is located. */
  city?: string;
  /** Canadian postal code (best-effort). */
  postalCode?: string;
}

export interface ParsedCanadaCidDataset {
  /** e.g. "2020" — dataset year from the CSV's DATA_YEAR column. */
  publishedPeriod: string;
  rows: CanadaCidRow[];
  malformedRowCount: number;
}

export class CanadaCidParserError extends Error {
  readonly code: "PARSER_INCOMPATIBLE" | "CID_SOURCE_HTML" | "CID_LEGACY_XLS_UNSUPPORTED" | "CID_XLSB_UNSUPPORTED" | "CID_REQUIRED_HEADERS_MISSING" | "CID_OVERSIZE" | "CID_CORRUPT_WORKBOOK";
  constructor(message: string, code: CanadaCidParserError["code"] = "PARSER_INCOMPATIBLE") {
    super(message); this.name = "CanadaCidParserError"; this.code = code;
  }
}

// Canonical two-letter Canadian province codes.
const PROVINCE_PATTERN = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/i;

/** Map full province name (English) to Canadian ISO 3166-2:CA subdivision code. */
const PROVINCE_NAME_TO_CODE: Record<string, string> = {
  "Alberta": "AB", "British Columbia": "BC", "Manitoba": "MB", "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL", "Nova Scotia": "NS", "Northwest Territories": "NT",
  "Nunavut": "NU", "Ontario": "ON", "Prince Edward Island": "PE", "Quebec": "QC",
  "Saskatchewan": "SK", "Yukon": "YT",
};

const HS6_PATTERN = /^\d{6}$/;
const ISO2_PATTERN = /^[A-Z]{2}$/;

export function normalizeHs6(value: string | number): string | undefined {
  const raw = typeof value === "number" ? Math.round(value).toString() : (value ?? "").trim();
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  const padded = digits.padStart(6, "0").slice(-6);
  return HS6_PATTERN.test(padded) ? padded : undefined;
}

/**
 * Convert a CID English country name (e.g. "India", "United States")
 * to its canonical ISO-3166-1 alpha-2 code (e.g. "IN", "US"). Uses
 * the shared MDF countries catalogue so aliases (USA / UK / etc.)
 * resolve too. Returns undefined for names not in the catalogue —
 * the parser treats those rows as malformed rather than guessing.
 */
export function normalizeCidCountry(displayName: string): string | undefined {
  if (!displayName) return undefined;
  return codeForCountryName(displayName);
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

/**
 * Classify the raw response magic signature so we surface a specific
 * parser error instead of feeding an unrelated blob into the CSV
 * pipeline. Returns:
 *   • "csv"   — anything else with recognizable text content
 *   • "html"  — starts with `<!DOCTYPE`, `<html`, `<HTML`, or `<?xml`
 *   • "xlsb"  — Office ZIP container magic PK\x03\x04 (XLSB / XLSX)
 *   • "xls"   — legacy BIFF/OLE2 compound file (D0 CF 11 E0)
 *   • "empty" — 0 bytes
 */
export function classifyCanadaCidBody(bytes: Uint8Array): "csv" | "html" | "xlsb" | "xls" | "empty" {
  if (bytes.byteLength === 0) return "empty";
  const first16 = bytes.subarray(0, Math.min(16, bytes.byteLength));
  const hex = Array.from(first16, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.startsWith("504b0304")) return "xlsb"; // could be XLSX too — either way, not our format
  if (hex.startsWith("d0cf11e0a1b11ae1")) return "xls";
  // Strip UTF-8 BOM before HTML sniff
  const start = bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(start, Math.min(start + 512, bytes.byteLength)));
  const trimmed = head.trimStart();
  if (/^<(?:!doctype|html|\?xml)/i.test(trimmed)) return "html";
  return "csv";
}

/**
 * RFC 4180-ish CSV parser sufficient for the Canada CID resource:
 * commas as separator, `"` for quoting, `""` inside quotes for
 * literal quote, CR/LF/CRLF line endings, UTF-8 with optional BOM.
 * Emits rows as arrays; the caller matches columns by header name.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === "\"") {
        if (i + 1 < n && text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === "\"") { inQuotes = true; i += 1; continue; }
    if (c === ",") { row.push(field); field = ""; i += 1; continue; }
    if (c === "\r") {
      row.push(field); rows.push(row); row = []; field = "";
      if (i + 1 < n && text[i + 1] === "\n") i += 2; else i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      i += 1; continue;
    }
    field += c; i += 1;
  }
  if (inQuotes) throw new CanadaCidParserError("Canada CID CSV has unclosed quoted field.", "CID_CORRUPT_WORKBOOK");
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Bilingual header matchers — English is authoritative; French is a
// disambiguation aid so a stray column shift is caught.
const REQUIRED_HEADERS = {
  hs6: /^HS6(?:-SH6)?$/i,
  company: /^(?:COMPANY(?:-ENTREPRISE)?|ENTREPRISE)$/i,
  country: /^COUNTRY$/i, // English column; French PAYS is a sibling column, not required
} as const;

const OPTIONAL_HEADERS = {
  province: /^PROVINCE(?:_ENG)?$/i,
  city: /^(?:CITY(?:-VILLE)?|VILLE)$/i,
  postalCode: /^POSTAL[_-]?CODE(?:-CODE_POSTAL)?$/i,
  year: /^DATA[_-]?YEAR/i,
} as const;

function findHeader(headerRow: string[], matcher: RegExp): number {
  return headerRow.findIndex((cell) => matcher.test(cell.trim()));
}

export function parseCanadaCidCsv(bytes: Uint8Array): ParsedCanadaCidDataset {
  const kind = classifyCanadaCidBody(bytes);
  if (kind === "empty") throw new CanadaCidParserError("Canada CID response body is empty.", "CID_CORRUPT_WORKBOOK");
  if (kind === "html") throw new CanadaCidParserError("Canada CID URL returned an HTML page, not the CSV dataset.", "CID_SOURCE_HTML");
  if (kind === "xls") throw new CanadaCidParserError("Canada CID URL returned a legacy XLS (BIFF/OLE2) workbook; adapter expects CSV.", "CID_LEGACY_XLS_UNSUPPORTED");
  if (kind === "xlsb") throw new CanadaCidParserError("Canada CID URL returned an XLSB/XLSX workbook; adapter expects CSV.", "CID_XLSB_UNSUPPORTED");
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const rows = parseCsvRows(text);
  if (!rows.length) throw new CanadaCidParserError("Canada CID CSV has no rows.", "CID_CORRUPT_WORKBOOK");
  const header = rows[0].map((cell) => cell.trim());
  const hs6Col = findHeader(header, REQUIRED_HEADERS.hs6);
  const companyCol = findHeader(header, REQUIRED_HEADERS.company);
  const countryCol = findHeader(header, REQUIRED_HEADERS.country);
  if (hs6Col < 0 || companyCol < 0 || countryCol < 0) {
    throw new CanadaCidParserError(
      "Canada CID CSV is missing one of HS6 / COMPANY / COUNTRY headers.",
      "CID_REQUIRED_HEADERS_MISSING",
    );
  }
  const provinceCol = findHeader(header, OPTIONAL_HEADERS.province);
  const cityCol = findHeader(header, OPTIONAL_HEADERS.city);
  const postalCol = findHeader(header, OPTIONAL_HEADERS.postalCode);
  const yearCol = findHeader(header, OPTIONAL_HEADERS.year);

  const seen = new Set<string>();
  const out: CanadaCidRow[] = [];
  let malformedRowCount = 0;
  let publishedPeriod = "";
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === "") continue; // trailing blank line
    const rawHs6 = (row[hs6Col] ?? "").trim();
    const rawCompany = (row[companyCol] ?? "").trim().replace(/\s+/g, " ");
    const rawCountry = (row[countryCol] ?? "").trim();
    if (!rawHs6 && !rawCompany && !rawCountry) continue;
    const hs6 = normalizeHs6(rawHs6);
    if (!hs6) { malformedRowCount += 1; continue; }
    const originCountry = normalizeCidCountry(rawCountry);
    if (!originCountry || !ISO2_PATTERN.test(originCountry)) { malformedRowCount += 1; continue; }
    if (!rawCompany) { malformedRowCount += 1; continue; }
    const rawProvince = provinceCol >= 0 ? (row[provinceCol] ?? "").trim() : "";
    // Province cell may be full English name ("Ontario") or code ("ON").
    const provinceCode = PROVINCE_PATTERN.test(rawProvince)
      ? rawProvince.toUpperCase()
      : (PROVINCE_NAME_TO_CODE[rawProvince] ?? undefined);
    const city = cityCol >= 0 ? (row[cityCol] ?? "").trim().replace(/\s+/g, " ") : "";
    const postalCode = postalCol >= 0 ? (row[postalCol] ?? "").trim() : "";
    const yearFromRow = yearCol >= 0 ? (row[yearCol] ?? "").trim() : "";
    if (!publishedPeriod && /^\d{4}$/.test(yearFromRow)) publishedPeriod = yearFromRow;
    const key = `${hs6}\u0000${originCountry}\u0000${normalizeCompanyName(rawCompany)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      hs6, originCountry, companyName: rawCompany,
      province: provinceCode || undefined,
      city: city || undefined,
      postalCode: postalCode || undefined,
    });
  }
  if (!publishedPeriod) throw new CanadaCidParserError("Canada CID CSV has no DATA_YEAR column values.", "CID_REQUIRED_HEADERS_MISSING");
  return { publishedPeriod, rows: out, malformedRowCount };
}

/**
 * Back-compat entry point — older worker/test call sites use
 * `parseCanadaCidXlsx`. The name is preserved (external API), but
 * the implementation now goes through the CSV pipeline.
 */
export const parseCanadaCidXlsx = parseCanadaCidCsv;

export interface CanadaCidMatchResult {
  decision: "exact" | "strong" | "ambiguous" | "rejected" | "none";
  reason: string;
  candidateProvince?: string;
  matchedRows: CanadaCidRow[];
  originCountries: string[];
}

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

/**
 * Streaming fetch + parse pipeline. Downloads the response body in
 * chunks, computes SHA-256 incrementally over the FULL source bytes
 * (preserves material_hash provenance), and parses each chunk into
 * a running CSV state machine that yields FULL logical rows as they
 * complete. Only rows whose HS6 is in `canonicalHs6` are normalized
 * and retained — this is the load-bearing change that shrinks the
 * cached JSONB from ~40 MB to ~70 KB and keeps parse under 1.5 s.
 *
 * Between chunks the loader:
 *   • calls `opts.onProgress()` (worker-side heartbeat opportunity),
 *   • yields to the event loop via `setImmediate`,
 *   • checks the deadline and throws `CanadaCidRuntimeBudgetError`
 *     if we are within `cleanupReserveMs` of `deadlineAt`.
 *
 * The caller is responsible for treating that error as a retryable
 * release (writer.release + short next_attempt_at).
 */
export interface CanadaCidStreamLoadResult {
  outcome: "downloaded" | "not_modified";
  sourceUrl: string;
  year: number;
  bytesConsumed: number;
  materialHash: string;
  etag?: string;
  lastModified?: string;
  publishedPeriod: string;
  rows: CanadaCidRow[];
  malformedRowCount: number;
  /** Total data rows in the source (not just retained). Reported in coverage.safe_metadata. */
  totalDataRows: number;
  /** Rows kept after HS6 filter. Equals `rows.length`. */
  retainedRows: number;
}

function setImmediateAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function fetchAndParseCanadaCidStream(input: {
  year: number;
  etag?: string;
  lastModified?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  canonicalHs6: ReadonlySet<string>;
  deadlineAt?: number;
  cleanupReserveMs?: number;
  onProgress?: () => void;
}): Promise<CanadaCidStreamLoadResult> {
  const sourceUrl = canadaCidByHs6ByCountryUrl(input.year);
  const cleanupReserveMs = input.cleanupReserveMs ?? 8_000;
  const budgetCheck = () => {
    if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt - cleanupReserveMs) {
      throw new CanadaCidRuntimeBudgetError(
        "Canada CID load exceeded runtime budget; releasing lease for retry.",
      );
    }
  };
  const headers: Record<string, string> = { Accept: "text/csv, application/octet-stream;q=0.5" };
  if (input.etag) headers["If-None-Match"] = input.etag;
  if (input.lastModified) headers["If-Modified-Since"] = input.lastModified;
  const response = await (input.fetchImpl ?? fetch)(sourceUrl, {
    headers, redirect: "follow", signal: input.signal, cache: "no-store",
  });
  if (response.status === 304) {
    return {
      outcome: "not_modified", sourceUrl, year: input.year, bytesConsumed: 0,
      materialHash: "", etag: input.etag, lastModified: input.lastModified,
      publishedPeriod: "", rows: [], malformedRowCount: 0, totalDataRows: 0, retainedRows: 0,
    };
  }
  if (!response.ok) {
    throw Object.assign(new Error("Canada CID request failed."), {
      status: response.status,
      code: response.status >= 500 || response.status === 429 ? "TRANSIENT_HTTP" : "HTTP_ERROR",
    });
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > CANADA_CID_MAX_BYTES) throw new CanadaCidParserError("Canada CID dataset exceeds bounded download size.", "CID_OVERSIZE");
  if (!response.body) throw new CanadaCidParserError("Canada CID response has no readable body.", "CID_CORRUPT_WORKBOOK");

  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bytesConsumed = 0;
  let magicClassified: "csv" | "html" | "xlsb" | "xls" | "empty" | null = null;
  let sampledForMagic = new Uint8Array(0);

  // Incremental CSV state machine.
  let carry = "";
  let inQuotes = false;
  let field = "";
  let currentRow: string[] = [];
  let lineIndex = 0;
  let header: string[] | null = null;
  let hs6Col = -1;
  let companyCol = -1;
  let countryCol = -1;
  let provinceCol = -1;
  let cityCol = -1;
  let postalCol = -1;
  let yearCol = -1;

  const out: CanadaCidRow[] = [];
  const seen = new Set<string>();
  let malformedRowCount = 0;
  let totalDataRows = 0;
  let publishedPeriod = "";

  function commitField(): void { currentRow.push(field); field = ""; }

  function commitRow(): void {
    lineIndex += 1;
    if (currentRow.length === 1 && currentRow[0].trim() === "") {
      currentRow = []; return;
    }
    if (!header) {
      header = currentRow.map((cell) => cell.trim());
      hs6Col = findHeader(header, REQUIRED_HEADERS.hs6);
      companyCol = findHeader(header, REQUIRED_HEADERS.company);
      countryCol = findHeader(header, REQUIRED_HEADERS.country);
      if (hs6Col < 0 || companyCol < 0 || countryCol < 0) {
        throw new CanadaCidParserError(
          "Canada CID CSV is missing one of HS6 / COMPANY / COUNTRY headers.",
          "CID_REQUIRED_HEADERS_MISSING",
        );
      }
      provinceCol = findHeader(header, OPTIONAL_HEADERS.province);
      cityCol = findHeader(header, OPTIONAL_HEADERS.city);
      postalCol = findHeader(header, OPTIONAL_HEADERS.postalCode);
      yearCol = findHeader(header, OPTIONAL_HEADERS.year);
      currentRow = []; return;
    }
    totalDataRows += 1;
    const rawHs6 = (currentRow[hs6Col] ?? "").trim();
    // Fast HS6 filter — skip normalization work for the 99.8% of
    // rows we never keep. Rows outside canonical MDF HS6s do not
    // increment malformedRowCount because they are legitimate rows
    // simply outside our research scope.
    if (!rawHs6 || !input.canonicalHs6.has(rawHs6.padStart(6, "0"))) {
      currentRow = []; return;
    }
    const hs6 = normalizeHs6(rawHs6);
    if (!hs6) { malformedRowCount += 1; currentRow = []; return; }
    const rawCompany = (currentRow[companyCol] ?? "").trim().replace(/\s+/g, " ");
    if (!rawCompany) { malformedRowCount += 1; currentRow = []; return; }
    const rawCountry = (currentRow[countryCol] ?? "").trim();
    const originCountry = normalizeCidCountry(rawCountry);
    if (!originCountry || !ISO2_PATTERN.test(originCountry)) { malformedRowCount += 1; currentRow = []; return; }
    const rawProvince = provinceCol >= 0 ? (currentRow[provinceCol] ?? "").trim() : "";
    const provinceCode = PROVINCE_PATTERN.test(rawProvince)
      ? rawProvince.toUpperCase()
      : (PROVINCE_NAME_TO_CODE[rawProvince] ?? undefined);
    const city = cityCol >= 0 ? (currentRow[cityCol] ?? "").trim().replace(/\s+/g, " ") : "";
    const postalCode = postalCol >= 0 ? (currentRow[postalCol] ?? "").trim() : "";
    const yearFromRow = yearCol >= 0 ? (currentRow[yearCol] ?? "").trim() : "";
    if (!publishedPeriod && /^\d{4}$/.test(yearFromRow)) publishedPeriod = yearFromRow;
    const key = `${hs6}\u0000${originCountry}\u0000${normalizeCompanyName(rawCompany)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        hs6, originCountry, companyName: rawCompany,
        province: provinceCode || undefined,
        city: city || undefined,
        postalCode: postalCode || undefined,
      });
    }
    currentRow = [];
  }

  function ingest(chunk: string): void {
    const text = carry + chunk;
    carry = "";
    let start = 0;
    const n = text.length;
    // Only process complete lines from the chunk; any trailing
    // partial line (or unclosed quote) becomes the next `carry`.
    // Simple approach: walk char-by-char applying the state machine.
    for (let i = 0; i < n; i += 1) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < n && text[i + 1] === '"') { field += '"'; i += 1; continue; }
          inQuotes = false; continue;
        }
        field += c; continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === ',') { commitField(); continue; }
      if (c === '\r') {
        commitField(); commitRow();
        if (i + 1 < n && text[i + 1] === '\n') i += 1;
        start = i + 1; continue;
      }
      if (c === '\n') { commitField(); commitRow(); start = i + 1; continue; }
      field += c;
    }
    // Preserve the tail (from `start` onwards) as carry if we're in
    // an unfinished field/quoted state. But since we've fed each
    // char into the state machine, the parser state is already
    // updated — nothing to defer. `carry` is only used across
    // chunks when the boundary lands mid-line; in that case we've
    // already accumulated the partial field in `field` and
    // `currentRow`, so the next chunk continues naturally.
    void start;
  }

  const reader = response.body.getReader();
  let firstChunk = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value as Uint8Array;
      if (bytesConsumed + chunk.byteLength > CANADA_CID_MAX_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new CanadaCidParserError("Canada CID dataset exceeds bounded download size.", "CID_OVERSIZE");
      }
      // Magic-byte classification on first chunk — reject HTML,
      // XLSB, XLS before parsing any of it as CSV.
      if (firstChunk) {
        sampledForMagic = chunk.subarray(0, Math.min(16, chunk.byteLength));
        magicClassified = classifyCanadaCidBody(sampledForMagic);
        if (magicClassified === "html") {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new CanadaCidParserError("Canada CID URL returned an HTML page, not the CSV dataset.", "CID_SOURCE_HTML");
        }
        if (magicClassified === "xlsb") {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new CanadaCidParserError("Canada CID URL returned an XLSB/XLSX workbook; adapter expects CSV.", "CID_XLSB_UNSUPPORTED");
        }
        if (magicClassified === "xls") {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new CanadaCidParserError("Canada CID URL returned a legacy XLS (BIFF/OLE2) workbook; adapter expects CSV.", "CID_LEGACY_XLS_UNSUPPORTED");
        }
        firstChunk = false;
      }
      hash.update(chunk);
      bytesConsumed += chunk.byteLength;
      const text = decoder.decode(chunk, { stream: true });
      ingest(text);
      // Yield + heartbeat + deadline check between chunks.
      if (input.onProgress) input.onProgress();
      await setImmediateAsync();
      budgetCheck();
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  // Flush trailing state.
  const flush = decoder.decode();
  if (flush) ingest(flush);
  if (inQuotes) throw new CanadaCidParserError("Canada CID CSV has unclosed quoted field.", "CID_CORRUPT_WORKBOOK");
  if (field.length > 0 || currentRow.length > 0) { commitField(); commitRow(); }

  if (bytesConsumed === 0) throw new CanadaCidParserError("Canada CID response body is empty.", "CID_CORRUPT_WORKBOOK");
  if (!header) throw new CanadaCidParserError("Canada CID CSV had no header row.", "CID_REQUIRED_HEADERS_MISSING");
  if (!publishedPeriod && out.length > 0) throw new CanadaCidParserError("Canada CID CSV has no DATA_YEAR column values.", "CID_REQUIRED_HEADERS_MISSING");
  if (!publishedPeriod) publishedPeriod = String(input.year);

  return {
    outcome: "downloaded",
    sourceUrl, year: input.year,
    bytesConsumed,
    materialHash: hash.digest("hex"),
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    publishedPeriod,
    rows: out,
    malformedRowCount,
    totalDataRows,
    retainedRows: out.length,
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

export async function fetchCanadaCidByHs6ByCountry(input: {
  year: number;
  etag?: string;
  lastModified?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<CanadaCidFetchResult> {
  const sourceUrl = canadaCidByHs6ByCountryUrl(input.year);
  const headers: Record<string, string> = {
    Accept: "text/csv, application/octet-stream;q=0.5",
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
  if (length > CANADA_CID_MAX_BYTES) throw new CanadaCidParserError("Canada CID dataset exceeds bounded download size.", "CID_OVERSIZE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > CANADA_CID_MAX_BYTES) throw new CanadaCidParserError("Canada CID dataset exceeds bounded download size.", "CID_OVERSIZE");
  // Reject non-CSV bodies at the fetch boundary so the parser never
  // sees them. HTML redirects / interstitials + accidental workbook
  // uploads on ISED are caught here with a specific error code.
  const kind = classifyCanadaCidBody(bytes);
  if (kind === "html") throw new CanadaCidParserError("Canada CID URL returned an HTML page, not the CSV dataset.", "CID_SOURCE_HTML");
  if (kind === "xls") throw new CanadaCidParserError("Canada CID URL returned a legacy XLS (BIFF/OLE2) workbook; adapter expects CSV.", "CID_LEGACY_XLS_UNSUPPORTED");
  if (kind === "xlsb") throw new CanadaCidParserError("Canada CID URL returned an XLSB/XLSX workbook; adapter expects CSV.", "CID_XLSB_UNSUPPORTED");
  return {
    outcome: "downloaded", bytes, sourceUrl, year: input.year,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    materialHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
