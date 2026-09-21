/**
 * MI1E.1 — DEVELOPMENT-ONLY calibration report.
 *
 * Pure function. Consumes an already-built `CalibrationEvidenceContext`
 * per country — the caller reads observations + ledger via the existing
 * `MarketReadRepository`; the report itself makes no provider or DB
 * call.
 *
 * Every threshold is provisional. `PROVISIONAL_NORMALIZATION` is
 * explicitly marked and MUST NOT be treated as a calibrated production
 * threshold. Tests assert this.
 */

import type { CalibrationCohortEntry } from "./cohort";
import type { CalibrationEvidenceContext } from "./evidence";
import { computeCountryPrimitives, type CountryPrimitives } from "./primitives";
import { summarize, type DistributionSummary } from "./distribution";
import {
  DEFAULT_NORMALIZATION,
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

export const CALIBRATION_REPORT_VERSION = "mi1e-calibration-dev-v2" as const;

/** Explicit provisional flag; the operator sets `false` only after locking bands. */
export const PROVISIONAL_NORMALIZATION: {
  config: NormalizationConfig;
  isProvisional: true;
} = Object.freeze({
  config: DEFAULT_NORMALIZATION,
  isProvisional: true,
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
    isProvisional: boolean;
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
  const config = input.normalization ?? PROVISIONAL_NORMALIZATION.config;
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
      isProvisional: input.normalization === undefined,
    },
    experimentalGate,
    isDevelopmentOnly: true,
  };
}
