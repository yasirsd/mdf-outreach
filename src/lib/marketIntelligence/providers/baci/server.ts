import "server-only";

import { decideMarketFetchWithLedger, type FetchLedgerLoader } from "../../fetchLedgerReader";
import { assertFreeMarketProviderExecution } from "../../providerExecution";
import { MI_PROVIDER_SELECTION_VERSION } from "../../providerSelection";
import { BACI_OEC_PROVIDER } from "../../providers";
import type { MarketProviderQuotaState } from "../../types";
import type {
  MarketFetchLedgerRecordResult,
  MarketFetchLedgerWriteInput,
} from "../../server/types";
import {
  BACI_OEC_DATASET_ID,
  baciQueryFingerprint,
  baciQueryUrl,
  type BaciQuerySpec,
} from "./contract";
import {
  BaciProviderError,
  assertUniqueBaciRows,
  parseBaciQueryPage,
  type BaciQueryPage,
  type BaciRawRow,
} from "./normalize";

const BACI_OEC_API_KEY_ENV = "BACI_OEC_API_KEY";
const DEFAULT_TIMEOUT_MS = 20_000;
const FRESH_FOR_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PROOF_ROWS = 2_000;

export class BaciOecConfigError extends Error {
  constructor() {
    super("BACI/OEC provider is not configured in the server environment");
    this.name = "BaciOecConfigError";
  }
}

export interface BaciHttpOptions {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  quotaState?: MarketProviderQuotaState;
  timeoutMs?: number;
}

export interface BaciCompleteQueryResult {
  rows: BaciRawRow[];
  totalRows: number;
  pagesFetched: 1 | 2;
  latestAvailablePeriod: string | null;
}

function apiKeyFrom(env: NodeJS.ProcessEnv): string {
  const key = env[BACI_OEC_API_KEY_ENV]?.trim();
  if (!key) throw new BaciOecConfigError();
  return key;
}

function assertEligible(spec: BaciQuerySpec, options: BaciHttpOptions): string {
  const key = apiKeyFrom(options.env ?? process.env);
  assertFreeMarketProviderExecution(BACI_OEC_PROVIDER, {
    capability: spec.capability,
    reporterCountry: spec.reporterCountry,
    hsRevision: "HS17",
    frequency: "annual",
    hasKey: true,
    quotaState: options.quotaState ?? "unknown",
    persistentIngestion: true,
  });
  return key;
}

function retryAfterIso(response: Response, now: Date): string | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

async function fetchPage(
  spec: BaciQuerySpec,
  offset: number,
  key: string,
  options: BaciHttpOptions,
): Promise<BaciQueryPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(baciQueryUrl(spec, offset), {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${key}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new BaciProviderError(
        "quota_exhausted",
        "BACI/OEC free access is temporarily unavailable",
        retryAfterIso(response, new Date()),
      );
    }
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      throw new BaciProviderError("invalid_request", "BACI/OEC rejected the controlled query");
    }
    if (!response.ok) {
      throw new BaciProviderError("provider_error", "BACI/OEC returned an unsuccessful response");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BaciProviderError("provider_error", "BACI/OEC returned invalid JSON");
    }
    return parseBaciQueryPage(payload, spec, offset);
  } catch (error) {
    if (error instanceof BaciProviderError || error instanceof BaciOecConfigError) throw error;
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw new BaciProviderError("timeout", "BACI/OEC request timed out");
    }
    throw new BaciProviderError("provider_error", "BACI/OEC request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function partial(reason: string, rowsReceived: number): BaciProviderError {
  return new BaciProviderError(
    "partial",
    "BACI/OEC result could not be proven complete",
    undefined,
    reason,
    rowsReceived,
  );
}

/** One logical query, using at most two reviewed transport pages. */
export async function fetchBaciQuery(
  spec: BaciQuerySpec,
  options: BaciHttpOptions = {},
): Promise<BaciCompleteQueryResult> {
  const key = assertEligible(spec, options);
  const first = await fetchPage(spec, 0, key, options);
  if (first.totalRows > MAX_PROOF_ROWS) {
    throw partial("proof_budget_exceeded", first.rows.length);
  }
  if (first.totalRows <= spec.limit) {
    if (first.rows.length !== first.totalRows) {
      throw partial("row_count_mismatch", first.rows.length);
    }
    assertUniqueBaciRows(first.rows);
    return {
      rows: first.rows,
      totalRows: first.totalRows,
      pagesFetched: 1,
      latestAvailablePeriod: latestPeriod(first.rows),
    };
  }
  if (first.rows.length !== spec.limit) {
    throw partial("pagination_gap", first.rows.length);
  }
  assertUniqueBaciRows(first.rows);
  const second = await fetchPage(spec, spec.limit, key, options);
  const combined = [...first.rows, ...second.rows];
  if (second.totalRows !== first.totalRows) {
    throw partial("total_count_changed", combined.length);
  }
  if (second.rows.length !== first.totalRows - spec.limit || combined.length !== first.totalRows) {
    throw partial("pagination_gap", combined.length);
  }
  assertUniqueBaciRows(combined, combined.length);
  return {
    rows: combined,
    totalRows: first.totalRows,
    pagesFetched: 2,
    latestAvailablePeriod: latestPeriod(combined),
  };
}

