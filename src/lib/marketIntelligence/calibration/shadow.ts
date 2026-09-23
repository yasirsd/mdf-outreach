/**
 * MI1G.1 — deterministic SHADOW calibration candidates.
 *
 * Candidate B freezes the MI1G 18-country reference percentiles supplied by
 * the operator. Candidate C blends those observations with economically
 * interpretable absolute anchors. Neither config replaces DEFAULT_NORMALIZATION
 * and neither function performs I/O or persistence.
 */

import type { CandidateComponentScores } from "./normalize";
import { DEFAULT_COMPONENT_WEIGHTS, composeCandidateFit } from "./formula";
import { log10p1, summarize, type DistributionSummary } from "./distribution";
import type { CalibrationReviewCountryRow, CalibrationReviewReport } from "./review";
import { COMPETITIVE_OPPORTUNITY_WARNING_THRESHOLDS } from "./review";

export const SHADOW_COMPARISON_VERSION = "mi1g.1-shadow-v1" as const;

type ComponentKey = keyof CandidateComponentScores;
type ShadowModel = "candidateB" | "candidateC";

export const CANDIDATE_B_ANCHORS = Object.freeze({
  demandLog10Usd: [
    6.022192806694595,
    6.671280801015471,
    7.0133240362155576,
    7.527132535863375,
    8.292340861292292,
  ] as const,
  growthCagrPct: [
    -8.359812515043997,
    -4.930858843369634,
    3.4295619936054678,
    10.589304000430634,
    14.600178248107397,
  ] as const,
  indiaShare: [
    0.0033264269033277324,
    0.06157191230749718,
    0.24577046525284432,
    0.6716442488699115,
    0.9783944679068778,
  ] as const,
  hhiWorstToBest: [
    0.9577214511675397,
    0.552328459076878,
    0.32658083130974663,
    0.2358322040054253,
    0.17617162285108676,
  ] as const,
  top1WorstToBest: [0.97, 0.85, 0.70, 0.50, 0.30] as const,
  top3WorstToBest: [0.995, 0.95, 0.85, 0.70, 0.50] as const,
  derivedUnitValueUsdPerKg: [
    2.2791201500112366,
    2.557039167893301,
    3.1110646837390314,
    6.335386489568992,
    6.918914650707349,
  ] as const,
  volatilityWorstToBest: [
    0.3353771099310844,
    0.20868503211858255,
    0.14191870827627381,
    0.11430255828935479,
    0.09417928716287363,
  ] as const,
  scoreScale: [0, 25, 50, 75, 100] as const,
  boundedUnitValueScale: [10, 30, 50, 70, 85] as const,
});

export const CANDIDATE_C_ANCHORS = Object.freeze({
  demandLog10Usd: [6.0, 6.75, 7.25, 7.75, 8.5] as const,
  growthCagrPct: [-10, -5, 2.5, 10, 20] as const,
  indiaShare: [0, 0.05, 0.20, 0.50, 0.90] as const,
  hhiWorstToBest: [0.85, 0.60, 0.40, 0.25, 0.15] as const,
  top1WorstToBest: [0.90, 0.75, 0.60, 0.45, 0.30] as const,
  top3WorstToBest: [0.98, 0.90, 0.80, 0.65, 0.50] as const,
  derivedUnitValueUsdPerKg: [2, 3, 5, 8, 12] as const,
  volatilityWorstToBest: [0.50, 0.30, 0.20, 0.10, 0.05] as const,
  scoreScale: [0, 25, 50, 75, 100] as const,
  boundedUnitValueScale: [10, 35, 60, 75, 85] as const,
});

export const SHADOW_WEIGHTS = Object.freeze({ ...DEFAULT_COMPONENT_WEIGHTS });

