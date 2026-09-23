import "server-only";

import { createHash } from "node:crypto";
import type { CalibrationCountryReport } from "../calibration/report";
import { DEFAULT_COMPONENT_WEIGHTS } from "../calibration/formula";
import { DATA_CONFIDENCE_VERSION, MARKET_FIT_VERSION } from "../marketFit";
import type {
  MarketReadRepositoryObservation,
  MarketReadRepositoryProductMapping,
  MarketReadRepositoryScore,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import { MI_PRODUCT_MAPPING_VERSION } from "../product";
import { MI_PROVIDER_SELECTION_VERSION } from "../providerSelection";
import type { MarketProviderFetchLedgerEntry } from "../types";

export type MarketScoreStaleReason =
  | "market_fit_version_changed"
  | "data_confidence_version_changed"
  | "provider_selection_version_changed"
  | "evidence_watermark_changed"
  | "mapping_watermark_changed"
  | "mapping_registry_version_changed"
  | "evidence_watermark_missing";

export interface MarketScoreWatermarks {
  evidenceWatermark: string;
  mappingWatermark: string;
  mappingRegistryVersion: string;
}

export interface MarketScoreComponentWire {
  component_key: string;
  /** Canonical PostgreSQL numeric(24,6) wire representation. */
  raw_metric_value: string | null;
  normalized_score: number | null;
  weight: number;
  supported: boolean;
  reason: string;
  metadata: Record<string, unknown>;
}

export interface MarketScorePersistencePlan {
  payload: {
    metrics: [];
    score: Record<string, unknown>;
  };
  components: MarketScoreComponentWire[];
  watermarks: MarketScoreWatermarks;
  persistenceFingerprint: string;
}

interface BuildMarketScorePersistencePlanInput {
  countryAlpha2: string;
  mdfProductId: string;
  mapping: MarketReadRepositoryProductMapping;
  source: MarketReadRepositorySource;
  observations: readonly MarketReadRepositoryObservation[];
  ledger?: MarketProviderFetchLedgerEntry;
  calculation: CalibrationCountryReport;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function deterministicMarketScoreHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

/**
 * PostgreSQL stores raw_metric_value as numeric(24,6). The 0022 equality
 * contract compares stored `numeric::text` with incoming JSON text, so the
 * wire payload must use the same fixed-six-decimal representation. Sending a
 * JSON number (for example `1`) would compare unequal to stored `1.000000`.
 */
export function canonicalScoreRawMetric(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) throw new Error("score raw metric must be finite");
  if (Math.abs(value) >= 1_000_000_000_000_000_000) {
    throw new Error("score raw metric exceeds numeric(24,6)");
  }
  const fixed = value.toFixed(6);
  return fixed === "-0.000000" ? "0.000000" : fixed;
}

export function buildMarketScoreWatermarks(input: Omit<
  BuildMarketScorePersistencePlanInput,
  "calculation"
>): MarketScoreWatermarks {
  const observations = [...input.observations]
    .map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      providerId: row.providerId,
      datasetId: row.datasetId,
      reporterCountry: row.reporterCountry,
      partnerCountry: row.partnerCountry,
      tradeFlow: row.tradeFlow,
      hsRevision: row.hsRevision,
      hsCode: row.hsCode,
      frequency: row.frequency,
      period: row.period,
      tradeValueUsd: row.tradeValueUsd,
      quantity: row.quantity,
      quantityUnit: row.quantityUnit,
      netWeightKg: row.netWeightKg,
      retrievedAt: row.retrievedAt,
    }))
    .sort((a, b) =>
      `${a.period}|${a.partnerCountry ?? ""}|${a.id}`.localeCompare(
        `${b.period}|${b.partnerCountry ?? ""}|${b.id}`,
      )
    );
  const ledger = input.ledger ? {
    providerId: input.ledger.providerId,
    datasetId: input.ledger.datasetId,
    queryFingerprint: input.ledger.queryFingerprint,
    reporterCountry: input.ledger.reporterCountry,
    partnerCountry: input.ledger.partnerCountry,
    tradeFlow: input.ledger.tradeFlow,
    hsRevision: input.ledger.hsRevision,
    hsCodes: input.ledger.hsCodes,
    frequency: input.ledger.frequency,
    coverageStart: input.ledger.coverageStart,
    coverageEnd: input.ledger.coverageEnd,
    providerSelectionVersion: input.ledger.providerSelectionVersion,
    fetchedAt: input.ledger.fetchedAt,
    outcome: input.ledger.outcome,
    rowsReceived: input.ledger.rowsReceived,
  } : null;
  const mappingMaterial = {
    id: input.mapping.id,
    mdfProductId: input.mapping.mdfProductId,
    hsRevision: input.mapping.hsRevision,
    hsLevel: input.mapping.hsLevel,
    hsCode: input.mapping.hsCode,
    mappingKind: input.mapping.mappingKind,
    mappingConfidence: input.mapping.mappingConfidence,
    fitEligibility: input.mapping.fitEligibility,
    scopeDescription: input.mapping.scopeDescription,
    includedProductsNote: input.mapping.includedProductsNote ?? null,
    weight: input.mapping.weight ?? null,
    registryVersion: input.mapping.registryVersion ?? null,
    isActive: input.mapping.isActive,
  };
  return {
    evidenceWatermark: deterministicMarketScoreHash({
      countryAlpha2: input.countryAlpha2,
      mdfProductId: input.mdfProductId,
      source: {
        id: input.source.id,
        providerId: input.source.providerId,
        datasetId: input.source.datasetId,
        sourceTier: input.source.sourceTier,
        rightsVerifiedAt: input.source.licenceVerifiedAt,
      },
      ledger,
      observations,
    }),
    mappingWatermark: deterministicMarketScoreHash(mappingMaterial),
    mappingRegistryVersion: input.mapping.registryVersion ?? MI_PRODUCT_MAPPING_VERSION,
  };
}

