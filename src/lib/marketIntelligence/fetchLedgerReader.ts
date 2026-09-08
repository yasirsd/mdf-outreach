/**
 * MI1C — durable fetch-ledger reader.
 *
 * Pairs the pure `shouldFetchMarketData` decision helper with a
 * data-loader function that hydrates the recent ledger entries for a
 * given query. No I/O in this module — callers pass the loader.
 *
 * Callers keep TypeScript as the sole decision authority. The reader
 * never invents entries; if the loader returns none, the decision
 * naturally becomes `fetch / no_cache_entry`.
 */

import { shouldFetchMarketData, type MarketFetchDecision, type ShouldFetchMarketDataInput } from "./fetchLedger";
import type { MarketProviderFetchLedgerEntry } from "./types";

export interface FetchLedgerReaderQuery {
  providerId: string;
  datasetId: string;
  queryFingerprint: string;
  coverageStart: string;
  coverageEnd: string;
  now?: Date;
}

/**
 * Loader shape. The MI1D/MI2 server orchestrator provides a Supabase-
 * backed implementation; tests inject a controlled fixture. The
 * loader MUST return entries newest-first (or unordered) — the
 * decision helper sorts internally.
 */
export type FetchLedgerLoader = (
  input: Pick<FetchLedgerReaderQuery, "providerId" | "datasetId" | "queryFingerprint">,
) => Promise<MarketProviderFetchLedgerEntry[]>;

export async function decideMarketFetchWithLedger(
  query: FetchLedgerReaderQuery,
  loader: FetchLedgerLoader,
): Promise<MarketFetchDecision> {
  const entries = await loader({
    providerId: query.providerId,
    datasetId: query.datasetId,
    queryFingerprint: query.queryFingerprint,
  });
  const input: ShouldFetchMarketDataInput = {
    providerId: query.providerId,
    datasetId: query.datasetId,
    queryFingerprint: query.queryFingerprint,
    coverageStart: query.coverageStart,
    coverageEnd: query.coverageEnd,
    now: query.now ?? new Date(),
    entries,
  };
  return shouldFetchMarketData(input);
}