export const WEIGHT_SENSITIVITY_VARIANTS = Object.freeze({
  demandEmphasis: {
    demandSize: 30,
    demandGrowth: 20,
    indiaPosition: 15,
    competitiveOpportunity: 15,
    priceAttractiveness: 10,
    demandStability: 10,
  },
  growthContestabilityEmphasis: {
    demandSize: 20,
    demandGrowth: 25,
    indiaPosition: 15,
    competitiveOpportunity: 20,
    priceAttractiveness: 10,
    demandStability: 10,
  },
} satisfies Record<string, Record<ComponentKey, number>>);

export interface ShadowScore {
  components: CandidateComponentScores;
  diagnosticFitScore: number | null;
  recommendationStatus: "actionable" | "indicative" | "insufficient_evidence";
  supportedWeight: number;
  /** Copied unchanged from the evidence-quality model; never recalibrated here. */
  dataConfidenceScore: number;
  confidenceContributors: Record<string, number>;
}

export interface ComponentDiagnostics extends DistributionSummary {
  zeroCount: number;
  hundredCount: number;
}

export interface RankDiagnostics {
  spearmanCorrelation: number;
  maximumAbsoluteRankMovement: number;
  meanAbsoluteRankMovement: number;
  top5Overlap: number;
  bottom5Overlap: number;
}

export interface ModelDiagnostics {
  components: Record<ComponentKey, ComponentDiagnostics>;
  fit: DistributionSummary;
  fitMin: number | null;
  fitMedian: number | null;
  fitMax: number | null;
  versusProvisional: RankDiagnostics;
}

export interface CountryShadowComparison {
  countryAlpha2: string;
  provisional: ShadowScore & { rank: number };
  candidateB: ShadowScore & {
    rank: number;
    rankMovementVersusProvisional: number;
    largestComponentChange: { component: ComponentKey; delta: number; reason: string };
  };
  candidateC: ShadowScore & {
    rank: number;
    rankMovementVersusProvisional: number;
    largestComponentChange: { component: ComponentKey; delta: number; reason: string };
  };
}

export interface CalibrationComparison {
  version: typeof SHADOW_COMPARISON_VERSION;
  isDevelopmentOnly: true;
  label: "SHADOW — NOT CALIBRATED — DO NOT PUBLISH";
  productionNormalizationReplaced: false;
  models: {
    provisional: { label: "CURRENT PROVISIONAL"; methodology: string };
    candidateB: { label: "PERCENTILE-CALIBRATED SHADOW"; methodology: string };
    candidateC: { label: "CONSERVATIVE HYBRID SHADOW"; methodology: string };
  };
  anchors: {
    candidateB: typeof CANDIDATE_B_ANCHORS;
    candidateC: typeof CANDIDATE_C_ANCHORS;
  };
  weights: typeof SHADOW_WEIGHTS;
  countries: CountryShadowComparison[];
  diagnostics: {
    candidateB: ModelDiagnostics;
    candidateC: ModelDiagnostics;
  };
  weightSensitivity: Record<ShadowModel, Record<string, RankDiagnostics & { materialChange: boolean }>>;
  scenarioTests: Array<{
    id: string;
    passed: boolean;
    details: string;
  }>;
  warningDiagnostics: {
    thresholds: typeof COMPETITIVE_OPPORTUNITY_WARNING_THRESHOLDS;
    warnings: CalibrationReviewReport["competitiveOpportunityWarnings"];
  };
}

function interpolate(
  value: number | null,
  anchors: readonly number[],
  scores: readonly number[],
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (anchors.length < 2 || anchors.length !== scores.length) {
    throw new Error("shadow calibration anchors and scores must have matching lengths >= 2");
  }
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index]! <= anchors[index - 1]!) {
      throw new Error("shadow calibration anchors must be strictly ascending");
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
  return interpolate(
    value,
    [...worstToBestAnchors].reverse(),
    [...scores].reverse(),
  );
}