function latestPeriod(rows: readonly BaciRawRow[]): string | null {
  if (rows.length === 0) return null;
  return String(Math.max(...rows.map((row) => row.year)));
}

export type BaciLedgerRecorder = (
  input: MarketFetchLedgerWriteInput,
) => Promise<MarketFetchLedgerRecordResult>;

export interface BaciLedgerExecutionOptions extends BaciHttpOptions {
  loadLedger: FetchLedgerLoader;
  recordFetchResult: BaciLedgerRecorder;
  now?: () => Date;
}

export type BaciLedgerExecutionResult =
  | { outcome: "use_cache"; queryFingerprint: string; expectedRows: number }
  | { outcome: "blocked"; reason: string; queryFingerprint: string }
  | {
      outcome: "fetched";
      result: BaciCompleteQueryResult;
      queryFingerprint: string;
      /** Record only after every raw bilateral observation has persisted. */
      completionLedgerRecord: MarketFetchLedgerWriteInput;
    };

function ledgerInput(
  spec: BaciQuerySpec,
  fingerprint: string,
  fetchedAt: Date,
  outcome: MarketFetchLedgerWriteInput["outcome"],
  rowsReceived: number,
  retryAfter?: string,
  reason?: string,
  pagesFetched?: number,
): MarketFetchLedgerWriteInput {
  const freshUntil = outcome === "success" || outcome === "empty"
    ? new Date(fetchedAt.getTime() + FRESH_FOR_MS)
    : retryAfter
      ? new Date(retryAfter)
      : fetchedAt;
  return {
    providerId: "baci_oec",
    datasetId: BACI_OEC_DATASET_ID,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: [spec.hsCode],
    frequency: "annual",
    providerSelectionVersion: MI_PROVIDER_SELECTION_VERSION,
    coverageStart: String(Math.min(...spec.years)),
    coverageEnd: String(Math.max(...spec.years)),
    fetchedAt: fetchedAt.toISOString(),
    freshUntil: freshUntil.toISOString(),
    outcome,
    rowsReceived,
    query_fingerprint: fingerprint,
    reporter_country: spec.reporterCountry,
    partner_country: spec.partnerCountry,
    trade_flow: "import",
    hs_revision: "HS17",
    hs_codes: [spec.hsCode],
    coverage_start: String(Math.min(...spec.years)),
    coverage_end: String(Math.max(...spec.years)),
    provider_selection_version: MI_PROVIDER_SELECTION_VERSION,
    fetched_at: fetchedAt.toISOString(),
    fresh_until: freshUntil.toISOString(),
    rows_received: rowsReceived,
    provider_id: "baci_oec",
    dataset_id: BACI_OEC_DATASET_ID,
    retryAfter,
    safe_metadata: {
      query_kind: spec.kind,
      row_limit: spec.limit,
      max_pages: 2,
      ...(pagesFetched === undefined ? {} : { pages_fetched: pagesFetched }),
      ...(reason ? { failure_reason: reason } : {}),
    },
  };
}

/** Ledger-gated single logical fetch; pagination never creates extra identities. */
export async function fetchBaciQueryWithLedger(
  spec: BaciQuerySpec,
  options: BaciLedgerExecutionOptions,
): Promise<BaciLedgerExecutionResult> {
  assertEligible(spec, options);
  const fingerprint = baciQueryFingerprint(spec);
  const now = (options.now ?? (() => new Date()))();
  const decision = await decideMarketFetchWithLedger({
    providerId: "baci_oec",
    datasetId: BACI_OEC_DATASET_ID,
    queryFingerprint: fingerprint,
    coverageStart: String(Math.min(...spec.years)),
    coverageEnd: String(Math.max(...spec.years)),
    now,
  }, options.loadLedger);
  if (decision.decision === "use_cache") {
    return {
      outcome: "use_cache",
      queryFingerprint: fingerprint,
      expectedRows: decision.entry?.rowsReceived ?? 0,
    };
  }
  if (decision.decision === "blocked") {
    return { outcome: "blocked", reason: decision.reason, queryFingerprint: fingerprint };
  }

  try {
    const result = await fetchBaciQuery(spec, options);
    const completionLedgerRecord = ledgerInput(
      spec,
      fingerprint,
      now,
      result.rows.length === 0 ? "empty" : "success",
      result.rows.length,
      undefined,
      undefined,
      result.pagesFetched,
    );
    if (result.rows.length === 0) await options.recordFetchResult(completionLedgerRecord);
    return { outcome: "fetched", result, queryFingerprint: fingerprint, completionLedgerRecord };
  } catch (error) {
    if (error instanceof BaciProviderError) {
      await options.recordFetchResult(ledgerInput(
        spec,
        fingerprint,
        now,
        error.outcome,
        error.rowsReceived,
        error.retryAfter,
        error.reason,
      ));
    }
    throw error;
  }
}
