import type { MarketTradeObservation } from "../../types";
import {
  BACI_OEC_DATASET_ID,
  BACI_OEC_DATASET_PAGE,
  type BaciQuerySpec,
} from "./contract";
import { BaciCountryCodeError, fromBaciCountryId } from "./country";
import { canonicalizeBaciNumber } from "./numeric";

export type BaciFetchOutcome =
  | "partial"
  | "quota_exhausted"
  | "timeout"
  | "provider_error"
  | "invalid_request";

/**
 * Sanitized, server-only diagnostic attached to every BaciProviderError.
 * Values here are safe to log AND safe to surface as the maintenance layer's
 * `diagnostic` field back to the browser. It never contains the API key,
 * cookies, JWTs, session tokens, Authorization headers, or raw upstream
 * bodies larger than an operator-readable excerpt.
 */
export interface BaciErrorDiagnostic {
  stage:
    | "provider_http"
    | "provider_network"
    | "provider_timeout"
    | "provider_json"
    | "provider_schema"
    | "provider_row"
    | "provider_scope"
    | "provider_pagination";
  httpStatus?: number;
  /**
   * Category used by classifyBaciHttpFailure(). Serves as the operator-visible
   * error label. Keep values short and non-secret.
   */
  category?:
    | "auth_error"
    | "invalid_request"
    | "not_found"
    | "rate_limited"
    | "upstream_error"
    | "invalid_json"
    | "schema_error"
    | "row_shape"
    | "scope_violation"
    | "pagination_gap"
    | "row_count_mismatch"
    | "total_count_missing"
    | "provider_marked_partial"
    | "duplicate_rows"
    | "proof_budget_exceeded"
    | "total_count_changed"
    | "unsupported_quantity_unit"
    | "network_error"
    | "timeout";
  responseContentType?: string;
  /** Provider request-id header (x-request-id) if the response carried one. */
  providerRequestId?: string;
  /** Small, truncated safe excerpt of the upstream error body (<= 500 chars). */
  sanitizedBody?: string;
}

export class BaciProviderError extends Error {
  constructor(
    readonly outcome: BaciFetchOutcome,
    message: string,
    readonly retryAfter?: string,
    readonly reason?: string,
    readonly rowsReceived = 0,
    readonly diagnostic?: BaciErrorDiagnostic,
  ) {
    super(message);
    this.name = "BaciProviderError";
  }
}

/**
 * Truncate an arbitrary provider body to a short, operator-safe excerpt.
 * Strips secrets defensively — even though PostgREST / BotMarket do not echo
 * the bearer token, this hard-scrubs the two credential shapes MDF ever
 * emits and any long random-looking token before returning.
 */
export function sanitizeUpstreamExcerpt(body: string, max = 500): string {
  const scrubbed = body
    .replace(/bot_market_ak_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
}

/** Literal BotMarket baci-hs17 wire shape, including its misspelled unit field. */
export interface BaciWireRow {
  year: number;
  exporter_id: string;
  exporter_name: string;
  importer_id: string;
  importer_name: string;
  hs_code: string;
  product_name: string;
  /** Provider-owned integer; it is not MDF's canonical classification revision. */
  hs_revision: number;
  value: number;
  quantity: number | null;
  unit_abbrevation: string | null;
  unit_name: string | null;
}

/** Backward-compatible adapter name for a validated provider row. */
export type BaciRawRow = BaciWireRow;

export interface BaciQueryPage {
  rows: BaciWireRow[];
  totalRows: number;
  offset: number;
}

function rowError(message: string, category?: BaciErrorDiagnostic["category"]): BaciProviderError {
  return new BaciProviderError("provider_error", message, undefined, undefined, 0, {
    stage: "provider_row",
    category: category ?? "row_shape",
  });
}

function requiredNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw rowError(`BACI returned an invalid ${field}`);
  }
  return value;
}

function requiredNullableNonNegativeNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requiredNonNegativeNumber(value, field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw rowError(`BACI returned an invalid ${field}`);
  }
  return value.trim();
}

function requiredNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function providerCountry(value: unknown, field: "exporter_id" | "importer_id"): string {
  const id = requiredString(value, field);
  if (!/^[a-z]{3}$/.test(id)) {
    throw rowError(`BACI returned an invalid ${field}`);
  }
  try {
    fromBaciCountryId(id);
  } catch (error) {
    if (error instanceof BaciCountryCodeError) {
      throw rowError(`BACI returned an unsupported ${field}`);
    }
    throw error;
  }
  return id;
}

