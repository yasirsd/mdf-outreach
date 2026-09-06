/**
 * MI0 — deterministic Market Fit score primitives.
 *
 * All scoring is transparent and reproducible. There is no LLM
 * anywhere in this file, and no opaque model output. Every component
 * value stays traceable to the metrics it consumed and to the
 * `MARKET_FIT_WEIGHT_VERSION`. Future changes to weights must go
 * through a superseding calculation version so history is preserved.
 */

import type {
  DataConfidenceScore,
  MarketFitClassification,
  MarketFitComponent,
  MarketFitComponentKey,
  MarketFitScore,
  MarketSourceTier,
} from "./types";

export const MARKET_FIT_WEIGHT_VERSION = "mi-fit-v1";

/**
 * Proposed initial weighting. Not yet operator-approved for
 * production; MI1 must revisit after real ingestion is wired.
 * Weights sum to 100.
 */
export const MARKET_FIT_WEIGHTS: Record<MarketFitComponentKey, number> = Object.freeze({
  demand_size: 25,
  demand_growth: 20,
  india_position: 20,
  competitive_opportunity: 15,
  price_attractiveness: 10,
  demand_stability: 10,
});

/**
 * Minimum informational requirement to publish a numeric score.
 * Below this threshold, MI reports `insufficient_evidence` instead
 * of a misleading number.
 */
export const MARKET_FIT_MIN_SUPPORTED_WEIGHT = 55;

// ---------------------------------------------------------------------------
// Component normalization primitives
// ---------------------------------------------------------------------------

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Log-scale demand-size normalizer. Maps trade values in USD onto a
 * 0..100 scale that saturates smoothly for very large markets. Below
 * `minUsd` returns 0; at `maxUsd` returns 100. Between, uses
 * log10 interpolation so a $1M market and a $1B market are visibly
 * distinct while $50B and $500B stay comparable.
 */
export function normalizeDemandSize(
  tradeValueUsd: number | null | undefined,
  bounds: { minUsd: number; maxUsd: number } = { minUsd: 1_000_000, maxUsd: 5_000_000_000 },
): number | null {
  if (tradeValueUsd == null || !Number.isFinite(tradeValueUsd) || tradeValueUsd <= 0) return null;
  const min = Math.log10(bounds.minUsd);
  const max = Math.log10(bounds.maxUsd);
  const x = Math.log10(tradeValueUsd);
  return Math.round(clamp01((x - min) / (max - min)) * 100);
}

/**
 * Growth-rate normalizer. −20% → 0, 0% → 40, +10% → 65, +20% → 80,
 * +30%+ → 100. Non-linear so mild growth still shows movement without
 * over-rewarding suspiciously large jumps.
 */