const COMPONENT_KEYS = {
  demandSize: "demand_size",
  demandGrowth: "demand_growth",
  indiaPosition: "india_position",
  competitiveOpportunity: "competitive_opportunity",
  priceAttractiveness: "price_attractiveness",
  demandStability: "demand_stability",
} as const;

const COMPONENT_FINGERPRINT_ORDER = Object.values(COMPONENT_KEYS);

export function canonicalScoreComponentOrder<T extends { component_key: string }>(
  components: readonly T[],
): T[] {
  const order = new Map<string, number>(
    COMPONENT_FINGERPRINT_ORDER.map((key, index) => [key, index]),
  );
  return [...components].sort((a, b) =>
    (order.get(a.component_key) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.component_key) ?? Number.MAX_SAFE_INTEGER) ||
    a.component_key.localeCompare(b.component_key)
  );
}

function rawComponentValues(calculation: CalibrationCountryReport): Record<
  keyof typeof COMPONENT_KEYS,
  { value: number | null; detail: Record<string, unknown> }
> {
  const p = calculation.primitives;
  return {
    demandSize: { value: p.latestImportsUsd, detail: { latest_year: p.latestYear } },
    demandGrowth: {
      value: p.threeYearCagrPct ?? p.fiveYearCagrPct ?? p.latestYoyPct,
      detail: {
        three_year_cagr_pct: p.threeYearCagrPct,
        five_year_cagr_pct: p.fiveYearCagrPct,
        latest_yoy_pct: p.latestYoyPct,
      },
    },
    indiaPosition: {
      value: p.indiaShare,
      detail: { india_rank: p.indiaRank, india_imports_usd: p.indiaImportsUsd },
    },
    competitiveOpportunity: {
      value: p.hhi,
      detail: { top1_origin_share: p.top1OriginShare, top3_origin_share: p.top3OriginShare },
    },
    priceAttractiveness: {
      value: p.latestDerivedUnitValueUsdPerKg,
      detail: { latest_quantity_tonnes: p.latestQuantityTonnes },
    },
    demandStability: {
      value: p.volatilityCv,
      detail: { valid_annual_periods: p.validAnnualPeriods },
    },
  };
}