function smootherIndiaRank(rank: number | null, presence: CalibrationReviewCountryRow["indiaPresence"]): number | null {
  if (presence === "unknown") return null;
  if (presence === "absent" || rank === null) return 0;
  return Math.max(0, 108 - rank * 8);
}

function whitespaceRank(rank: number | null, presence: CalibrationReviewCountryRow["indiaPresence"]): number | null {
  if (presence === "unknown") return null;
  if (presence === "absent" || rank === null) return 100;
  return Math.min(100, Math.max(0, (rank - 1) * 9));
}

function meanOrNull(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value!;
  return Math.round(total / values.length);
}

function growthPrimitive(row: CalibrationReviewCountryRow): number | null {
  return row.cagr3Year ?? row.cagr5Year ?? row.yoy;
}

function scoreComponents(
  row: CalibrationReviewCountryRow,
  model: ShadowModel,
): CandidateComponentScores {
  const anchors = model === "candidateB" ? CANDIDATE_B_ANCHORS : CANDIDATE_C_ANCHORS;
  const scoreScale = anchors.scoreScale;
  const demandSize = interpolate(log10p1(row.latestImportValueUsd), anchors.demandLog10Usd, scoreScale);
  const demandGrowth = interpolate(growthPrimitive(row), anchors.growthCagrPct, scoreScale);

  const indiaShareScore = row.indiaPresence === "unknown"
    ? null
    : interpolate(row.indiaShare, anchors.indiaShare, scoreScale);
  const rankScore = smootherIndiaRank(row.indiaRank, row.indiaPresence);
  const indiaPosition = indiaShareScore === null || rankScore === null
    ? null
    : Math.round((indiaShareScore * 2 + rankScore) / 3);

  const shareWhitespace = indiaShareScore === null ? null : 100 - indiaShareScore;
  const rankWhitespace = whitespaceRank(row.indiaRank, row.indiaPresence);
  const whitespace = shareWhitespace === null || rankWhitespace === null
    ? null
    : Math.round((shareWhitespace * 2 + rankWhitespace) / 3);
  const contestability = meanOrNull([
    interpolateInverse(row.hhi, anchors.hhiWorstToBest, scoreScale),
    interpolateInverse(row.top1OriginShare, anchors.top1WorstToBest, scoreScale),
    interpolateInverse(row.top3OriginShare, anchors.top3WorstToBest, scoreScale),
  ]);
  let competitiveOpportunity = whitespace === null || contestability === null
    ? null
    : Math.round((whitespace * contestability) / 100);
  if (
    model === "candidateC" && competitiveOpportunity !== null &&
    ((row.hhi ?? 0) >= 0.70 || (row.top1OriginShare ?? 0) >= 0.85)
  ) {
    competitiveOpportunity = Math.min(25, competitiveOpportunity);
  }

  let priceAttractiveness = interpolate(
    row.latestDerivedUnitValueUsdPerKg,
    anchors.derivedUnitValueUsdPerKg,
    anchors.boundedUnitValueScale,
  );
  if (priceAttractiveness !== null && row.latestImportQuantityTonnes !== null &&
      row.latestImportQuantityTonnes < 10) {
    priceAttractiveness = Math.min(model === "candidateB" ? 40 : 30, priceAttractiveness);
  }

  const demandStability = interpolateInverse(
    row.volatility,
    anchors.volatilityWorstToBest,
    scoreScale,
  );
  return {
    demandSize,
    demandGrowth,
    indiaPosition,
    competitiveOpportunity,
    priceAttractiveness,
    demandStability,
  };
}

export function scoreCandidateB(row: CalibrationReviewCountryRow): CandidateComponentScores {
  return scoreComponents(row, "candidateB");
}

export function scoreCandidateC(row: CalibrationReviewCountryRow): CandidateComponentScores {
  return scoreComponents(row, "candidateC");
}

