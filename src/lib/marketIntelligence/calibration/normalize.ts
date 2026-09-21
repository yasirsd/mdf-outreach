/**
 * MI1E — component normalization.
 *
 * Deterministic, transparent 0..100 normalization for each Market Fit
 * component. The bands here are the DEFAULT calibration; the operator
 * running the real cohort distribution report can replace them by
 * supplying a `NormalizationConfig` on the diagnostic path. No band
 * boundary is hidden or ML-derived.
 *
 * Every function returns `null` when the input is `null` (data missing).
 * A missing component MUST NOT be silently treated as zero — the caller
 * (formula.ts) drops it from the weighted mean and marks the component
 * as `supported: false`.
 */

import type { CountryPrimitives } from "./primitives";
import { log10p1 } from "./distribution";

export interface NormalizationConfig {
  /** log10(USD+1) breakpoints, ascending, mapped to 0..100 evenly. */
  demandSizeBreaksLog10: readonly number[];
  /** YoY %s in ascending order producing 0..100. */
  yoyBreaksPct: readonly number[];
  /** CAGR %s in ascending order producing 0..100. */
  cagrBreaksPct: readonly number[];
  /** India-share breakpoints (0..1) mapped 0..100 in the "market presence" direction. */
  indiaShareBreaks: readonly number[];
  /** HHI breakpoints (0..1); LOWER concentration → higher opportunity for a new entrant. */
  hhiOpportunityBreaks: readonly number[];
  /** Derived unit value (USD/kg) breakpoints; premium markets score higher. */
  unitValueBreaksUsdPerKg: readonly number[];
  /** CV breakpoints; LOWER volatility → higher stability score. */
  cvStabilityBreaks: readonly number[];
}

/**
 * Provisional defaults. Documented for review; operator MUST re-derive
 * against the real cohort distribution report before publication.
 *   Demand size: rough steps around log10(USD+1) 5.0 → 8.5
 *     (i.e. ~USD 100k → ~USD 316M)
 *   YoY / CAGR: mid at 0%, cap at ±30% to avoid a single spike dominating
 *   India share: 0, 5%, 15%, 30% ,50%
 *   HHI: 0.10, 0.20, 0.35, 0.55  (lower is better)
 *   Unit value: 2, 3, 5, 8, 12  (USD/kg for dried chillies)
 *   Stability CV: 0.10, 0.20, 0.35, 0.55  (lower is better)
 */
export const DEFAULT_NORMALIZATION: NormalizationConfig = Object.freeze({
  demandSizeBreaksLog10: [5.0, 6.0, 6.75, 7.5, 8.5] as const,
  yoyBreaksPct: [-30, -10, 0, 10, 30] as const,
  cagrBreaksPct: [-15, -5, 0, 5, 15] as const,
  indiaShareBreaks: [0.0, 0.05, 0.15, 0.30, 0.50] as const,
  hhiOpportunityBreaks: [0.55, 0.35, 0.20, 0.10, 0.05] as const,
  unitValueBreaksUsdPerKg: [2, 3, 5, 8, 12] as const,
  cvStabilityBreaks: [0.55, 0.35, 0.20, 0.10, 0.05] as const,
});

/**
 * Map a numeric value against an ascending-breakpoints ladder to 0..100.
 * Values at or below break[0] map to 0; at or above break[last] map to
 * 100; between i and i+1 map linearly across (i/last, (i+1)/last).
 */
export function piecewise(value: number | null, breaks: readonly number[]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (breaks.length < 2) throw new Error("piecewise requires ≥2 breakpoints");
  const asc = [...breaks];
  for (let i = 1; i < asc.length; i += 1) {
    if (asc[i]! < asc[i - 1]!) throw new Error("piecewise breakpoints must be ascending");
  }
  const step = 100 / (asc.length - 1);
  if (value <= asc[0]!) return 0;
  if (value >= asc[asc.length - 1]!) return 100;
  for (let i = 1; i < asc.length; i += 1) {
    const lo = asc[i - 1]!;
    const hi = asc[i]!;
    if (value <= hi) {
      const frac = (value - lo) / (hi - lo);
      return round(step * (i - 1) + step * frac);
    }
  }
  return 100;
}

/** Same as piecewise, but for scores where LOWER input → HIGHER score. */
export function piecewiseInverse(value: number | null, breaks: readonly number[]): number | null {
  const raw = piecewiseAscendingLower(value, breaks);
  return raw === null ? null : raw;
}