/** Validate the provider row before any field is renamed or normalized. */
export function parseBaciWireRow(value: unknown): BaciWireRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw rowError("BACI returned a non-object row");
  }
  const row = value as Record<string, unknown>;
  const year = row.year;
  const providerRevision = row.hs_revision;
  if (!Number.isInteger(year) || (year as number) <= 0) {
    throw rowError("BACI returned an invalid year");
  }
  if (!Number.isInteger(providerRevision) || (providerRevision as number) < 0) {
    throw rowError("BACI returned an invalid hs_revision");
  }
  const hsCode = requiredString(row.hs_code, "hs_code");
  if (!/^\d{6}$/.test(hsCode)) {
    throw rowError("BACI returned a non-six-digit hs_code");
  }
  const quantity = requiredNullableNonNegativeNumber(row.quantity, "quantity");
  const unitAbbrevation = requiredNullableString(row.unit_abbrevation, "unit_abbrevation");
  const unitName = requiredNullableString(row.unit_name, "unit_name");
  if (quantity !== null && unitAbbrevation !== "mt") {
    throw new BaciProviderError(
      "provider_error",
      "BACI returned a quantity with an unsupported unit",
      undefined,
      "unsupported_quantity_unit",
      0,
      { stage: "provider_row", category: "unsupported_quantity_unit" },
    );
  }
  return {
    year: year as number,
    exporter_id: providerCountry(row.exporter_id, "exporter_id"),
    exporter_name: requiredString(row.exporter_name, "exporter_name"),
    importer_id: providerCountry(row.importer_id, "importer_id"),
    importer_name: requiredString(row.importer_name, "importer_name"),
    hs_code: hsCode,
    product_name: requiredString(row.product_name, "product_name"),
    hs_revision: providerRevision as number,
    value: requiredNonNegativeNumber(row.value, "value"),
    quantity,
    unit_abbrevation: unitAbbrevation,
    unit_name: unitName,
  };
}

function assertProofScope(row: BaciWireRow, spec: BaciQuerySpec): void {
  const badScope = (msg: string) => new BaciProviderError(
    "provider_error", msg, undefined, undefined, 0,
    { stage: "provider_scope", category: "scope_violation" },
  );
  if (!spec.years.includes(row.year)) {
    throw badScope("BACI returned a year outside the requested scope");
  }
  if (row.hs_code !== spec.hsCode) {
    throw badScope("BACI returned a classification outside HS17 090421");
  }
  if (row.importer_id !== spec.importerId || (spec.exporterId && row.exporter_id !== spec.exporterId)) {
    throw badScope("BACI returned a country outside the requested scope");
  }
}

function requiredCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Zip a column-oriented BotMarket response (rows aligned positionally to
 * a `columns` header) into row objects keyed by the column name. This is
 * the live envelope shape BotMarket serves from
 * `/api/datasets/baci-hs17/query` and `/sample` — the very shape the
 * pre-fix parser rejected with "non-object row", collapsed to
 * `provider_error` and 502'd in production. Object-shaped rows still pass
 * through unchanged for backward compatibility with fixtures/tests.
 */
export function expandColumnOrientedRows(
  columns: readonly string[],
  rows: readonly unknown[],
): Array<Record<string, unknown>> {
  if (columns.length === 0) {
    throw new BaciProviderError(
      "provider_error", "BACI response declared no columns",
      undefined, undefined, 0,
      { stage: "provider_schema", category: "schema_error" },
    );
  }
  return rows.map((row) => {
    if (!Array.isArray(row)) {
      throw new BaciProviderError(
        "provider_error", "BACI row length does not match column header",
        undefined, undefined, 0,
        { stage: "provider_schema", category: "schema_error" },
      );
    }
    if (row.length !== columns.length) {
      throw new BaciProviderError(
        "provider_error", "BACI row length does not match column header",
        undefined, undefined, 0,
        { stage: "provider_schema", category: "schema_error" },
      );
    }
    const record: Record<string, unknown> = {};
    for (let index = 0; index < columns.length; index += 1) {
      record[columns[index]!] = row[index];
    }
    return record;
  });
}

