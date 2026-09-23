/**
 * MI1G — pure development-only calibration review projection.
 *
 * This module reshapes the existing MI1E/MI1E.1 evidence, primitive,
 * confidence, normalization, and Fit outputs. It performs no I/O and never
 * publishes a score. Percentiles use the deterministic nearest-rank (Type 1)
 * implementation in distribution.ts; nulls are excluded and counted.
 */

import { MARKET_FIT_MIN_SUPPORTED_WEIGHT } from "../marketFit";
import type { CandidateComponentScores } from "./normalize";
import { log10p1, outliers, summarize, type DistributionSummary } from "./distribution";
import type { CalibrationReport } from "./report";

export const MI1G_REPORT_VERSION = "mi1g-calibration-review-v1" as const;

export interface CalibrationReviewCountryRow {
  countryAlpha2: string;
  countryName: string;
  latestAvailableYear: number | null;
  latestImportValueUsd: number | null;
  latestImportQuantityTonnes: number | null;
  latestDerivedUnitValueUsdPerKg: number | null;
  indiaImportValueUsd: number | null;
  indiaShare: number | null;
  indiaRank: number | null;
  indiaPresence: "present" | "absent" | "unknown";
  originCount: number | null;
  topOriginCountry: string | null;
  topOriginValueUsd: number | null;
  top1OriginShare: number | null;
  top3OriginShare: number | null;
  /** HHI on a 0..1 scale; 1 is maximally concentrated. */
  hhi: number | null;
  yoy: number | null;
  cagr3Year: number | null;
  cagr5Year: number | null;
  volatility: number | null;
  validAnnualPeriods: number;
  observedYears: number[];
  analyticalCoveragePct: number;
  completeBilateralCoverage: boolean;
  dataConfidenceScore: number;
  confidenceContributors: Record<string, number>;
  mappingKind: "exact" | "proxy" | "composite";
  fitEligibility: "exact" | "proxy_allowed" | "insufficient_specificity";
  candidateComponents: {
    demandSize: number | null;
    growth: number | null;
    indiaPosition: number | null;
    competitiveOpportunity: number | null;
    priceAttractiveness: number | null;
    stability: number | null;
  };
  diagnosticFitScore: number | null;
  recommendationStatus: "actionable" | "indicative" | "insufficient_evidence";
  publicationReason: string;
  supportedComponentWeight: number;
  missingComponents: string[];
  meetsSupportedWeightThreshold: boolean;
}

export type CalibrationPrimitiveKey =
  | "latestImportValueUsd"
  | "latestImportQuantityTonnes"
  | "latestDerivedUnitValueUsdPerKg"
  | "indiaShare"
  | "indiaRank"
  | "originCount"
  | "top1OriginShare"
  | "top3OriginShare"
  | "hhi"
  | "yoy"
  | "cagr3Year"
  | "cagr5Year"
  | "volatility"
  | "dataConfidenceScore";

export interface CalibrationOutlier {
  primitive: CalibrationPrimitiveKey | "log10LatestImportValueUsd";
  countryAlpha2: string;
  value: number;
  reason: string;
  method: "tukey_1_5_iqr";
  lowerFence: number;
  upperFence: number;
}

export interface CalibrationRankingEntry {
  rank: number;
  countryAlpha2: string;
  value: number;
}

export interface NormalizationAssessment {
  component: keyof CandidateComponentScores;
  currentProvisionalRule: string;
  observedPrimitiveDistributions: Record<string, DistributionSummary>;
  observedScoreDistribution: DistributionSummary;
  compressesValues: boolean;
  saturatesTooEasily: boolean;
  outliersDominate: boolean;
  missingnessProblematic: boolean;
  suggestedRevision: string;
}