function piecewiseAscendingLower(value: number | null, breaks: readonly number[]): number | null {
  // breaks are given HIGH → LOW (worst → best); flip to piecewise's contract.
  if (value === null || !Number.isFinite(value)) return null;
  if (breaks.length < 2) throw new Error("piecewiseInverse requires ≥2 breakpoints");
  for (let i = 1; i < breaks.length; i += 1) {
    if (breaks[i]! > breaks[i - 1]!) {
      throw new Error("piecewiseInverse breakpoints must be descending (worst first)");
    }
  }
  const worst = breaks[0]!;
  const best = breaks[breaks.length - 1]!;
  if (value >= worst) return 0;
  if (value <= best) return 100;
  const step = 100 / (breaks.length - 1);
  for (let i = 1; i < breaks.length; i += 1) {
    const hi = breaks[i - 1]!;
    const lo = breaks[i]!;
    if (value >= lo) {
      const frac = (hi - value) / (hi - lo);
      return round(step * (i - 1) + step * frac);
    }
  }
  return 100;
}

function round(n: number): number {
  return Math.round(n);
}

export interface CandidateComponentScores {
  demandSize: number | null;
  demandGrowth: number | null;
  indiaPosition: number | null;
  competitiveOpportunity: number | null;
  priceAttractiveness: number | null;
  demandStability: number | null;
}

/**
 * Combine primitives into candidate 0..100 component scores using the
 * provided (or default) config. Any missing input yields `null` for the
 * component — the formula composer treats null as "unsupported".
 */
export function candidateComponentScores(
  p: CountryPrimitives,
  config: NormalizationConfig = DEFAULT_NORMALIZATION,
): CandidateComponentScores {
  // Demand size — log10(imports_usd + 1) against ascending band ladder.
  const demandSize = piecewise(log10p1(p.latestImportsUsd), config.demandSizeBreaksLog10);

  // Demand growth — favour the 3-year CAGR when available; fall back to
  // 5-year CAGR; if neither, latest YoY. Explicit precedence keeps the
  // number explainable.
  const growthInput =
    p.threeYearCagrPct !== null
      ? p.threeYearCagrPct
      : p.fiveYearCagrPct !== null
        ? p.fiveYearCagrPct
        : p.latestYoyPct;
  const demandGrowth = piecewise(
    growthInput,
    p.threeYearCagrPct !== null || p.fiveYearCagrPct !== null
      ? config.cagrBreaksPct
      : config.yoyBreaksPct,
  );

  // India position — combine share (2/3) and rank (1/3). Requires the
  // origin set to be PROVEN complete (indiaPresence ≠ "unknown"). If
  // India is provably absent, share=0 and rank score = 0.
  const complete = p.completenessFlags.completeBilateralCoverage;
  const indiaShareScore = complete ? piecewise(p.indiaShare, config.indiaShareBreaks) : null;
  const rankScore = ((): number | null => {
    if (!complete) return null;
    if (p.indiaRank === null) return 0; // complete + India absent
    if (p.indiaRank <= 1) return 100;
    if (p.indiaRank === 2) return 80;
    if (p.indiaRank === 3) return 60;
    if (p.indiaRank === 4) return 40;
    if (p.indiaRank === 5) return 20;
    return 0;
  })();
  const indiaPosition = mixOrNull(indiaShareScore, rankScore, 2, 1);

  // Competitive opportunity — inverse concentration + India's rank.
  // Also gated on proven completeness; otherwise the concentration
  // measure would be built on a possibly-incomplete origin set.
  const concentrationScore = complete
    ? piecewiseInverse(p.hhi, config.hhiOpportunityBreaks)
    : null;
  const rankFarBehind = ((): number | null => {
    if (!complete) return null;
    if (p.indiaRank === null) return 100; // India provably absent → wide-open lane
    if (p.indiaRank <= 1) return 20;
    if (p.indiaRank === 2) return 40;
    if (p.indiaRank === 3) return 60;
    if (p.indiaRank === 4) return 75;
    return 90;
  })();
  const competitiveOpportunity = mixOrNull(concentrationScore, rankFarBehind, 2, 1);

  // Price attractiveness — derived unit value USD/kg (labelled elsewhere;
  // NEVER a market price). Higher unit value → higher score up to a cap.
  const priceAttractiveness = piecewise(
    p.latestDerivedUnitValueUsdPerKg,
    config.unitValueBreaksUsdPerKg,
  );

  // Stability — inverse coefficient of variation. Requires ≥ 5 valid
  // annual periods; otherwise `null` (unavailable, not zero).
  const demandStability = p.completenessFlags.hasAtLeast5Periods
    ? piecewiseInverse(p.volatilityCv, config.cvStabilityBreaks)
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

function mixOrNull(
  a: number | null, b: number | null, wa: number, wb: number,
): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return round((a * wa + b * wb) / (wa + wb));
}
