/**
 * MI1C — Market Intelligence READ repository.
 *
 * Authenticated reads only. Runs through the normal
 * request-scoped Supabase client (0022 grants `authenticated` SELECT
 * on every global MI table). No generic `.from(table)` surface — each
 * method names its table and returns the narrow domain shape MI2 will
 * consume.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CountryAlpha2,
  HsRevision,
  MarketProviderFetchLedgerEntry,
  MarketTradeFlow,
} from "./types";

export interface MarketReadRepositoryProductMapping {
  id: string;
  mdfProductId: string;
  hsRevision: HsRevision;
  hsLevel: 2 | 4 | 6;
  hsCode: string;
  tradeLabel: string;
  mappingKind: "exact" | "proxy" | "composite";
  mappingConfidence: number;
  fitEligibility: "exact" | "proxy_allowed" | "insufficient_specificity";
  scopeDescription: string;
  includedProductsNote?: string;
  weight?: number;
  isActive: boolean;
  registryVersion?: string;
  lastSyncedAt?: string;
}

export interface MarketReadRepositorySource {
  id: string;
  providerId: string;
  datasetId: string;
  sourceTier: "A" | "B" | "C" | "D" | "E";
  datasetSource: string;
  distributionService: string;
  serviceTermsVerified: boolean;
  storageAllowed: boolean | null;
  redistributionAllowed: boolean | null;
  licenceVerifiedAt: string | null;
  sourceUrl: string | null;
  retrievedAt: string;
}

export interface MarketReadRepositoryObservation {
  id: string;
  sourceId: string;
  providerId: string;
  datasetId: string;
  reporterCountry: CountryAlpha2;
  partnerCountry: CountryAlpha2 | null;
  tradeFlow: MarketTradeFlow;
  hsRevision: HsRevision;
  hsCode: string;
  frequency: "annual" | "quarterly" | "monthly";
  period: string;
  tradeValueUsd: number | null;
  quantity: number | null;
  quantityUnit: string | null;
  netWeightKg: number | null;
  retrievedAt: string;
}

export interface MarketReadRepositoryMetric {
  id: string;
  countryAlpha2: CountryAlpha2;
  mdfProductId: string;
  metricKey: string;
  numericValue: number | null;
  jsonValue: unknown | null;
  textValue: string | null;
  unit: string | null;
  calculationWindow: string;
  supportCount: number;
  observationWatermark: string | null;
  calculationVersion: string;
  calculatedAt: string;
}

export interface MarketReadRepositoryScoreComponent {
  id: string;
  componentKey: string;
  rawMetricValue: number | null;
  normalizedScore: number | null;
  weight: number;
  supported: boolean;
  reason: string | null;
}

export interface MarketReadRepositoryScore {
  id: string;
  countryAlpha2: CountryAlpha2;
  mdfProductId: string;
  diagnosticFitScore: number | null;
  publishedFitScore: number | null;
  dataConfidenceScore: number | null;
  recommendationStatus: "actionable" | "indicative" | "insufficient_evidence";
  mappingKind: "exact" | "proxy" | "composite";
  mappingConfidence: number;
  fitEligibility: "exact" | "proxy_allowed" | "insufficient_specificity";
  isTradeProxy: boolean;
  marketFitVersion: string;
  confidenceVersion: string;
  providerSelectionVersion: string;
  recommendationReason: string | null;
  positiveReasons: string[];
  negativeReasons: string[];
  sourceCoverage: Record<string, unknown>;
  calculatedAt: string;
  components: MarketReadRepositoryScoreComponent[];
}

export interface MarketReadRepository {
  listActiveProductMappings(): Promise<MarketReadRepositoryProductMapping[]>;
  getSource(sourceId: string): Promise<MarketReadRepositorySource | undefined>;
  listAnnualObservations(
    countryAlpha2: CountryAlpha2,
    hsRevision: HsRevision,
    hsCode: string,
  ): Promise<MarketReadRepositoryObservation[]>;
  listOriginObservations(
    countryAlpha2: CountryAlpha2,
    hsRevision: HsRevision,
    hsCode: string,
    period: string,
  ): Promise<MarketReadRepositoryObservation[]>;
  listCurrentMetrics(
    countryAlpha2: CountryAlpha2,
    mdfProductId: string,
  ): Promise<MarketReadRepositoryMetric[]>;
  getCurrentScore(
    countryAlpha2: CountryAlpha2,
    mdfProductId: string,
  ): Promise<MarketReadRepositoryScore | undefined>;
  listRecentLedgerEntriesForFingerprint(
    providerId: string,
    datasetId: string,
    queryFingerprint: string,
    limit?: number,
  ): Promise<MarketProviderFetchLedgerEntry[]>;
}

/**
 * Column projections kept private so the query planner can rely on
 * projection identity and callers never introduce arbitrary field
 * selections.
 */
