/**
 * MI1H — authoritative calibrated Market Fit normalization.
 *
 * Candidate C is the production contract. Its anchors are frozen, explicit,
 * deterministic, and versioned. The former MI1E provisional rules remain
 * available only through `legacyProvisionalComponentScores()` so historical
 * and calibration comparisons stay reproducible.
 */

import type { CountryPrimitives } from "./primitives";
import { log10p1 } from "./distribution";

export interface CandidateComponentScores {
  demandSize: number | null;
  demandGrowth: number | null;
  indiaPosition: number | null;
  competitiveOpportunity: number | null;
  priceAttractiveness: number | null;
  demandStability: number | null;
}

export interface NormalizationConfig {
  methodology: "candidate-c-conservative-hybrid";
  marketFitVersion: "mi-fit-v2";
  isProvisional: false;
  demandLog10Usd: readonly number[];
  growthCagrPct: readonly number[];
  indiaShare: readonly number[];
  hhiWorstToBest: readonly number[];
  top1WorstToBest: readonly number[];
  top3WorstToBest: readonly number[];
  derivedUnitValueUsdPerKg: readonly number[];
  volatilityWorstToBest: readonly number[];
  scoreScale: readonly number[];
  boundedUnitValueScale: readonly number[];
  smallQuantityThresholdTonnes: number;
  smallQuantityScoreCap: number;
  concentratedMarketHhiThreshold: number;
  concentratedMarketTop1Threshold: number;
  concentratedMarketOpportunityCap: number;
}

/** The one authoritative production normalization contract. */
export const CALIBRATED_NORMALIZATION: NormalizationConfig = Object.freeze({
  methodology: "candidate-c-conservative-hybrid",
  marketFitVersion: "mi-fit-v2",
  isProvisional: false,
  demandLog10Usd: [6, 6.75, 7.25, 7.75, 8.5] as const,
  growthCagrPct: [-10, -5, 2.5, 10, 20] as const,
  indiaShare: [0, 0.05, 0.20, 0.50, 0.90] as const,
  hhiWorstToBest: [0.85, 0.60, 0.40, 0.25, 0.15] as const,
  top1WorstToBest: [0.90, 0.75, 0.60, 0.45, 0.30] as const,
  top3WorstToBest: [0.98, 0.90, 0.80, 0.65, 0.50] as const,
  derivedUnitValueUsdPerKg: [2, 3, 5, 8, 12] as const,
  volatilityWorstToBest: [0.50, 0.30, 0.20, 0.10, 0.05] as const,
  scoreScale: [0, 25, 50, 75, 100] as const,
  boundedUnitValueScale: [10, 35, 60, 75, 85] as const,
  smallQuantityThresholdTonnes: 10,
  smallQuantityScoreCap: 30,
  concentratedMarketHhiThreshold: 0.70,
  concentratedMarketTop1Threshold: 0.85,
  concentratedMarketOpportunityCap: 25,
});

/** Production default. Kept as an alias for existing callers. */
export const DEFAULT_NORMALIZATION = CALIBRATED_NORMALIZATION;

export interface LegacyProvisionalNormalizationConfig {
  demandSizeBreaksLog10: readonly number[];
  yoyBreaksPct: readonly number[];
  cagrBreaksPct: readonly number[];
  indiaShareBreaks: readonly number[];
  hhiOpportunityBreaks: readonly number[];
  unitValueBreaksUsdPerKg: readonly number[];
  cvStabilityBreaks: readonly number[];
}

/** Frozen MI1E rules; debug/history only, never the production default. */
export const LEGACY_PROVISIONAL_NORMALIZATION: LegacyProvisionalNormalizationConfig = Object.freeze({
  demandSizeBreaksLog10: [5.0, 6.0, 6.75, 7.5, 8.5] as const,
  yoyBreaksPct: [-30, -10, 0, 10, 30] as const,
  cagrBreaksPct: [-15, -5, 0, 5, 15] as const,
  indiaShareBreaks: [0.0, 0.05, 0.15, 0.30, 0.50] as const,
  hhiOpportunityBreaks: [0.55, 0.35, 0.20, 0.10, 0.05] as const,
  unitValueBreaksUsdPerKg: [2, 3, 5, 8, 12] as const,
  cvStabilityBreaks: [0.55, 0.35, 0.20, 0.10, 0.05] as const,
});

export interface NormalizationPrimitiveInput {
  latestImportValueUsd: number | null;
  latestImportQuantityTonnes: number | null;
  latestDerivedUnitValueUsdPerKg: number | null;
  indiaShare: number | null;
  indiaRank: number | null;
  indiaPresence: "present" | "absent" | "unknown";
  hhi: number | null;
  top1OriginShare: number | null;
  top3OriginShare: number | null;
  yoy: number | null;
  cagr3Year: number | null;
  cagr5Year: number | null;
  volatility: number | null;
  hasAtLeast5Periods: boolean;
  completeBilateralCoverage: boolean;
}

