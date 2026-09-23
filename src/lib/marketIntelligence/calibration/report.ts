/**
 * MI1H — DEVELOPMENT-ONLY review of the calibrated production contract.
 *
 * Pure function. Consumes an already-built `CalibrationEvidenceContext`
 * per country — the caller reads observations + ledger via the existing
 * `MarketReadRepository`; the report itself makes no provider or DB
 * call.
 *
 * Candidate C is production normalization. The old MI1E provisional config
 * is retained solely for reproducible historical/debug comparisons.
 */

import type { CalibrationCohortEntry } from "./cohort";
import type { CalibrationEvidenceContext } from "./evidence";
import { computeCountryPrimitives, type CountryPrimitives } from "./primitives";
import { summarize, type DistributionSummary } from "./distribution";
import {
  DEFAULT_NORMALIZATION,
  LEGACY_PROVISIONAL_NORMALIZATION,
  candidateComponentScores,
  type CandidateComponentScores,
  type NormalizationConfig,
} from "./normalize";
import { computeDataConfidence, type ConfidenceReport, type MappingKind, type SourceTier } from "./confidence";
import {
  UNCALIBRATED_EXPERIMENTAL_GATE,
  composeCandidateFit,
  type CandidateFitResult,
  type ExperimentalActionableFitGate,
} from "./formula";

export const CALIBRATION_REPORT_VERSION = "mi1h-calibration-dev-v3" as const;

/** Superseded MI1E config; development/history only. */
export const PROVISIONAL_NORMALIZATION: {
  config: typeof LEGACY_PROVISIONAL_NORMALIZATION;
  isProvisional: true;
} = Object.freeze({
  config: LEGACY_PROVISIONAL_NORMALIZATION,
  isProvisional: true,
});

/** Authoritative MI1H production normalization. */
export const PRODUCTION_NORMALIZATION: {
  config: NormalizationConfig;
  isProvisional: false;
} = Object.freeze({
  config: DEFAULT_NORMALIZATION,
  isProvisional: false,
});

export interface CalibrationCountryReport {
  cohort: CalibrationCohortEntry;
  evidence: {
    fetchOutcome: CalibrationEvidenceContext["fetchOutcome"];
    completeBilateralCoverage: boolean;
    indiaPresence: CalibrationEvidenceContext["indiaPresence"];
    bilateralObservationCount: number;
    ledgerRowsReceived: number | null;
    analyticalYears: readonly number[];
  };
  primitives: CountryPrimitives;
  components: CandidateComponentScores;
  confidence: ConfidenceReport;
  fit: CandidateFitResult;
}

export interface CalibrationDistributionReport {
  latestImportsUsd: DistributionSummary;
  latestQuantityTonnes: DistributionSummary;
  derivedUnitValueUsdPerKg: DistributionSummary;
  indiaShare: DistributionSummary;
  hhi: DistributionSummary;
  top1OriginShare: DistributionSummary;
  top3OriginShare: DistributionSummary;
  latestYoyPct: DistributionSummary;
  threeYearCagrPct: DistributionSummary;
  fiveYearCagrPct: DistributionSummary;
  volatilityCv: DistributionSummary;
  validAnnualPeriods: DistributionSummary;
}

export interface CalibrationReport {
  version: typeof CALIBRATION_REPORT_VERSION;
  producedAt: string;
  cohort: ReadonlyArray<CalibrationCohortEntry>;
  countries: ReadonlyArray<CalibrationCountryReport>;
  distributions: CalibrationDistributionReport;
  unavailableCountries: ReadonlyArray<string>;
  normalization: {
    config: NormalizationConfig;
    isProvisional: false;
    marketFitVersion: "mi-fit-v2";
  };
  experimentalGate: ExperimentalActionableFitGate;
  isDevelopmentOnly: true;
}