const MAPPING_COLS =
  "id, mdf_product_id, hs_revision, hs_level, hs_code, trade_label, mapping_kind, mapping_confidence, fit_eligibility, scope_description, included_products_note, weight, is_active, registry_version, last_synced_at";
const SOURCE_COLS =
  "id, provider_id, dataset_id, source_tier, dataset_source, distribution_service, service_terms_verified, storage_allowed, redistribution_allowed, licence_verified_at, source_url, retrieved_at";
const OBSERVATION_COLS =
  "id, source_id, provider_id, dataset_id, reporter_country, partner_country, trade_flow, hs_revision, hs_code, frequency, period, trade_value_usd, quantity, quantity_unit, net_weight_kg, retrieved_at";
const METRIC_COLS =
  "id, country_alpha2, mdf_product_id, metric_key, numeric_value, json_value, text_value, unit, calculation_window, support_count, observation_watermark, calculation_version, calculated_at";
const SCORE_COLS =
  "id, country_alpha2, mdf_product_id, diagnostic_fit_score, published_fit_score, data_confidence_score, recommendation_status, mapping_kind, mapping_confidence, fit_eligibility, is_trade_proxy, market_fit_version, confidence_version, provider_selection_version, recommendation_reason, positive_reasons, negative_reasons, source_coverage, calculated_at";
const COMPONENT_COLS =
  "id, score_id, component_key, raw_metric_value, normalized_score, weight, supported, reason";
const LEDGER_COLS =
  "provider_id, dataset_id, query_fingerprint, reporter_country, partner_country, trade_flow, hs_revision, hs_codes, frequency, coverage_start, coverage_end, provider_selection_version, fetched_at, fresh_until, outcome, rows_received, safe_metadata";

class SupabaseMarketReadRepository implements MarketReadRepository {
  constructor(private supabase: SupabaseClient) {}

  async listActiveProductMappings(): Promise<MarketReadRepositoryProductMapping[]> {
    const { data, error } = await this.supabase
      .from("product_trade_mappings")
      .select(MAPPING_COLS)
      .eq("is_active", true)
      .order("mdf_product_id", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToProductMapping);
  }