/** Ascending piecewise interpolation with an evenly spaced 0..100 scale. */
export function piecewise(value: number | null, breaks: readonly number[]): number | null {
  return interpolate(value, breaks, breaks.map((_, index) =>
    Math.round(index * 100 / (breaks.length - 1))
  ));
}

/** Descending breakpoints where lower inputs receive higher scores. */
export function piecewiseInverse(value: number | null, breaks: readonly number[]): number | null {
  return interpolateInverse(value, breaks, breaks.map((_, index) =>
    Math.round(index * 100 / (breaks.length - 1))
  ));
}

function interpolate(
  value: number | null,
  anchors: readonly number[],
  scores: readonly number[],
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (anchors.length < 2 || anchors.length !== scores.length) {
    throw new Error("normalization anchors and scores must have matching lengths >= 2");
  }
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index]! <= anchors[index - 1]!) {
      throw new Error("normalization anchors must be strictly ascending");
    }
  }
  if (value <= anchors[0]!) return scores[0]!;
  if (value >= anchors[anchors.length - 1]!) return scores[scores.length - 1]!;
  for (let index = 1; index < anchors.length; index += 1) {
    const low = anchors[index - 1]!;
    const high = anchors[index]!;
    if (value <= high) {
      const fraction = (value - low) / (high - low);
      return Math.round(scores[index - 1]! + fraction * (scores[index]! - scores[index - 1]!));
    }
  }
  return scores[scores.length - 1]!;
}

function interpolateInverse(
  value: number | null,
  worstToBestAnchors: readonly number[],
  scores: readonly number[],
): number | null {
  return interpolate(value, [...worstToBestAnchors].reverse(), [...scores].reverse());
}

function smootherIndiaRank(input: NormalizationPrimitiveInput): number | null {
  if (!input.completeBilateralCoverage || input.indiaPresence === "unknown") return null;
  if (input.indiaPresence === "absent" || input.indiaRank === null) return 0;
  return Math.max(0, 108 - input.indiaRank * 8);
}

function whitespaceRank(input: NormalizationPrimitiveInput): number | null {
  if (!input.completeBilateralCoverage || input.indiaPresence === "unknown") return null;
  if (input.indiaPresence === "absent" || input.indiaRank === null) return 100;
  return Math.min(100, Math.max(0, (input.indiaRank - 1) * 9));
}

function meanOrNull(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value!;
  return Math.round(total / values.length);
}

function growthPrimitive(input: NormalizationPrimitiveInput): number | null {
  return input.cagr3Year ?? input.cagr5Year ?? input.yoy;
}

/** Candidate C scoring over a transport-neutral primitive shape. */
export function calibratedComponentScores(
  input: NormalizationPrimitiveInput,
  config: NormalizationConfig = CALIBRATED_NORMALIZATION,
): CandidateComponentScores {
  const demandSize = interpolate(
    log10p1(input.latestImportValueUsd), config.demandLog10Usd, config.scoreScale,
  );
  const demandGrowth = interpolate(
    growthPrimitive(input), config.growthCagrPct, config.scoreScale,
  );

  const indiaShareScore = !input.completeBilateralCoverage || input.indiaPresence === "unknown"
    ? null
    : interpolate(input.indiaShare, config.indiaShare, config.scoreScale);
  const rankScore = smootherIndiaRank(input);
  const indiaPosition = indiaShareScore === null || rankScore === null
    ? null
    : Math.round((indiaShareScore * 2 + rankScore) / 3);

  const shareWhitespace = indiaShareScore === null ? null : 100 - indiaShareScore;
  const rankWhitespace = whitespaceRank(input);
  const whitespace = shareWhitespace === null || rankWhitespace === null
    ? null
    : Math.round((shareWhitespace * 2 + rankWhitespace) / 3);
  const contestability = input.completeBilateralCoverage
    ? meanOrNull([
        interpolateInverse(input.hhi, config.hhiWorstToBest, config.scoreScale),
        interpolateInverse(input.top1OriginShare, config.top1WorstToBest, config.scoreScale),
        interpolateInverse(input.top3OriginShare, config.top3WorstToBest, config.scoreScale),
      ])
    : null;
  let competitiveOpportunity = whitespace === null || contestability === null
    ? null
    : Math.round((whitespace * contestability) / 100);
  if (
    competitiveOpportunity !== null &&
    ((input.hhi ?? 0) >= config.concentratedMarketHhiThreshold ||
      (input.top1OriginShare ?? 0) >= config.concentratedMarketTop1Threshold)
  ) {
    competitiveOpportunity = Math.min(
      config.concentratedMarketOpportunityCap,
      competitiveOpportunity,
    );
  }

  let priceAttractiveness = interpolate(
    input.latestDerivedUnitValueUsdPerKg,
    config.derivedUnitValueUsdPerKg,
    config.boundedUnitValueScale,
  );
  if (
    priceAttractiveness !== null && input.latestImportQuantityTonnes !== null &&
    input.latestImportQuantityTonnes < config.smallQuantityThresholdTonnes
  ) {
    priceAttractiveness = Math.min(config.smallQuantityScoreCap, priceAttractiveness);
  }

  const demandStability = input.hasAtLeast5Periods
    ? interpolateInverse(input.volatility, config.volatilityWorstToBest, config.scoreScale)
    : null;

  return {
    demandSize,
    demandGrowth,
    indiaPosition,
    competitiveOpportunity,
    priceAttractiveness,
    demandStability,
  };
}