function fit(
  row: CalibrationReviewCountryRow,
  components: CandidateComponentScores,
  weights: Record<ComponentKey, number> = SHADOW_WEIGHTS,
): ShadowScore {
  const result = composeCandidateFit({
    components,
    mappingKind: row.mappingKind,
    mappingConfidence: row.mappingKind === "proxy" ? 0.7 : row.mappingKind === "exact" ? 0.95 : 0.3,
    confidence: {
      score: row.dataConfidenceScore,
      components: row.confidenceContributors,
      supported: row.dataConfidenceScore >= 50 && row.validAnnualPeriods >= 3,
    },
    hasDemandSizeEvidence: row.latestImportValueUsd !== null,
    hasHistoricalEvidence: row.validAnnualPeriods >= 3,
    weights,
  });
  return {
    components,
    diagnosticFitScore: result.diagnosticFitScore,
    recommendationStatus: result.recommendationStatus,
    supportedWeight: result.supportedWeight,
    dataConfidenceScore: row.dataConfidenceScore,
    confidenceContributors: { ...row.confidenceContributors },
  };
}

function provisionalScore(row: CalibrationReviewCountryRow): ShadowScore {
  return {
    components: {
      demandSize: row.candidateComponents.demandSize,
      demandGrowth: row.candidateComponents.growth,
      indiaPosition: row.candidateComponents.indiaPosition,
      competitiveOpportunity: row.candidateComponents.competitiveOpportunity,
      priceAttractiveness: row.candidateComponents.priceAttractiveness,
      demandStability: row.candidateComponents.stability,
    },
    diagnosticFitScore: row.diagnosticFitScore,
    recommendationStatus: row.recommendationStatus,
    supportedWeight: row.supportedComponentWeight,
    dataConfidenceScore: row.dataConfidenceScore,
    confidenceContributors: { ...row.confidenceContributors },
  };
}

function ranked(scores: ReadonlyMap<string, ShadowScore>): Map<string, number> {
  return new Map(
    [...scores.entries()]
      .sort(([countryA, a], [countryB, b]) =>
        (b.diagnosticFitScore ?? -Infinity) - (a.diagnosticFitScore ?? -Infinity) ||
        countryA.localeCompare(countryB)
      )
      .map(([country], index) => [country, index + 1]),
  );
}

function rankDiagnostics(
  reference: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
): RankDiagnostics {
  const countries = [...reference.keys()].filter((country) => candidate.has(country));
  const movements = countries.map((country) => candidate.get(country)! - reference.get(country)!);
  const squared = movements.reduce((total, movement) => total + movement ** 2, 0);
  const n = countries.length;
  const correlation = n < 2 ? 1 : 1 - (6 * squared) / (n * (n ** 2 - 1));
  const top = (ranks: ReadonlyMap<string, number>) =>
    new Set([...ranks.entries()].filter(([, value]) => value <= 5).map(([country]) => country));
  const bottom = (ranks: ReadonlyMap<string, number>) =>
    new Set([...ranks.entries()].filter(([, value]) => value > n - 5).map(([country]) => country));
  const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((value) => b.has(value)).length;
  return {
    spearmanCorrelation: correlation,
    maximumAbsoluteRankMovement: Math.max(0, ...movements.map(Math.abs)),
    meanAbsoluteRankMovement: n === 0
      ? 0
      : movements.reduce((total, movement) => total + Math.abs(movement), 0) / n,
    top5Overlap: overlap(top(reference), top(candidate)),
    bottom5Overlap: overlap(bottom(reference), bottom(candidate)),
  };
}

function componentDiagnostics(scores: readonly ShadowScore[]): Record<ComponentKey, ComponentDiagnostics> {
  const keys: ComponentKey[] = [
    "demandSize", "demandGrowth", "indiaPosition",
    "competitiveOpportunity", "priceAttractiveness", "demandStability",
  ];
  return Object.fromEntries(keys.map((key) => {
    const values = scores.map((score) => score.components[key]);
    const finite = values.filter((value): value is number => value !== null);
    return [key, {
      ...summarize(values),
      zeroCount: finite.filter((value) => value === 0).length,
      hundredCount: finite.filter((value) => value === 100).length,
    }];
  })) as Record<ComponentKey, ComponentDiagnostics>;
}

