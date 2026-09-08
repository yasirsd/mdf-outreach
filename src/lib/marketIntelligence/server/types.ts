import "server-only";

/**
 * MI1C — types for the SERVER-ONLY writer. Every field passed to the
 * writer is a server-derived value; the browser never crafts these.
 */

import type { ProductTradeMappingSnapshot } from "../product";
import type {
  MarketDataFrequency,
  MarketProviderFetchLedgerEntry,
  MarketTradeFlow,
} from "../types";

export type { ProductTradeMappingSnapshot };

export interface MarketIngestionResult {
  outcome: "created" | "existing" | "conflict";
  id: string;
  reason?: "material_mismatch";
}

export interface MarketSourceIngestionInput {
  provider_id: string;
  dataset_id: string;
  source_tier: "A" | "B" | "C" | "D" | "E";
  dataset_source: string;
  dataset_license_name?: string;
  dataset_license_url?: string;
  dataset_attribution_requirement?: string;
  distribution_service: string;
  distribution_service_terms_url?: string;
  distribution_catalog_license_name?: string;
  service_terms_verified?: boolean;
  storage_allowed?: boolean;
  redistribution_allowed?: boolean;
  licence_verified_at?: string;
  licence_verification_note?: string;
  source_url?: string;
  safe_reference?: string;
  retrieved_at: string;
  metadata?: Record<string, unknown>;
}

export interface MarketSourceVerificationInput {
  sourceId: string;
  verification: {
    service_terms_verified?: boolean;
    storage_allowed?: boolean;
    redistribution_allowed?: boolean;
    licence_verified_at?: string;
    licence_verification_note?: string;
  };
}

export interface MarketTradeObservationBody {
  reporter_country: string;
  partner_country?: string | null;
  trade_flow: MarketTradeFlow;
  hs_revision: string;
  hs_code: string;
  frequency: MarketDataFrequency;
  period: string;
  trade_value_usd?: number | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  net_weight_kg?: number | null;
  source_period?: string | null;
  retrieved_at: string;
  source_url?: string | null;
  safe_source_ref?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MarketTradeObservationIngestionInput {
  sourceId: string;
  observation: MarketTradeObservationBody;
}

export type MarketFetchLedgerWriteInput = Omit<
  MarketProviderFetchLedgerEntry,
  "reporterCountry" | "partnerCountry" | "queryFingerprint"
> & {
  query_fingerprint: string;
  reporter_country: string;
  partner_country?: string | null;
  trade_flow: MarketTradeFlow;
  hs_revision: string;
  hs_codes: string[];
  frequency: MarketDataFrequency;
  coverage_start: string;
  coverage_end: string;
  provider_selection_version: string;
  fetched_at: string;
  fresh_until: string;
  outcome: MarketProviderFetchLedgerEntry["outcome"];
  rows_received: number;
  provider_id: string;
  dataset_id: string;
  safe_metadata?: Record<string, unknown>;
};

export interface MarketFetchLedgerRecordResult {
  outcome: "recorded";
  id: string;
}

export interface MarketRefreshInput {
  countryAlpha2: string;
  mdfProductId: string;
  payload: {
    metrics: Array<Record<string, unknown>>;
    score?: Record<string, unknown>;
  };
}

export interface MarketRefreshSummary {
  outcome: "refreshed";
  countryAlpha2: string;
  mdfProductId: string;
  scoreId: string | null;
}

export interface ProductTradeMappingSyncSummary {
  outcome: "synced";
  created: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  unchanged: number;
  registryVersion: string;
}