export interface BuildCalibrationReportInput {
  cohortAvailable: ReadonlyArray<CalibrationCohortEntry>;
  cohortUnavailable: ReadonlyArray<CalibrationCohortEntry>;
  /** Evidence context per cohort country (already built by the caller). */
  evidenceByCountry: ReadonlyMap<string, CalibrationEvidenceContext>;
  mappingKind: MappingKind;
  mappingConfidence: number;
  sourceTier: SourceTier;
  currentYear: number;
  normalization?: NormalizationConfig;
  experimentalGate?: ExperimentalActionableFitGate;
  now?: () => Date;
}

export function buildCalibrationReport(input: BuildCalibrationReportInput): CalibrationReport {
  const config = input.normalization ?? PRODUCTION_NORMALIZATION.config;
  const experimentalGate = input.experimentalGate ?? UNCALIBRATED_EXPERIMENTAL_GATE;
  const now = (input.now ?? (() => new Date()))();

  const countries: CalibrationCountryReport[] = input.cohortAvailable.map((entry) => {
    const context = input.evidenceByCountry.get(entry.countryAlpha2);
    if (!context) {
      throw new Error(
        `[MI1E.1 report] missing CalibrationEvidenceContext for ${entry.countryAlpha2}`,
      );
    }
    const primitives = computeCountryPrimitives(context);
    const components = candidateComponentScores(primitives, config);
    const confidence = computeDataConfidence({
      primitives,
      mappingKind: input.mappingKind,
      sourceTier: input.sourceTier,
      currentYear: input.currentYear,
    });
    // Demand-size evidence is present when the ledger-proven latest total
    // is non-null; historical evidence when we have ≥3 valid periods.
    const hasDemandSizeEvidence = primitives.latestImportsUsd !== null;
    const hasHistoricalEvidence = primitives.completenessFlags.hasAtLeast3Periods;
    const fit = composeCandidateFit({
      components,
      mappingKind: input.mappingKind,
      mappingConfidence: input.mappingConfidence,
      confidence,
      hasDemandSizeEvidence,
      hasHistoricalEvidence,
      experimentalGate,
    });
    return {
      cohort: entry,
      evidence: {
        fetchOutcome: context.fetchOutcome,
        completeBilateralCoverage: context.completeBilateralCoverage,
        indiaPresence: context.indiaPresence,
        bilateralObservationCount: context.bilateralObservationCount,
        ledgerRowsReceived: context.ledgerEntry?.rowsReceived ?? null,
        analyticalYears: context.coverage.analyticalYears,
      },
      primitives,
      components,
      confidence,
      fit,
    };
  });

  const distributions: CalibrationDistributionReport = {
    latestImportsUsd: summarize(countries.map((c) => c.primitives.latestImportsUsd)),
    latestQuantityTonnes: summarize(countries.map((c) => c.primitives.latestQuantityTonnes)),
    derivedUnitValueUsdPerKg: summarize(
      countries.map((c) => c.primitives.latestDerivedUnitValueUsdPerKg),
    ),
    indiaShare: summarize(countries.map((c) => c.primitives.indiaShare)),
    hhi: summarize(countries.map((c) => c.primitives.hhi)),
    top1OriginShare: summarize(countries.map((c) => c.primitives.top1OriginShare)),
    top3OriginShare: summarize(countries.map((c) => c.primitives.top3OriginShare)),
    latestYoyPct: summarize(countries.map((c) => c.primitives.latestYoyPct)),
    threeYearCagrPct: summarize(countries.map((c) => c.primitives.threeYearCagrPct)),
    fiveYearCagrPct: summarize(countries.map((c) => c.primitives.fiveYearCagrPct)),
    volatilityCv: summarize(countries.map((c) => c.primitives.volatilityCv)),
    validAnnualPeriods: summarize(countries.map((c) => c.primitives.validAnnualPeriods)),
  };

  return {
    version: CALIBRATION_REPORT_VERSION,
    producedAt: now.toISOString(),
    cohort: input.cohortAvailable,
    countries,
    distributions,
    unavailableCountries: input.cohortUnavailable.map((c) => c.countryAlpha2),
    normalization: {
      config,
      isProvisional: false,
      marketFitVersion: config.marketFitVersion,
    },
    experimentalGate,
    isDevelopmentOnly: true,
  };
}