export interface CalibrationReviewReport {
  version: typeof MI1G_REPORT_VERSION;
  generatedAt: string;
  isDevelopmentOnly: true;
  label: "PROVISIONAL — NOT CALIBRATED";
  normalization: { isProvisional: true };
  percentileMethod: "nearest_rank_type_1";
  hhiScale: "0_to_1";
  supportedWeightThreshold: number;
  cohortSize: number;
  totalBilateralObservations: number;
  allReportersLatestYear2024: boolean;
  rows: CalibrationReviewCountryRow[];
  distributions: Record<CalibrationPrimitiveKey, DistributionSummary>;
  demandSizeDistribution: {
    rawUsd: DistributionSummary;
    log10ValuePlusOne: DistributionSummary;
    logScalingJustified: boolean;
    reason: string;
  };
  outliers: CalibrationOutlier[];
  rankings: Record<string, CalibrationRankingEntry[]>;
  missingnessMatrix: Array<{
    countryAlpha2: string;
    missingPrimitives: string[];
    missingComponents: string[];
    supportedComponentWeight: number;
  }>;
  normalizationReview: NormalizationAssessment[];
  competitiveOpportunityWarnings: Array<{
    countryAlpha2: string;
    indiaShare: number;
    hhi: number;
    top1OriginShare: number | null;
    provisionalScore: number | null;
    reason: string;
  }>;
  derivedUnitValueWarnings: Array<{
    countryAlpha2: string;
    valueUsdPerKg: number;
    latestQuantityTonnes: number | null;
    reason: string;
  }>;
}

export const COMPETITIVE_OPPORTUNITY_WARNING_THRESHOLDS = Object.freeze({
  maximumIndiaShare: 0.01,
  minimumHhi: 0.65,
  minimumTop1OriginShare: 0.80,
});

/**
 * Descriptive diagnostic only. Deliberately independent of the provisional
 * competitive-opportunity score so scoring cannot suppress a warning.
 */
export function buildCompetitiveOpportunityWarnings(
  rows: readonly CalibrationReviewCountryRow[],
): CalibrationReviewReport["competitiveOpportunityWarnings"] {
  const thresholds = COMPETITIVE_OPPORTUNITY_WARNING_THRESHOLDS;
  return rows
    .filter((row) =>
      row.indiaShare !== null && row.indiaShare <= thresholds.maximumIndiaShare &&
      row.hhi !== null && row.hhi >= thresholds.minimumHhi &&
      row.top1OriginShare !== null && row.top1OriginShare >= thresholds.minimumTop1OriginShare
    )
    .map((row) => ({
      countryAlpha2: row.countryAlpha2,
      indiaShare: row.indiaShare!,
      hhi: row.hhi!,
      top1OriginShare: row.top1OriginShare,
      provisionalScore: row.candidateComponents.competitiveOpportunity,
      reason: "Low India presence (share <= 1%) coincides with high incumbent concentration (HHI >= 0.65 and top-1 share >= 80%).",
    }));
}

const PRIMITIVE_KEYS: readonly CalibrationPrimitiveKey[] = [
  "latestImportValueUsd",
  "latestImportQuantityTonnes",
  "latestDerivedUnitValueUsdPerKg",
  "indiaShare",
  "indiaRank",
  "originCount",
  "top1OriginShare",
  "top3OriginShare",
  "hhi",
  "yoy",
  "cagr3Year",
  "cagr5Year",
  "volatility",
  "dataConfidenceScore",
];

