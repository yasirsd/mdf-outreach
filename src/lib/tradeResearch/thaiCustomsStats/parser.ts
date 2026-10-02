/**
 * TH04A — Thai Customs Data Catalog CSV parser.
 *
 * Source: dataset `ctm_06_11` "Imports by country of origin"
 * published by the Thai Customs Department on the official
 * Customs Data Catalog. One monthly CSV resource per period.
 *
 * The parser is deterministic, UTF-8-aware (BOM-safe), and quoted-
 * CSV safe. It never silently accepts an unexpected header set:
 * schema mismatches throw `ThaiCustomsStatsParserError` with a
 * safe error code, which the executor translates into a T12 v2
 * `quarantined` certification outcome.
 */

export const THAI_CUSTOMS_STATS_PARSER_VERSION = "thai-customs-stats-csv-v1" as const;
export const THAI_CUSTOMS_STATS_INTERPRETATION_VERSION = "thai-customs-stats-csv-v1:t08-v1" as const;
export const THAI_CUSTOMS_STATS_DATASET_ID = "ctm_06_11" as const;

export class ThaiCustomsStatsParserError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ThaiCustomsStatsParserError";
  }
}

export interface ThaiCustomsStatsRow {
  year: number;
  month: number;
  hs8: string;
  statisticalCode: string | null;
  statisticalUnit: string | null;
  thaiDescription: string | null;
  englishDescription: string | null;
  quantityOrWeight: number | null;
  originCountryCode: string;
  importValueThb: number | null;
}

/** Canonical column names, order-independent. Thai + English accepted. */
const REQUIRED_COLUMNS = {
  year: ["year", "ปี"],
  month: ["month", "เดือน"],
  hs8: ["hs8", "hs 8", "hs-code", "hs code", "พิกัดศุลกากร", "พิกัด"],
  statisticalCode: ["statistical_code", "statistical code", "stat_code", "stat code", "รหัสสถิติ"],
  statisticalUnit: ["statistical_unit", "statistical unit", "stat_unit", "stat unit", "หน่วยสถิติ", "unit"],
  thaiDescription: ["thai_description", "thai description", "description_th", "คำอธิบาย", "รายละเอียด"],
  englishDescription: ["english_description", "english description", "description_en", "description"],
  quantityOrWeight: ["quantity", "weight", "statistical_quantity", "stat_quantity", "ปริมาณ", "น้ำหนัก"],
  originCountryCode: ["country_of_origin", "country of origin", "origin_country", "country_code", "country", "ประเทศกำเนิด", "รหัสประเทศ"],
  importValueThb: ["import_value", "import value", "value_thb", "value", "มูลค่า", "มูลค่านำเข้า", "fob_baht", "fob (baht)", "fob baht"],
};

type ColumnMap = Record<keyof typeof REQUIRED_COLUMNS, number>;

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

/** RFC-4180-ish line splitter that honours quoted commas and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(field); field = ""; }
      else field += ch;
    }
  }
  result.push(field);
  return result;
}

function normalizeHeader(h: string): string {
  return h.replace(/[​‌‍﻿]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildColumnMap(headerRow: readonly string[]): ColumnMap {
  const normalized = headerRow.map(normalizeHeader);
  const map: Partial<ColumnMap> = {};
  for (const key of Object.keys(REQUIRED_COLUMNS) as Array<keyof typeof REQUIRED_COLUMNS>) {
    const aliases = REQUIRED_COLUMNS[key];
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index < 0) {
      throw new ThaiCustomsStatsParserError(
        "SCHEMA_MISSING_COLUMN",
        `Thai Customs Data Catalog CSV missing required column for "${key}" (expected one of: ${aliases.join(", ")}; observed headers: ${normalized.join(", ")}).`,
      );
    }
    map[key] = index;
  }
  return map as ColumnMap;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Strip thousands separators (comma or Thai `,`). Keep decimal `.`.
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toInt(value: string | undefined, field: string): number {
  const n = toNumber(value);
  if (n === null || !Number.isInteger(n)) {
    throw new ThaiCustomsStatsParserError(
      "MALFORMED_INTEGER_FIELD",
      `Field "${field}" must be an integer in the Thai Customs Data Catalog CSV; got ${JSON.stringify(value)}.`,
    );
  }
  return n;
}

/**
 * Parse the entire CSV body. Does NOT filter rows — the caller
 * filters by HS8 / origin after parsing to keep concerns separate.
 */
export function parseThaiCustomsStatsCsv(csvBody: string): ThaiCustomsStatsRow[] {
  if (typeof csvBody !== "string" || !csvBody.length) {
    throw new ThaiCustomsStatsParserError("EMPTY_CSV", "Thai Customs Data Catalog CSV body is empty.");
  }
  const stripped = stripBom(csvBody);
  // Split on \r\n or \n; tolerate the last trailing newline.
  const lines = stripped.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 1) {
    throw new ThaiCustomsStatsParserError("EMPTY_CSV", "Thai Customs Data Catalog CSV has no header row.");
  }
  const columns = buildColumnMap(splitCsvLine(lines[0]!));
  const rows: ThaiCustomsStatsRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]!);
    const hs8Raw = toText(cells[columns.hs8]);
    const originRaw = toText(cells[columns.originCountryCode]);
    if (!hs8Raw || !originRaw) {
      // A row with no HS or no origin is malformed; skip conservatively
      // (we don't quarantine the whole dataset over a single bad row,
      // but we also don't fabricate values).
      continue;
    }
    rows.push({
      year: toInt(cells[columns.year], "year"),
      month: toInt(cells[columns.month], "month"),
      hs8: hs8Raw,
      statisticalCode: toText(cells[columns.statisticalCode]),
      statisticalUnit: toText(cells[columns.statisticalUnit]),
      thaiDescription: toText(cells[columns.thaiDescription]),
      englishDescription: toText(cells[columns.englishDescription]),
      quantityOrWeight: toNumber(cells[columns.quantityOrWeight]),
      originCountryCode: originRaw.toUpperCase(),
      importValueThb: toNumber(cells[columns.importValueThb]),
    });
  }
  return rows;
}

/**
 * Deterministic filter: keep rows matching the given 8-digit tariff
 * code and (optionally) origin country code. Multiple statistical-
 * code suffixes under the same HS8 are preserved and surface
 * naturally as separate rows the aggregator sums.
 */
export function filterThaiCustomsStatsRows(
  rows: readonly ThaiCustomsStatsRow[],
  input: { hs8: string; originCountryCode?: string },
): ThaiCustomsStatsRow[] {
  const originUpper = input.originCountryCode?.toUpperCase();
  return rows.filter((r) => r.hs8 === input.hs8 && (originUpper === undefined || r.originCountryCode === originUpper));
}