  async getSource(sourceId: string): Promise<MarketReadRepositorySource | undefined> {
    const { data, error } = await this.supabase
      .from("market_intelligence_sources")
      .select(SOURCE_COLS)
      .eq("id", sourceId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToSource(data) : undefined;
  }

  async listAnnualObservations(
    countryAlpha2: CountryAlpha2,
    hsRevision: HsRevision,
    hsCode: string,
  ): Promise<MarketReadRepositoryObservation[]> {
    const { data, error } = await this.supabase
      .from("market_trade_observations")
      .select(OBSERVATION_COLS)
      .eq("reporter_country", countryAlpha2)
      .eq("hs_revision", hsRevision)
      .eq("hs_code", hsCode)
      .eq("frequency", "annual")
      .is("partner_country", null)
      .order("period", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToObservation);
  }

  async listOriginObservations(
    countryAlpha2: CountryAlpha2,
    hsRevision: HsRevision,
    hsCode: string,
    period: string,
  ): Promise<MarketReadRepositoryObservation[]> {
    const { data, error } = await this.supabase
      .from("market_trade_observations")
      .select(OBSERVATION_COLS)
      .eq("reporter_country", countryAlpha2)
      .eq("hs_revision", hsRevision)
      .eq("hs_code", hsCode)
      .eq("period", period)
      .not("partner_country", "is", null)
      .order("trade_value_usd", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data ?? []).map(rowToObservation);
  }

  async listCurrentMetrics(
    countryAlpha2: CountryAlpha2,
    mdfProductId: string,
  ): Promise<MarketReadRepositoryMetric[]> {
    const { data, error } = await this.supabase
      .from("market_trade_metrics")
      .select(METRIC_COLS)
      .eq("country_alpha2", countryAlpha2)
      .eq("mdf_product_id", mdfProductId)
      .is("superseded_at", null);
    if (error) throw error;
    return (data ?? []).map(rowToMetric);
  }

  async getCurrentScore(
    countryAlpha2: CountryAlpha2,
    mdfProductId: string,
  ): Promise<MarketReadRepositoryScore | undefined> {
    const { data: scoreRow, error } = await this.supabase
      .from("market_product_scores")
      .select(SCORE_COLS)
      .eq("country_alpha2", countryAlpha2)
      .eq("mdf_product_id", mdfProductId)
      .is("superseded_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!scoreRow) return undefined;
    const { data: components, error: componentError } = await this.supabase
      .from("market_product_score_components")
      .select(COMPONENT_COLS)
      .eq("score_id", (scoreRow as { id: string }).id);
    if (componentError) throw componentError;
    return rowToScore(scoreRow, components ?? []);
  }

  async listRecentLedgerEntriesForFingerprint(
    providerId: string,
    datasetId: string,
    queryFingerprint: string,
    limit = 5,
  ): Promise<MarketProviderFetchLedgerEntry[]> {
    const { data, error } = await this.supabase
      .from("market_provider_fetch_ledger")
      .select(LEDGER_COLS)
      .eq("provider_id", providerId)
      .eq("dataset_id", datasetId)
      .eq("query_fingerprint", queryFingerprint)
      .order("fetched_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToLedgerEntry);
  }
}

export function createMarketReadRepository(supabase: SupabaseClient): MarketReadRepository {
  return new SupabaseMarketReadRepository(supabase);
}

// ---------------------------------------------------------------------------
// Row → domain mappers (kept trivial; no side effects).
// ---------------------------------------------------------------------------

function rowToProductMapping(r: Record<string, unknown>): MarketReadRepositoryProductMapping {
  return {
    id: r.id as string,
    mdfProductId: r.mdf_product_id as string,
    hsRevision: r.hs_revision as HsRevision,
    hsLevel: r.hs_level as 2 | 4 | 6,
    hsCode: r.hs_code as string,
    tradeLabel: r.trade_label as string,
    mappingKind: r.mapping_kind as "exact" | "proxy" | "composite",
    mappingConfidence: Number(r.mapping_confidence),
    fitEligibility: r.fit_eligibility as "exact" | "proxy_allowed" | "insufficient_specificity",
    scopeDescription: r.scope_description as string,
    includedProductsNote: (r.included_products_note as string) ?? undefined,
    weight: r.weight == null ? undefined : Number(r.weight),
    isActive: r.is_active as boolean,
    registryVersion: (r.registry_version as string) ?? undefined,
    lastSyncedAt: (r.last_synced_at as string) ?? undefined,
  };
}

function rowToSource(r: Record<string, unknown>): MarketReadRepositorySource {
  return {
    id: r.id as string,
    providerId: r.provider_id as string,
    datasetId: r.dataset_id as string,
    sourceTier: r.source_tier as "A" | "B" | "C" | "D" | "E",
    datasetSource: r.dataset_source as string,
    distributionService: r.distribution_service as string,
    serviceTermsVerified: Boolean(r.service_terms_verified),
    storageAllowed: r.storage_allowed as boolean | null,
    redistributionAllowed: r.redistribution_allowed as boolean | null,
    licenceVerifiedAt: (r.licence_verified_at as string) ?? null,
    sourceUrl: (r.source_url as string) ?? null,
    retrievedAt: r.retrieved_at as string,
  };
}

function rowToObservation(r: Record<string, unknown>): MarketReadRepositoryObservation {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    providerId: r.provider_id as string,
    datasetId: r.dataset_id as string,
    reporterCountry: r.reporter_country as CountryAlpha2,
    partnerCountry: (r.partner_country as CountryAlpha2 | null) ?? null,
    tradeFlow: r.trade_flow as MarketTradeFlow,
    hsRevision: r.hs_revision as HsRevision,
    hsCode: r.hs_code as string,
    frequency: r.frequency as "annual" | "quarterly" | "monthly",
    period: r.period as string,
    tradeValueUsd: r.trade_value_usd == null ? null : Number(r.trade_value_usd),
    quantity: r.quantity == null ? null : Number(r.quantity),
    quantityUnit: (r.quantity_unit as string) ?? null,
    netWeightKg: r.net_weight_kg == null ? null : Number(r.net_weight_kg),
    retrievedAt: r.retrieved_at as string,
  };
}

function rowToMetric(r: Record<string, unknown>): MarketReadRepositoryMetric {
  return {
    id: r.id as string,
    countryAlpha2: r.country_alpha2 as CountryAlpha2,
    mdfProductId: r.mdf_product_id as string,
    metricKey: r.metric_key as string,
    numericValue: r.numeric_value == null ? null : Number(r.numeric_value),
    jsonValue: (r.json_value as unknown) ?? null,
    textValue: (r.text_value as string) ?? null,
    unit: (r.unit as string) ?? null,
    calculationWindow: r.calculation_window as string,
    supportCount: Number(r.support_count),
    observationWatermark: (r.observation_watermark as string) ?? null,
    calculationVersion: r.calculation_version as string,
    calculatedAt: r.calculated_at as string,
  };
}

function rowToScore(
  r: Record<string, unknown>,
  components: Record<string, unknown>[],
): MarketReadRepositoryScore {
  return {
    id: r.id as string,
    countryAlpha2: r.country_alpha2 as CountryAlpha2,
    mdfProductId: r.mdf_product_id as string,
    diagnosticFitScore: r.diagnostic_fit_score == null ? null : Number(r.diagnostic_fit_score),
    publishedFitScore: r.published_fit_score == null ? null : Number(r.published_fit_score),
    dataConfidenceScore: r.data_confidence_score == null ? null : Number(r.data_confidence_score),
    recommendationStatus: r.recommendation_status as "actionable" | "indicative" | "insufficient_evidence",
    mappingKind: r.mapping_kind as "exact" | "proxy" | "composite",
    mappingConfidence: Number(r.mapping_confidence),
    fitEligibility: r.fit_eligibility as "exact" | "proxy_allowed" | "insufficient_specificity",
    isTradeProxy: Boolean(r.is_trade_proxy),
    marketFitVersion: r.market_fit_version as string,
    confidenceVersion: r.confidence_version as string,
    providerSelectionVersion: r.provider_selection_version as string,
    recommendationReason: (r.recommendation_reason as string) ?? null,
    positiveReasons: Array.isArray(r.positive_reasons) ? (r.positive_reasons as string[]) : [],
    negativeReasons: Array.isArray(r.negative_reasons) ? (r.negative_reasons as string[]) : [],
    sourceCoverage: (r.source_coverage as Record<string, unknown>) ?? {},
    calculatedAt: r.calculated_at as string,
    components: components.map((c) => ({
      id: c.id as string,
      componentKey: c.component_key as string,
      rawMetricValue: c.raw_metric_value == null ? null : Number(c.raw_metric_value),
      normalizedScore: c.normalized_score == null ? null : Number(c.normalized_score),
      weight: Number(c.weight),
      supported: Boolean(c.supported),
      reason: (c.reason as string) ?? null,
    })),
  };
}

function rowToLedgerEntry(r: Record<string, unknown>): MarketProviderFetchLedgerEntry {
  return {
    providerId: r.provider_id as string,
    datasetId: r.dataset_id as string,
    queryFingerprint: r.query_fingerprint as string,
    reporterCountry: r.reporter_country as CountryAlpha2,
    partnerCountry: (r.partner_country as CountryAlpha2 | null) ?? null,
    tradeFlow: r.trade_flow as MarketTradeFlow,
    hsRevision: r.hs_revision as HsRevision,
    hsCodes: (r.hs_codes as string[]) ?? [],
    frequency: r.frequency as "annual" | "quarterly" | "monthly",
    coverageStart: r.coverage_start as string,
    coverageEnd: r.coverage_end as string,
    providerSelectionVersion: r.provider_selection_version as string,
    fetchedAt: r.fetched_at as string,
    freshUntil: r.fresh_until as string,
    outcome: r.outcome as MarketProviderFetchLedgerEntry["outcome"],
    rowsReceived: Number(r.rows_received),
    safeMetadata: (r.safe_metadata as Record<string, unknown>) ?? undefined,
  };
}