function finiteValue(row: CalibrationReviewCountryRow, key: CalibrationPrimitiveKey): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rank(
  rows: readonly CalibrationReviewCountryRow[],
  value: (row: CalibrationReviewCountryRow) => number | null,
): CalibrationRankingEntry[] {
  return rows
    .map((row) => ({ countryAlpha2: row.countryAlpha2, value: value(row) }))
    .filter((entry): entry is { countryAlpha2: string; value: number } => entry.value !== null)
    .sort((a, b) => b.value - a.value || a.countryAlpha2.localeCompare(b.countryAlpha2))
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

function componentMissing(components: CandidateComponentScores): string[] {
  return Object.entries(components)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

function primitiveMissing(row: CalibrationReviewCountryRow): string[] {
  return PRIMITIVE_KEYS.filter((key) => finiteValue(row, key) === null);
}

function outliersFor(
  rows: readonly CalibrationReviewCountryRow[],
  primitive: CalibrationPrimitiveKey,
): CalibrationOutlier[] {
  const pairs = rows
    .map((row) => ({ countryAlpha2: row.countryAlpha2, value: finiteValue(row, primitive) }))
    .filter((pair): pair is { countryAlpha2: string; value: number } => pair.value !== null);
  const result = outliers(pairs.map((pair) => pair.value));
  return result.indices.map((index) => ({
    primitive,
    countryAlpha2: pairs[index]!.countryAlpha2,
    value: pairs[index]!.value,
    reason: pairs[index]!.value < result.low
      ? `below Tukey lower fence ${result.low}`
      : `above Tukey upper fence ${result.high}`,
    method: "tukey_1_5_iqr",
    lowerFence: result.low,
    upperFence: result.high,
  }));
}

function assessment(
  component: keyof CandidateComponentScores,
  values: Array<number | null>,
  currentRule: string,
  observedPrimitiveDistributions: Record<string, DistributionSummary>,
  suggestion: string,
  componentOutliers: boolean,
): NormalizationAssessment {
  const distribution = summarize(values);
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const range = distribution.min !== null && distribution.max !== null
    ? distribution.max - distribution.min
    : 0;
  const boundaryCount = finite.filter((value) => value === 0 || value === 100).length;
  return {
    component,
    currentProvisionalRule: currentRule,
    observedPrimitiveDistributions,
    observedScoreDistribution: distribution,
    compressesValues: finite.length >= 2 && range < 25,
    saturatesTooEasily: finite.length > 0 && boundaryCount / finite.length >= 1 / 3,
    outliersDominate: componentOutliers,
    missingnessProblematic: distribution.missingCount > 0,
    suggestedRevision: suggestion,
  };
}

export function buildCalibrationReviewReport(base: CalibrationReport): CalibrationReviewReport {
  const rows: CalibrationReviewCountryRow[] = base.countries.map((country) => {
    const p = country.primitives;
    const c = country.components;
    const missingComponents = componentMissing(c);
    return {
      countryAlpha2: country.cohort.countryAlpha2,
      countryName: country.cohort.displayName,
      latestAvailableYear: p.latestYear,
      latestImportValueUsd: p.latestImportsUsd,
      latestImportQuantityTonnes: p.latestQuantityTonnes,
      latestDerivedUnitValueUsdPerKg: p.latestDerivedUnitValueUsdPerKg,
      indiaImportValueUsd: p.indiaImportsUsd,
      indiaShare: p.indiaShare,
      indiaRank: p.indiaRank,
      indiaPresence: p.completenessFlags.indiaPresence,
      originCount: p.originCount,
      topOriginCountry: p.topOriginCountry,
      topOriginValueUsd: p.topOriginValueUsd,
      top1OriginShare: p.top1OriginShare,
      top3OriginShare: p.top3OriginShare,
      hhi: p.hhi,
      yoy: p.latestYoyPct,
      cagr3Year: p.threeYearCagrPct,
      cagr5Year: p.fiveYearCagrPct,
      volatility: p.volatilityCv,
      validAnnualPeriods: p.validAnnualPeriods,
      observedYears: p.observedYears,
      analyticalCoveragePct: p.analyticalCoveragePct,
      completeBilateralCoverage: p.completenessFlags.completeBilateralCoverage,
      dataConfidenceScore: country.confidence.score,
      confidenceContributors: country.confidence.components,
      mappingKind: country.fit.fitEligibility === "exact" ? "exact" :
        country.fit.fitEligibility === "proxy_allowed" ? "proxy" : "composite",
      fitEligibility: country.fit.fitEligibility,
      candidateComponents: {
        demandSize: c.demandSize,
        growth: c.demandGrowth,
        indiaPosition: c.indiaPosition,
        competitiveOpportunity: c.competitiveOpportunity,
        priceAttractiveness: c.priceAttractiveness,
        stability: c.demandStability,
      },
      diagnosticFitScore: country.fit.diagnosticFitScore,
      recommendationStatus: country.fit.recommendationStatus,
      publicationReason: `development_only:${country.fit.publicationReason}`,
      supportedComponentWeight: country.fit.supportedWeight,
      missingComponents,
      meetsSupportedWeightThreshold:
        country.fit.supportedWeight >= MARKET_FIT_MIN_SUPPORTED_WEIGHT,
    };
  });

  const distributions = Object.fromEntries(
    PRIMITIVE_KEYS.map((key) => [key, summarize(rows.map((row) => finiteValue(row, key)))]),
  ) as Record<CalibrationPrimitiveKey, DistributionSummary>;

  const rawDemand = rows.map((row) => row.latestImportValueUsd);
  const logDemand = rawDemand.map(log10p1);
  const rawSummary = summarize(rawDemand);
  const logSummary = summarize(logDemand);
  const rawSpread = rawSummary.p90 !== null && rawSummary.p10 !== null && rawSummary.p10 > 0
    ? rawSummary.p90 / rawSummary.p10
    : null;
  const logScalingJustified = rawSpread !== null && rawSpread >= 10;

  const primitiveOutliers = PRIMITIVE_KEYS.flatMap((key) => outliersFor(rows, key));
  const logPairs = rows
    .map((row) => ({ countryAlpha2: row.countryAlpha2, value: log10p1(row.latestImportValueUsd) }))
    .filter((pair): pair is { countryAlpha2: string; value: number } => pair.value !== null);
  const logOutlierResult = outliers(logPairs.map((pair) => pair.value));
  const logOutliers: CalibrationOutlier[] = logOutlierResult.indices.map((index) => ({
    primitive: "log10LatestImportValueUsd",
    countryAlpha2: logPairs[index]!.countryAlpha2,
    value: logPairs[index]!.value,
    reason: logPairs[index]!.value < logOutlierResult.low
      ? `below log-scale Tukey lower fence ${logOutlierResult.low}`
      : `above log-scale Tukey upper fence ${logOutlierResult.high}`,
    method: "tukey_1_5_iqr",
    lowerFence: logOutlierResult.low,
    upperFence: logOutlierResult.high,
  }));
  const allOutliers = [...primitiveOutliers, ...logOutliers];

  const componentValues = (key: keyof CandidateComponentScores) =>
    base.countries.map((country) => country.components[key]);
  const hasOutlier = (primitive: CalibrationPrimitiveKey) =>
    primitiveOutliers.some((item) => item.primitive === primitive);

  const normalizationReview: NormalizationAssessment[] = [
    assessment(
      "demandSize",
      componentValues("demandSize"),
      "Piecewise score over log10(latest import USD + 1).",
      {
        rawUsd: distributions.latestImportValueUsd,
        log10ValuePlusOne: logSummary,
      },
      "Retain a monotonic log transform; review cohort percentile anchors after inspecting raw and log distributions.",
      hasOutlier("latestImportValueUsd"),
    ),
    assessment(
      "demandGrowth",
      componentValues("demandGrowth"),
      "Prefer 3-year CAGR, then 5-year CAGR, then YoY; apply provisional growth bands.",
      {
        yoy: distributions.yoy,
        cagr3Year: distributions.cagr3Year,
        cagr5Year: distributions.cagr5Year,
      },
      "Use robust cohort anchors with symmetric caps; keep calendar elapsed-year and missing-period rules unchanged.",
      hasOutlier("cagr3Year") || hasOutlier("cagr5Year") || hasOutlier("yoy"),
    ),
    assessment(
      "indiaPosition",
      componentValues("indiaPosition"),
      "Two-thirds India share score plus one-third rank score on complete bilateral evidence.",
      { indiaShare: distributions.indiaShare, indiaRank: distributions.indiaRank },
      "Review share percentiles and rank buckets separately; retain absent versus unknown semantics.",
      hasOutlier("indiaShare") || hasOutlier("indiaRank"),
    ),
    assessment(
      "competitiveOpportunity",
      componentValues("competitiveOpportunity"),
      "Two-thirds inverse HHI plus one-third India-rank opportunity.",
      {
        indiaShare: distributions.indiaShare,
        indiaRank: distributions.indiaRank,
        top1OriginShare: distributions.top1OriginShare,
        top3OriginShare: distributions.top3OriginShare,
        hhi: distributions.hhi,
      },
      "Add concentration safeguards using top-1/top-3 share so low India share cannot imply easy entry in a dominated market.",
      hasOutlier("hhi") || hasOutlier("top1OriginShare") || hasOutlier("top3OriginShare"),
    ),
    assessment(
      "priceAttractiveness",
      componentValues("priceAttractiveness"),
      "Piecewise derived unit value USD/kg; this is not a market or selling price.",
      {
        derivedUnitValueUsdPerKg: distributions.latestDerivedUnitValueUsdPerKg,
        quantityTonnes: distributions.latestImportQuantityTonnes,
      },
      "Prefer bounded log/percentile treatment and consider quantity coverage; do not automatically reward the maximum value.",
      hasOutlier("latestDerivedUnitValueUsdPerKg"),
    ),
    assessment(
      "demandStability",
      componentValues("demandStability"),
      "Inverse five-period coefficient of variation with provisional CV bands.",
      { volatilityCv: distributions.volatility },
      "Retain the selected CV primitive; review robust cohort percentile anchors without introducing a second volatility definition.",
      hasOutlier("volatility"),
    ),
  ];

  const competitiveOpportunityWarnings = buildCompetitiveOpportunityWarnings(rows);

  const unitOutlierCountries = new Set(
    primitiveOutliers
      .filter((item) => item.primitive === "latestDerivedUnitValueUsdPerKg")
      .map((item) => item.countryAlpha2),
  );
  const derivedUnitValueWarnings = rows
    .filter((row) =>
      row.latestDerivedUnitValueUsdPerKg !== null && unitOutlierCountries.has(row.countryAlpha2)
    )
    .map((row) => ({
      countryAlpha2: row.countryAlpha2,
      valueUsdPerKg: row.latestDerivedUnitValueUsdPerKg!,
      latestQuantityTonnes: row.latestImportQuantityTonnes,
      reason: row.latestImportQuantityTonnes !== null && row.latestImportQuantityTonnes < 10
        ? "Extreme derived unit value with a small quantity denominator; inspect sparsity and HS-proxy product mix."
        : "Extreme derived unit value; inspect denominator coverage, data sparsity, HS-proxy product mix, and genuine variation.",
    }));

  return {
    version: MI1G_REPORT_VERSION,
    generatedAt: base.producedAt,
    isDevelopmentOnly: true,
    label: "PROVISIONAL — NOT CALIBRATED",
    normalization: { isProvisional: true },
    percentileMethod: "nearest_rank_type_1",
    hhiScale: "0_to_1",
    supportedWeightThreshold: MARKET_FIT_MIN_SUPPORTED_WEIGHT,
    cohortSize: rows.length,
    totalBilateralObservations: base.countries.reduce(
      (total, country) => total + country.evidence.bilateralObservationCount,
      0,
    ),
    allReportersLatestYear2024:
      rows.length > 0 && rows.every((row) => row.latestAvailableYear === 2024),
    rows,
    distributions,
    demandSizeDistribution: {
      rawUsd: rawSummary,
      log10ValuePlusOne: logSummary,
      logScalingJustified,
      reason: rawSpread === null
        ? "Insufficient positive p10/p90 values to assess skew deterministically."
        : `Cohort p90/p10 raw-demand ratio is ${rawSpread}; log scaling is ${logScalingJustified ? "justified" : "not yet compelled"}.`,
    },
    outliers: allOutliers,
    rankings: {
      latestImports: rank(rows, (row) => row.latestImportValueUsd),
      indiaShare: rank(rows, (row) => row.indiaShare),
      cagr3Year: rank(rows, (row) => row.cagr3Year),
      derivedUnitValue: rank(rows, (row) => row.latestDerivedUnitValueUsdPerKg),
      hhi: rank(rows, (row) => row.hhi),
      confidence: rank(rows, (row) => row.dataConfidenceScore),
      provisionalDiagnosticFit: rank(rows, (row) => row.diagnosticFitScore),
    },
    missingnessMatrix: rows.map((row) => ({
      countryAlpha2: row.countryAlpha2,
      missingPrimitives: primitiveMissing(row),
      missingComponents: row.missingComponents,
      supportedComponentWeight: row.supportedComponentWeight,
    })),
    normalizationReview,
    competitiveOpportunityWarnings,
    derivedUnitValueWarnings,
  };
}