/** Parse and scope-check one transport page; the coordinator proves completeness. */
export function parseBaciQueryPage(
  payload: unknown,
  spec: BaciQuerySpec,
  requestedOffset = 0,
): BaciQueryPage {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BaciProviderError(
      "provider_error", "BACI returned an invalid response envelope",
      undefined, undefined, 0,
      { stage: "provider_schema", category: "schema_error" },
    );
  }
  const envelope = payload as Record<string, unknown>;
  const rawRowsArray = Array.isArray(envelope.rows)
    ? envelope.rows
    : Array.isArray(envelope.data)
      ? envelope.data
      : undefined;
  if (!rawRowsArray) {
    throw new BaciProviderError(
      "provider_error", "BACI response did not contain rows",
      undefined, undefined, 0,
      { stage: "provider_schema", category: "schema_error" },
    );
  }
  const columns = Array.isArray(envelope.columns)
    ? envelope.columns.filter((c): c is string => typeof c === "string")
    : undefined;
  const isColumnOriented =
    columns !== undefined &&
    columns.length > 0 &&
    rawRowsArray.length > 0 &&
    rawRowsArray.every((r) => Array.isArray(r));
  const rawRows = isColumnOriented
    ? expandColumnOrientedRows(columns, rawRowsArray)
    : (rawRowsArray as unknown[]);
  const totalRows =
    requiredCount(envelope.total_count) ??
    requiredCount(envelope.total) ??
    requiredCount(envelope.count);
  if (totalRows === undefined) {
    throw new BaciProviderError(
      "partial", "BACI response did not contain a valid total count",
      undefined, "missing_total_count", rawRowsArray.length,
      { stage: "provider_schema", category: "total_count_missing" },
    );
  }
  if (envelope.partial === true) {
    throw new BaciProviderError(
      "partial", "BACI marked the response as partial",
      undefined, "provider_marked_partial", rawRowsArray.length,
      { stage: "provider_schema", category: "provider_marked_partial" },
    );
  }
  if (envelope.offset !== undefined && requiredCount(envelope.offset) !== requestedOffset) {
    throw new BaciProviderError(
      "partial", "BACI returned a page offset that does not match the request",
      undefined, "pagination_gap", rawRowsArray.length,
      { stage: "provider_pagination", category: "pagination_gap" },
    );
  }
  const rows = rawRows.map((rawRow) => {
    const row = parseBaciWireRow(rawRow);
    assertProofScope(row, spec);
    return row;
  });
  return { rows, totalRows, offset: requestedOffset };
}

export function baciRawRowIdentity(row: BaciWireRow): string {
  return `${row.year}|${row.exporter_id}|${row.importer_id}|${row.hs_code}`;
}

export function assertUniqueBaciRows(
  rows: readonly BaciWireRow[],
  rowsReceived = rows.length,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = baciRawRowIdentity(row);
    if (seen.has(key)) {
      throw new BaciProviderError(
        "partial",
        "BACI returned duplicate bilateral rows",
        undefined,
        "duplicate_rows",
        rowsReceived,
        { stage: "provider_schema", category: "duplicate_rows" },
      );
    }
    seen.add(key);
  }
}

/** Normalize provider rows; `baci-hs17` establishes canonical MDF HS17. */
export function normalizeBaciBilateralRows(
  rows: readonly BaciWireRow[],
  retrievedAt: string,
): MarketTradeObservation[] {
  assertUniqueBaciRows(rows);
  const observations = rows.map((row): MarketTradeObservation => ({
    providerId: "baci_oec",
    datasetId: BACI_OEC_DATASET_ID,
    reporterCountry: fromBaciCountryId(row.importer_id),
    partnerCountry: fromBaciCountryId(row.exporter_id),
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCode: row.hs_code,
    frequency: "annual",
    period: String(row.year),
    tradeValueUsd: canonicalizeBaciNumber(row.value),
    quantity: row.quantity === null ? null : canonicalizeBaciNumber(row.quantity),
    quantityUnit: row.quantity === null ? null : "tonne",
    netWeightKg: null,
    sourcePeriod: String(row.year),
    retrievedAt,
    sourceUrl: BACI_OEC_DATASET_PAGE,
    safeReference: `OEC BotMarket ${BACI_OEC_DATASET_ID}`,
    metadata: {
      mapping: "trade_proxy",
      source_row_kind: "bilateral_raw",
      provider_exporter_id: row.exporter_id,
      provider_importer_id: row.importer_id,
      provider_hs_revision: row.hs_revision,
      provider_quantity_unit: row.unit_name ?? row.unit_abbrevation,
    },
  }));
  return observations.sort((a, b) =>
    a.period.localeCompare(b.period) ||
    (a.partnerCountry ?? "").localeCompare(b.partnerCountry ?? ""),
  );
}