function primitiveInput(p: CountryPrimitives): NormalizationPrimitiveInput {
  const complete = p.completenessFlags.completeBilateralCoverage;
  return {
    latestImportValueUsd: p.latestImportsUsd,
    latestImportQuantityTonnes: p.latestQuantityTonnes,
    latestDerivedUnitValueUsdPerKg: p.latestDerivedUnitValueUsdPerKg,
    indiaShare: p.indiaShare,
    indiaRank: p.indiaRank,
    indiaPresence: !complete ? "unknown" : p.indiaRank === null ? "absent" : "present",
    hhi: p.hhi,
    top1OriginShare: p.top1OriginShare,
    top3OriginShare: p.top3OriginShare,
    yoy: p.latestYoyPct,
    cagr3Year: p.threeYearCagrPct,
    cagr5Year: p.fiveYearCagrPct,
    volatility: p.volatilityCv,
    hasAtLeast5Periods: p.completenessFlags.hasAtLeast5Periods,
    completeBilateralCoverage: complete,
  };
}

/** Authoritative production scorer. */
export function candidateComponentScores(
  p: CountryPrimitives,
  config: NormalizationConfig = CALIBRATED_NORMALIZATION,
): CandidateComponentScores {
  return calibratedComponentScores(primitiveInput(p), config);
}

/** Exact MI1E reproduction for development/history comparisons only. */
export function legacyProvisionalComponentScores(
  input: NormalizationPrimitiveInput,
  config: LegacyProvisionalNormalizationConfig = LEGACY_PROVISIONAL_NORMALIZATION,
): CandidateComponentScores {
  const demandSize = piecewise(log10p1(input.latestImportValueUsd), config.demandSizeBreaksLog10);
  const growth = growthPrimitive(input);
  const demandGrowth = piecewise(
    growth,
    input.cagr3Year !== null || input.cagr5Year !== null
      ? config.cagrBreaksPct
      : config.yoyBreaksPct,
  );
  const complete = input.completeBilateralCoverage && input.indiaPresence !== "unknown";
  const indiaShareScore = complete ? piecewise(input.indiaShare, config.indiaShareBreaks) : null;
  const rankScore = !complete ? null
    : input.indiaRank === null ? 0
    : input.indiaRank <= 1 ? 100
    : input.indiaRank === 2 ? 80
    : input.indiaRank === 3 ? 60
    : input.indiaRank === 4 ? 40
    : input.indiaRank === 5 ? 20
    : 0;
  const indiaPosition = mixOrNull(indiaShareScore, rankScore, 2, 1);
  const concentrationScore = complete
    ? piecewiseInverse(input.hhi, config.hhiOpportunityBreaks)
    : null;
  const rankFarBehind = !complete ? null
    : input.indiaRank === null ? 100
    : input.indiaRank <= 1 ? 20
    : input.indiaRank === 2 ? 40
    : input.indiaRank === 3 ? 60
    : input.indiaRank === 4 ? 75
    : 90;
  return {
    demandSize,
    demandGrowth,
    indiaPosition,
    competitiveOpportunity: mixOrNull(concentrationScore, rankFarBehind, 2, 1),
    priceAttractiveness: piecewise(
      input.latestDerivedUnitValueUsdPerKg,
      config.unitValueBreaksUsdPerKg,
    ),
    demandStability: input.hasAtLeast5Periods
      ? piecewiseInverse(input.volatility, config.cvStabilityBreaks)
      : null,
  };
}

function mixOrNull(
  a: number | null,
  b: number | null,
  weightA: number,
  weightB: number,
): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return Math.round((a * weightA + b * weightB) / (weightA + weightB));
}
