import type {
  CountryAlpha2,
  HsRevision,
  MarketDataFrequency,
  MarketProviderFetchLedgerEntry,
  MarketTradeFlow,
} from "./types";

export const MARKET_QUERY_FINGERPRINT_VERSION = "mi-query-v1";

export interface MarketQueryFingerprintInput {
  providerId: string;
  datasetId: string;
  reporterCountry: CountryAlpha2;
  partnerCountry?: CountryAlpha2 | null;
  tradeFlow: MarketTradeFlow;
  hsRevision: HsRevision;
  hsCodes: string[];
  frequency: MarketDataFrequency;
  coverageStart: string;
  coverageEnd: string;
  providerSelectionVersion: string;
}

function field(value: string): string {
  return encodeURIComponent(value.trim());
}

/**
 * Deterministic, inspectable query identity. Only typed material dimensions
 * are read, so API keys, cookies, and other caller metadata cannot enter it.
 */
export function marketQueryFingerprint(input: MarketQueryFingerprintInput): string {
  const hsCodes = [...new Set(input.hsCodes.map((code) => code.trim()).filter(Boolean))]
    .sort()
    .join(",");
  return [
    MARKET_QUERY_FINGERPRINT_VERSION,
    field(input.providerId),
    field(input.datasetId),
    field(input.reporterCountry.toUpperCase()),
    field(input.partnerCountry?.toUpperCase() ?? "*"),
    field(input.tradeFlow),
    field(input.hsRevision),
    field(hsCodes),
    field(input.frequency),
    field(input.coverageStart),
    field(input.coverageEnd),
    field(input.providerSelectionVersion),
  ].join("|");
}

export type MarketFetchDecisionReason =
  | "no_cache_entry"
  | "fresh_success"
  | "fresh_empty"
  | "stale_cache"
  | "incomplete_coverage"
  | "partial_result"
  | "retry_timeout"
  | "retry_provider_error"
  | "quota_exhausted"
  | "quota_recovery_reached"
  | "invalid_request"
  | "provider_cooldown"
  | "provider_cooldown_elapsed";

export interface MarketFetchDecision {
  decision: "use_cache" | "fetch" | "blocked";
  reason: MarketFetchDecisionReason;
  entry?: MarketProviderFetchLedgerEntry;
}

export interface ShouldFetchMarketDataInput {
  providerId: string;
  datasetId: string;
  queryFingerprint: string;
  coverageStart: string;
  coverageEnd: string;
  now: Date;
  entries: MarketProviderFetchLedgerEntry[];
}

function validTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function covers(entry: MarketProviderFetchLedgerEntry, start: string, end: string): boolean {
  return entry.coverageStart <= start && entry.coverageEnd >= end;
}

/** Pure cache/retry decision. It never performs I/O. */
export function shouldFetchMarketData(input: ShouldFetchMarketDataInput): MarketFetchDecision {
  const matches = input.entries
    .filter(
      (entry) =>
        entry.providerId === input.providerId &&
        entry.datasetId === input.datasetId &&
        entry.queryFingerprint === input.queryFingerprint,
    )
    .sort((a, b) => (validTime(b.fetchedAt) ?? 0) - (validTime(a.fetchedAt) ?? 0));
  const entry = matches[0];
  if (!entry) return { decision: "fetch", reason: "no_cache_entry" };

  if (!covers(entry, input.coverageStart, input.coverageEnd)) {
    return { decision: "fetch", reason: "incomplete_coverage", entry };
  }

  const now = input.now.getTime();
  const freshUntil = validTime(entry.freshUntil);
  if (entry.outcome === "success" || entry.outcome === "empty") {
    if (freshUntil !== undefined && freshUntil > now) {
      return {
        decision: "use_cache",
        reason: entry.outcome === "success" ? "fresh_success" : "fresh_empty",
        entry,
      };
    }
    return { decision: "fetch", reason: "stale_cache", entry };
  }
  if (entry.outcome === "partial") {
    return { decision: "fetch", reason: "partial_result", entry };
  }
  if (entry.outcome === "timeout") {
    return { decision: "fetch", reason: "retry_timeout", entry };
  }
  if (entry.outcome === "provider_error") {
    return { decision: "fetch", reason: "retry_provider_error", entry };
  }
  if (entry.outcome === "quota_exhausted") {
    const retryAfter = validTime(entry.retryAfter);
    return retryAfter !== undefined && retryAfter <= now
      ? { decision: "fetch", reason: "quota_recovery_reached", entry }
      : { decision: "blocked", reason: "quota_exhausted", entry };
  }
  if (entry.outcome === "invalid_request") {
    return { decision: "blocked", reason: "invalid_request", entry };
  }
  const retryAfter = validTime(entry.retryAfter);
  return retryAfter !== undefined && retryAfter <= now
    ? { decision: "fetch", reason: "provider_cooldown_elapsed", entry }
    : { decision: "blocked", reason: "provider_cooldown", entry };
}
