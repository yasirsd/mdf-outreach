import "server-only";

import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";

export const FDA_FSVP_DATASET_ID = "fsvp-participant-list" as const;
export const FDA_FSVP_SOURCE_URL = "https://www.fda.gov/media/186093/download" as const;
export const FDA_FSVP_PARSE_VERSION = "fsvp-xlsx-v1" as const;
export const FDA_FSVP_MAX_BYTES = 10 * 1024 * 1024;

export interface FdaFsvpRow { companyName: string; stateCode: string }

export interface ParsedFdaFsvpDataset {
  publishedPeriod: string;
  rows: FdaFsvpRow[];
  malformedRowCount: number;
}

export class FdaFsvpParserError extends Error {
  readonly code = "PARSER_INCOMPATIBLE";
  constructor(message: string) { super(message); this.name = "FdaFsvpParserError"; }
}

function xmlDecode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"").replaceAll("&apos;", "'");
}

function textNodes(xml: string): string {
  return Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (match) => xmlDecode(match[1])).join("");
}

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g), (match) => textNodes(match[1]));
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

export function parseFdaFsvpXlsx(bytes: Uint8Array): ParsedFdaFsvpDataset {
  let archive: Record<string, Uint8Array>;
  try { archive = unzipSync(bytes); } catch { throw new FdaFsvpParserError("FDA workbook is not a valid XLSX archive."); }
  const sheetBytes = archive["xl/worksheets/sheet1.xml"];
  if (!sheetBytes) throw new FdaFsvpParserError("FDA workbook does not contain the expected first worksheet.");
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
  return parseFdaFsvpRows(matrix);
}

export function parseFdaFsvpRows(matrix: readonly Record<string, string>[]): ParsedFdaFsvpDataset {
  const headerIndex = matrix.findIndex((row) =>
    Object.values(row).some((value) => value.trim() === "Firm Legal Name") &&
    Object.values(row).some((value) => value.trim() === "State Code"),
  );
  if (headerIndex < 0) throw new FdaFsvpParserError("FDA workbook headers changed; expected Firm Legal Name and State Code.");
  const header = matrix[headerIndex];
  const nameColumn = Object.keys(header).find((key) => header[key].trim() === "Firm Legal Name");
  const stateColumn = Object.keys(header).find((key) => header[key].trim() === "State Code");
  if (!nameColumn || !stateColumn) throw new FdaFsvpParserError("FDA workbook header mapping is incomplete.");
  const title = matrix.slice(0, headerIndex).flatMap((row) => Object.values(row)).find(Boolean) ?? "";
  const period = /([A-Z][a-z]+ \d{1,2}, \d{4}\s*[–-]\s*[A-Z][a-z]+ \d{1,2}, \d{4})/.exec(title)?.[1];
  if (!period) throw new FdaFsvpParserError("FDA workbook publication period is missing.");
  const seen = new Set<string>();
  const rows: FdaFsvpRow[] = [];
  let malformedRowCount = 0;
  for (const row of matrix.slice(headerIndex + 1)) {
    const companyName = (row[nameColumn] ?? "").trim().replace(/\s+/g, " ");
    const stateCode = (row[stateColumn] ?? "").trim().toUpperCase();
    if (!companyName && !stateCode) continue;
    if (!companyName || !/^[A-Z]{2}$/.test(stateCode)) { malformedRowCount += 1; continue; }
    const key = `${companyName.toUpperCase()}\u0000${stateCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ companyName, stateCode });
  }
  return { publishedPeriod: period.replace("-", "–"), rows, malformedRowCount };
}

const LEGAL_SUFFIXES = new Set(["LLC","L L C","INC","INCORPORATED","CORP","CORPORATION","CO","COMPANY","LTD","LIMITED","LP","L P","LLP","PLC"]);

export function normalizeCompanyName(value: string): string {
  const words = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

const STATE_NAMES: Record<string, string> = {
  ALABAMA:"AL",ALASKA:"AK",ARIZONA:"AZ",ARKANSAS:"AR",CALIFORNIA:"CA",COLORADO:"CO",CONNECTICUT:"CT",DELAWARE:"DE",FLORIDA:"FL",GEORGIA:"GA",HAWAII:"HI",IDAHO:"ID",ILLINOIS:"IL",INDIANA:"IN",IOWA:"IA",KANSAS:"KS",KENTUCKY:"KY",LOUISIANA:"LA",MAINE:"ME",MARYLAND:"MD",MASSACHUSETTS:"MA",MICHIGAN:"MI",MINNESOTA:"MN",MISSISSIPPI:"MS",MISSOURI:"MO",MONTANA:"MT",NEBRASKA:"NE",NEVADA:"NV","NEW HAMPSHIRE":"NH","NEW JERSEY":"NJ","NEW MEXICO":"NM","NEW YORK":"NY","NORTH CAROLINA":"NC","NORTH DAKOTA":"ND",OHIO:"OH",OKLAHOMA:"OK",OREGON:"OR",PENNSYLVANIA:"PA","RHODE ISLAND":"RI","SOUTH CAROLINA":"SC","SOUTH DAKOTA":"SD",TENNESSEE:"TN",TEXAS:"TX",UTAH:"UT",VERMONT:"VT",VIRGINIA:"VA",WASHINGTON:"WA","WEST VIRGINIA":"WV",WISCONSIN:"WI",WYOMING:"WY","DISTRICT OF COLUMBIA":"DC",
};

export function extractUsState(address?: string, city?: string): string | undefined {
  const raw = [address, city].filter(Boolean).join(", ").trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  for (const [name, code] of Object.entries(STATE_NAMES).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${name.replaceAll(" ", "\\s+")}\\b`).test(upper)) return code;
  }
  const codes = new Set(Object.values(STATE_NAMES));
  const explicit = /(?:,\s*|\s)([A-Z]{2})(?=\s+\d{5}(?:-\d{4})?\b|\s*$|\s*,)/g;
  for (const match of upper.matchAll(explicit)) if (codes.has(match[1])) return match[1];
  return undefined;
}