function modelDiagnostics(
  scores: ReadonlyMap<string, ShadowScore>,
  provisionalRanks: ReadonlyMap<string, number>,
): ModelDiagnostics {
  const values = [...scores.values()];
  const fitSummary = summarize(values.map((score) => score.diagnosticFitScore));
  return {
    components: componentDiagnostics(values),
    fit: fitSummary,
    fitMin: fitSummary.min,
    fitMedian: fitSummary.median,
    fitMax: fitSummary.max,
    versusProvisional: rankDiagnostics(provisionalRanks, ranked(scores)),
  };
}

const CHANGE_REASONS: Record<ComponentKey, string> = {
  demandSize: "Frozen log-demand anchors redistribute the highly skewed import-value range.",
  demandGrowth: "Robust CAGR anchors replace the provisional generic growth ladder.",
  indiaPosition: "Smoother India-share and rank scoring reduces saturation and coarse rank jumps.",
  competitiveOpportunity: "Whitespace is multiplied by contestability, so incumbent concentration materially reduces opportunity.",
  priceAttractiveness: "Derived unit value is bounded and tiny quantity denominators are capped.",
  demandStability: "Inverse CV uses explicit frozen reference anchors.",
};

function largestChange(
  provisional: CandidateComponentScores,
  candidate: CandidateComponentScores,
): { component: ComponentKey; delta: number; reason: string } {
  const keys = Object.keys(provisional) as ComponentKey[];
  const compared = keys
    .filter((key) => provisional[key] !== null && candidate[key] !== null)
    .map((key) => ({ key, delta: candidate[key]! - provisional[key]! }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
  const winner = compared[0] ?? { key: "demandSize" as const, delta: 0 };
  return { component: winner.key, delta: winner.delta, reason: CHANGE_REASONS[winner.key] };
}

function scenarioRow(
  countryAlpha2: string,
  overrides: Partial<CalibrationReviewCountryRow>,
): CalibrationReviewCountryRow {
  return {
    countryAlpha2,
    countryName: countryAlpha2,
    latestAvailableYear: 2024,
    latestImportValueUsd: 50_000_000,
    latestImportQuantityTonnes: 10_000,
    latestDerivedUnitValueUsdPerKg: 5,
    indiaImportValueUsd: 5_000_000,
    indiaShare: 0.10,
    indiaRank: 3,
    indiaPresence: "present",
    originCount: 20,
    topOriginCountry: "CN",
    topOriginValueUsd: 10_000_000,
    top1OriginShare: 0.20,
    top3OriginShare: 0.45,
    hhi: 0.15,
    yoy: 5,
    cagr3Year: 5,
    cagr5Year: 5,
    volatility: 0.15,
    validAnnualPeriods: 7,
    observedYears: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
    analyticalCoveragePct: 100,
    completeBilateralCoverage: true,
    dataConfidenceScore: 90,
    confidenceContributors: {},
    mappingKind: "proxy",
    fitEligibility: "proxy_allowed",
    candidateComponents: {
      demandSize: 50,
      growth: 50,
      indiaPosition: 50,
      competitiveOpportunity: 50,
      priceAttractiveness: 50,
      stability: 50,
    },
    diagnosticFitScore: 50,
    recommendationStatus: "indicative",
    publicationReason: "development_only",
    supportedComponentWeight: 100,
    missingComponents: [],
    meetsSupportedWeightThreshold: true,
    ...overrides,
  };
}

function scenarioTests(): CalibrationComparison["scenarioTests"] {
  const huge = scenarioRow("S1", { latestImportValueUsd: 500_000_000, cagr3Year: 8, indiaShare: 0.25, indiaRank: 2 });
  const tinyGrowth = scenarioRow("S2", { latestImportValueUsd: 100_000, cagr3Year: 80 });
  const concentrated = scenarioRow("S3", {
    indiaImportValueUsd: 0, indiaShare: 0, indiaRank: null, indiaPresence: "absent",
    hhi: 0.95, top1OriginShare: 0.97, top3OriginShare: 0.995,
  });
  const diversified = scenarioRow("S4", {
    indiaImportValueUsd: 0, indiaShare: 0, indiaRank: null, indiaPresence: "absent",
    hhi: 0.15, top1OriginShare: 0.20, top3OriginShare: 0.45,
  });
  const indiaDominant = scenarioRow("S5", { indiaShare: 0.98, indiaRank: 1, hhi: 0.40 });
  const tinyQuantity = scenarioRow("S6", {
    latestDerivedUnitValueUsdPerKg: 50, latestImportQuantityTonnes: 1,
  });
  const stableLowGrowth = scenarioRow("S7", { cagr3Year: -2, volatility: 0.05 });
  const fastVolatile = scenarioRow("S8", { cagr3Year: 30, volatility: 0.60 });
  const excellentProxy = scenarioRow("S9", {
    latestImportValueUsd: 1_000_000_000,
    cagr3Year: 30,
    indiaShare: 0.50,
    indiaRank: 1,
    hhi: 0.15,
    top1OriginShare: 0.20,
    top3OriginShare: 0.45,
    latestDerivedUnitValueUsdPerKg: 10,
    volatility: 0.05,
  });
  const s1 = fit(huge, scoreCandidateB(huge));
  const s2 = fit(tinyGrowth, scoreCandidateB(tinyGrowth));
  const s3 = fit(concentrated, scoreCandidateB(concentrated));
  const s4 = fit(diversified, scoreCandidateB(diversified));
  const s5 = fit(indiaDominant, scoreCandidateB(indiaDominant));
  const s6 = fit(tinyQuantity, scoreCandidateB(tinyQuantity));
  const s7 = fit(stableLowGrowth, scoreCandidateB(stableLowGrowth));
  const s8 = fit(fastVolatile, scoreCandidateB(fastVolatile));
  const s9 = fit(excellentProxy, scoreCandidateB(excellentProxy));
  const result = (id: string, passed: boolean, details: string) => ({ id, passed, details });
  return [
    result("huge_diversified", (s1.components.demandSize ?? 0) >= 75, JSON.stringify(s1.components)),
    result("tiny_extreme_growth", (s2.components.demandSize ?? 100) <= 10 && (s2.components.demandGrowth ?? 0) === 100, JSON.stringify(s2.components)),
    result("concentrated_whitespace", (s3.components.competitiveOpportunity ?? 100) <= 10, JSON.stringify(s3.components)),
    result("diversified_whitespace", (s4.components.competitiveOpportunity ?? 0) >= 80, JSON.stringify(s4.components)),
    result("india_dominant", (s5.components.indiaPosition ?? 0) >= 95 && (s5.components.competitiveOpportunity ?? 100) <= 20, JSON.stringify(s5.components)),
    result("tiny_quantity_high_unit_value", (s6.components.priceAttractiveness ?? 100) <= 40, JSON.stringify(s6.components)),
    result("stable_low_growth", (s7.components.demandStability ?? 0) > (s7.components.demandGrowth ?? 100), JSON.stringify(s7.components)),
    result("fast_growing_volatile", (s8.components.demandGrowth ?? 0) > (s8.components.demandStability ?? 100), JSON.stringify(s8.components)),
    result("excellent_proxy_ceiling", s9.recommendationStatus === "indicative", `fit=${s9.diagnosticFitScore} status=${s9.recommendationStatus}`),
  ];
}

export function buildCalibrationComparison(review: CalibrationReviewReport): CalibrationComparison {
  const provisional = new Map(review.rows.map((row) => [row.countryAlpha2, provisionalScore(row)]));
  const candidateB = new Map(review.rows.map((row) => [row.countryAlpha2, fit(row, scoreCandidateB(row))]));
  const candidateC = new Map(review.rows.map((row) => [row.countryAlpha2, fit(row, scoreCandidateC(row))]));
  const provisionalRanks = ranked(provisional);
  const candidateBRanks = ranked(candidateB);
  const candidateCRanks = ranked(candidateC);

  const countries = review.rows.map((row) => {
    const p = provisional.get(row.countryAlpha2)!;
    const b = candidateB.get(row.countryAlpha2)!;
    const c = candidateC.get(row.countryAlpha2)!;
    const provisionalRank = provisionalRanks.get(row.countryAlpha2)!;
    const bRank = candidateBRanks.get(row.countryAlpha2)!;
    const cRank = candidateCRanks.get(row.countryAlpha2)!;
    return {
      countryAlpha2: row.countryAlpha2,
      provisional: { ...p, rank: provisionalRank },
      candidateB: {
        ...b,
        rank: bRank,
        rankMovementVersusProvisional: provisionalRank - bRank,
        largestComponentChange: largestChange(p.components, b.components),
      },
      candidateC: {
        ...c,
        rank: cRank,
        rankMovementVersusProvisional: provisionalRank - cRank,
        largestComponentChange: largestChange(p.components, c.components),
      },
    };
  });

  const sensitivityFor = (
    model: ShadowModel,
    defaultRanks: ReadonlyMap<string, number>,
  ): Record<string, RankDiagnostics & { materialChange: boolean }> => Object.fromEntries(
    Object.entries(WEIGHT_SENSITIVITY_VARIANTS).map(([name, weights]) => {
      const variant = new Map(review.rows.map((row) => [
        row.countryAlpha2,
        fit(row, model === "candidateB" ? scoreCandidateB(row) : scoreCandidateC(row), weights),
      ]));
      const diagnostics = rankDiagnostics(defaultRanks, ranked(variant));
      return [name, {
        ...diagnostics,
        materialChange:
          diagnostics.maximumAbsoluteRankMovement > 3 || diagnostics.spearmanCorrelation < 0.90,
      }];
    }),
  );

  return {
    version: SHADOW_COMPARISON_VERSION,
    isDevelopmentOnly: true,
    label: "SHADOW — NOT CALIBRATED — DO NOT PUBLISH",
    productionNormalizationReplaced: false,
    models: {
      provisional: {
        label: "CURRENT PROVISIONAL",
        methodology: "Existing DEFAULT_NORMALIZATION output, unchanged.",
      },
      candidateB: {
        label: "PERCENTILE-CALIBRATED SHADOW",
        methodology: "Frozen MI1G reference percentiles with smooth monotonic interpolation; whitespace multiplied by contestability.",
      },
      candidateC: {
        label: "CONSERVATIVE HYBRID SHADOW",
        methodology: "Economically interpretable absolute anchors informed by the MI1G ranges, with conservative concentration and derived-unit-value caps.",
      },
    },
    anchors: { candidateB: CANDIDATE_B_ANCHORS, candidateC: CANDIDATE_C_ANCHORS },
    weights: SHADOW_WEIGHTS,
    countries,
    diagnostics: {
      candidateB: modelDiagnostics(candidateB, provisionalRanks),
      candidateC: modelDiagnostics(candidateC, provisionalRanks),
    },
    weightSensitivity: {
      candidateB: sensitivityFor("candidateB", candidateBRanks),
      candidateC: sensitivityFor("candidateC", candidateCRanks),
    },
    scenarioTests: scenarioTests(),
    warningDiagnostics: {
      thresholds: COMPETITIVE_OPPORTUNITY_WARNING_THRESHOLDS,
      warnings: review.competitiveOpportunityWarnings,
    },
  };
}