export function buildMarketScorePersistencePlan(
  input: BuildMarketScorePersistencePlanInput,
): MarketScorePersistencePlan {
  const watermarks = buildMarketScoreWatermarks(input);
  const raw = rawComponentValues(input.calculation);
  const componentKeys = Object.keys(COMPONENT_KEYS) as Array<keyof typeof COMPONENT_KEYS>;
  const components = componentKeys.map((key): MarketScoreComponentWire => {
    const score = input.calculation.components[key];
    return {
      component_key: COMPONENT_KEYS[key],
      raw_metric_value: canonicalScoreRawMetric(raw[key].value),
      normalized_score: score,
      weight: DEFAULT_COMPONENT_WEIGHTS[key],
      supported: score !== null,
      reason: score === null ? "required primitive unavailable" : "calibrated production normalization",
      metadata: {
        calculation_version: MARKET_FIT_VERSION,
        methodology: "candidate-c-conservative-hybrid",
        ...raw[key].detail,
      },
    };
  });
  // Preserve the original MI1I fingerprint representation (logical numbers)
  // so the already-persisted current score remains reusable after this wire
  // canonicalization fix. Only the RPC wire value needs numeric(24,6) text.
  const fingerprintComponents = canonicalScoreComponentOrder(componentKeys.map((key) => ({
    ...components.find((component) => component.component_key === COMPONENT_KEYS[key])!,
    raw_metric_value: raw[key].value,
  })));

  const fit = input.calculation.fit;
  const confidence = input.calculation.confidence;
  const sourceCoverage = {
    evidence_watermark: watermarks.evidenceWatermark,
    mapping_watermark: watermarks.mappingWatermark,
    mapping_registry_version: watermarks.mappingRegistryVersion,
    observation_count: input.observations.length,
    analytical_years: [...input.calculation.evidence.analyticalYears],
    complete_bilateral_coverage: input.calculation.evidence.completeBilateralCoverage,
    ledger_query_fingerprint: input.ledger?.queryFingerprint ?? null,
    ledger_fetched_at: input.ledger?.fetchedAt ?? null,
    ledger_rows_received: input.ledger?.rowsReceived ?? null,
  };
  const scoreMaterial = {
    mapping_kind: input.mapping.mappingKind,
    mapping_confidence: input.mapping.mappingConfidence,
    fit_eligibility: fit.fitEligibility,
    diagnostic_fit_score: fit.diagnosticFitScore,
    published_fit_score: fit.publishedFitScore,
    data_confidence_score: confidence.supported ? confidence.score : null,
    recommendation_status: fit.recommendationStatus,
    is_trade_proxy: input.mapping.mappingKind === "proxy",
    market_fit_version: MARKET_FIT_VERSION,
    confidence_version: DATA_CONFIDENCE_VERSION,
    provider_selection_version: MI_PROVIDER_SELECTION_VERSION,
    recommendation_reason: fit.publicationReason,
    positive_reasons: [],
    negative_reasons: fit.reasons,
  };
  const persistenceFingerprint = deterministicMarketScoreHash({
    ...scoreMaterial,
    source_coverage: sourceCoverage,
    components: fingerprintComponents,
  });
  return {
    components,
    watermarks,
    persistenceFingerprint,
    payload: {
      metrics: [],
      score: {
        ...scoreMaterial,
        source_coverage: {
          ...sourceCoverage,
          persistence_fingerprint: persistenceFingerprint,
        },
        components,
      },
    },
  };
}

export function marketScorePersistenceFingerprint(
  score: MarketReadRepositoryScore | undefined,
): string | undefined {
  const value = score?.sourceCoverage.persistence_fingerprint;
  return typeof value === "string" ? value : undefined;
}

export function assessMarketScoreStaleness(
  score: MarketReadRepositoryScore | undefined,
  expected: MarketScoreWatermarks,
): { stale: boolean; reasons: MarketScoreStaleReason[] } {
  if (!score) return { stale: true, reasons: ["evidence_watermark_missing"] };
  const reasons: MarketScoreStaleReason[] = [];
  if (score.marketFitVersion !== MARKET_FIT_VERSION) reasons.push("market_fit_version_changed");
  if (score.confidenceVersion !== DATA_CONFIDENCE_VERSION) reasons.push("data_confidence_version_changed");
  if (score.providerSelectionVersion !== MI_PROVIDER_SELECTION_VERSION) {
    reasons.push("provider_selection_version_changed");
  }
  const evidence = score.sourceCoverage.evidence_watermark;
  if (typeof evidence !== "string") reasons.push("evidence_watermark_missing");
  else if (evidence !== expected.evidenceWatermark) reasons.push("evidence_watermark_changed");
  if (score.sourceCoverage.mapping_watermark !== expected.mappingWatermark) {
    reasons.push("mapping_watermark_changed");
  }
  if (score.sourceCoverage.mapping_registry_version !== expected.mappingRegistryVersion) {
    reasons.push("mapping_registry_version_changed");
  }
  return { stale: reasons.length > 0, reasons };
}