export interface FdaFsvpMatchResult {
  decision: "exact" | "strong" | "ambiguous" | "rejected" | "none";
  reason: string;
  candidateState?: string;
  matchedRows: FdaFsvpRow[];
}

export function matchFdaFsvpCompany(input: {
  companyName: string;
  address?: string;
  city?: string;
  rows: readonly FdaFsvpRow[];
}): FdaFsvpMatchResult {
  const normalized = normalizeCompanyName(input.companyName);
  const candidateState = extractUsState(input.address, input.city);
  if (!normalized) return { decision: "none", reason: "Candidate company name is empty after normalization.", candidateState, matchedRows: [] };
  const deduped = new Map<string, FdaFsvpRow>();
  for (const row of input.rows) {
    if (normalizeCompanyName(row.companyName) !== normalized) continue;
    deduped.set(`${normalizeCompanyName(row.companyName)}\u0000${row.stateCode}`, row);
  }
  const matches = [...deduped.values()];
  if (!matches.length) return { decision: "none", reason: "No normalized company-name match in the checked FDA dataset.", candidateState, matchedRows: [] };
  if (!candidateState) return { decision: "ambiguous", reason: "Name matched, but the candidate has no unambiguous U.S. state for corroboration.", matchedRows: matches };
  const sameState = matches.filter((row) => row.stateCode === candidateState);
  if (sameState.length) return { decision: "strong", reason: "Normalized company name and U.S. state match with no conflicting identity field.", candidateState, matchedRows: sameState };
  return { decision: "rejected", reason: "A normalized name match exists, but every FDA row has a conflicting state.", candidateState, matchedRows: matches };
}

export interface FdaFsvpFetchResult {
  outcome: "downloaded" | "not_modified";
  bytes?: Uint8Array;
  etag?: string;
  lastModified?: string;
  materialHash?: string;
}

export async function fetchFdaFsvpDataset(input: {
  etag?: string;
  lastModified?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<FdaFsvpFetchResult> {
  const headers: Record<string, string> = { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (input.etag) headers["If-None-Match"] = input.etag;
  if (input.lastModified) headers["If-Modified-Since"] = input.lastModified;
  const response = await (input.fetchImpl ?? fetch)(FDA_FSVP_SOURCE_URL, { headers, redirect: "follow", signal: input.signal, cache: "no-store" });
  if (response.status === 304) return { outcome: "not_modified", etag: input.etag, lastModified: input.lastModified };
  if (!response.ok) throw Object.assign(new Error("FDA dataset request failed."), { status: response.status, code: response.status >= 500 || response.status === 429 ? "TRANSIENT_HTTP" : "HTTP_ERROR" });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("spreadsheetml.sheet")) throw new FdaFsvpParserError("FDA response is not the published XLSX dataset.");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > FDA_FSVP_MAX_BYTES) throw new FdaFsvpParserError("FDA dataset exceeds the bounded download size.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > FDA_FSVP_MAX_BYTES) throw new FdaFsvpParserError("FDA dataset exceeds the bounded download size.");
  return {
    outcome: "downloaded", bytes,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
    materialHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