export function normalizeGrowth(percent: number | null | undefined): number | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  const p = percent;
  if (p <= -0.20) return 0;
  if (p >= 0.30) return 100;
  // Piecewise linear anchors: -20→0, 0→40, 10→65, 20→80, 30→100.
  const anchors: [number, number][] = [
    [-0.20, 0],
    [0.00, 40],
    [0.10, 65],
    [0.20, 80],
    [0.30, 100],
  ];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [x0, y0] = anchors[i]!;
    const [x1, y1] = anchors[i + 1]!;
    if (p >= x0 && p <= x1) {
      const t = (p - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return null;
}

/**
 * India-position normalizer. Combines India's origin share (0..1)
 * with a rank bonus for rising India share. Result 0..100.
 */
export function normalizeIndiaPosition(input: {
  indiaShare: number | null;
  shareTrend?: "rising" | "flat" | "falling" | "unknown";
}): number | null {
  const s = input.indiaShare;
  if (s == null || !Number.isFinite(s)) return null;
  const base = clamp01(s) * 80;
  const trendBonus =
    input.shareTrend === "rising" ? 20 :
    input.shareTrend === "flat" ? 8 :
    input.shareTrend === "falling" ? 0 : 4;
  return Math.round(clamp01((base + trendBonus) / 100) * 100);
}

/**
 * Competitive opportunity normalizer. High competition = many strong
 * origin countries + low top-2 concentration ⇒ MDF may enter more
 * easily. HHI-style concentration on top origins (0..1) is inverted.
 */
export function normalizeCompetitiveOpportunity(
  originConcentration: number | null | undefined,
): number | null {
  if (originConcentration == null || !Number.isFinite(originConcentration)) return null;
  const c = clamp01(originConcentration);
  return Math.round((1 - c) * 100);
}

/**
 * Price-attractiveness normalizer. Positive when the derived unit
 * value trend is stable or rising (indicates room in the market for
 * quality-priced product); flat scores mid; falling scores lower.
 */
export function normalizePriceAttractiveness(input: {
  unitValueTrend?: "rising" | "flat" | "falling" | "unknown";
  hasUnitValue: boolean;
}): number | null {
  if (!input.hasUnitValue) return null;
  switch (input.unitValueTrend) {
    case "rising":
      return 80;
    case "flat":
      return 60;
    case "falling":
      return 35;
    case "unknown":
    default:
      return 50;
  }
}

export function normalizeStability(index: number | null | undefined): number | null {
  if (index == null || !Number.isFinite(index)) return null;
  return Math.round(clamp01(index) * 100);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function composeMarketFit(
  components: Omit<MarketFitComponent, "weight">[],
  calculatedAt: string,
): MarketFitScore {
  const merged: MarketFitComponent[] = components.map((c) => ({
    ...c,
    weight: MARKET_FIT_WEIGHTS[c.key],
  }));

  const supportedWeight = merged
    .filter((c) => c.value != null)
    .reduce((sum, c) => sum + c.weight, 0);

  const positiveReasons: string[] = [];
  const negativeReasons: string[] = [];
  for (const c of merged) {
    if (c.value == null) continue;
    if (c.value >= 70) positiveReasons.push(c.reason);
    if (c.value <= 40) negativeReasons.push(c.reason);
  }

  if (supportedWeight < MARKET_FIT_MIN_SUPPORTED_WEIGHT) {
    return {
      score: null,
      classification: "insufficient_evidence",
      components: merged,
      positiveReasons,
      negativeReasons,
      calculationVersion: MARKET_FIT_WEIGHT_VERSION,
      calculatedAt,
    };
  }

  const numerator = merged.reduce(
    (sum, c) => (c.value == null ? sum : sum + c.value * c.weight),
    0,
  );
  // Renormalize by supported weight so missing components neither
  // silently zero nor inflate the score.
  const score = Math.round(numerator / supportedWeight);
  const classification = classifyMarketFit(score);
  return {
    score,
    classification,
    components: merged,
    positiveReasons,
    negativeReasons,
    calculationVersion: MARKET_FIT_WEIGHT_VERSION,
    calculatedAt,
  };
}

export function classifyMarketFit(score: number | null | undefined): MarketFitClassification {
  if (score == null || !Number.isFinite(score)) return "insufficient_evidence";
  if (score >= 85) return "excellent_opportunity";
  if (score >= 70) return "strong_opportunity";
  if (score >= 55) return "moderate_opportunity";
  if (score >= 40) return "weak_opportunity";
  return "low_opportunity";
}

// ---------------------------------------------------------------------------
// Data confidence
// ---------------------------------------------------------------------------

export const DATA_CONFIDENCE_VERSION = "mi-conf-v1";

export const SOURCE_TIER_AUTHORITY: Record<MarketSourceTier, number> = Object.freeze({
  A: 100,
  B: 90,
  C: 60,
  D: 30,
  E: 15,
});

export interface ConfidenceInput {
  sourceTier: MarketSourceTier;
  /** 0..1 fraction of expected periods covered in the trailing 5 years. */
  coverageCompleteness: number;
  /** How recent the latest observation is: 0 = >5y old, 1 = within the current year. */
  dataRecency: number;
  /** 0..1 fraction of periods without a gap in the trailing window. */
  periodContinuity: number;
  /** 0..1 fraction of observations that carried a quantity (for unit value). */
  quantityAvailability: number;
  /** 0..1 fraction of expected partners (origins) actually reported. */
  partnerCompleteness: number;
  /** 0..1 confidence in the HS→product mapping used (weights, revision fit). */
  hsMappingCertainty: number;
}

export function composeDataConfidence(
  input: ConfidenceInput,
  calculatedAt: string,
): DataConfidenceScore {
  const rows: DataConfidenceScore["components"] = [
    { key: "source_authority", value: SOURCE_TIER_AUTHORITY[input.sourceTier], weight: 25, reason: `Source tier ${input.sourceTier}` },
    { key: "coverage_completeness", value: pct(input.coverageCompleteness), weight: 15, reason: "Trailing-window period coverage" },
    { key: "data_recency", value: pct(input.dataRecency), weight: 15, reason: "Latest available period recency" },
    { key: "period_continuity", value: pct(input.periodContinuity), weight: 15, reason: "Missing periods in the trailing window" },
    { key: "quantity_availability", value: pct(input.quantityAvailability), weight: 10, reason: "Observations carrying quantity" },
    { key: "partner_completeness", value: pct(input.partnerCompleteness), weight: 10, reason: "Origin partners reported" },
    { key: "hs_mapping_certainty", value: pct(input.hsMappingCertainty), weight: 10, reason: "HS↔MDF product mapping certainty" },
  ];
  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);
  const score = Math.round(rows.reduce((sum, r) => sum + r.value * r.weight, 0) / totalWeight);
  return {
    score,
    components: rows,
    calculationVersion: DATA_CONFIDENCE_VERSION,
    calculatedAt,
  };
}

function pct(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.round(clamp01(fraction) * 100);
}
