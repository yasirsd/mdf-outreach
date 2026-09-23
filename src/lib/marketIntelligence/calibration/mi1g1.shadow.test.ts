import { describe, expect, it } from "vitest";
import { DEFAULT_NORMALIZATION } from "./normalize";
import {
  buildCompetitiveOpportunityWarnings,
  type CalibrationReviewCountryRow,
  type CalibrationReviewReport,
} from "./review";
import {
  CANDIDATE_B_ANCHORS,
  CANDIDATE_C_ANCHORS,
  SHADOW_WEIGHTS,
  buildCalibrationComparison,
  scoreCandidateB,
  scoreCandidateC,
} from "./shadow";

function row(
  countryAlpha2: string,
  overrides: Partial<CalibrationReviewCountryRow> = {},
): CalibrationReviewCountryRow {
  return {
    countryAlpha2,
    countryName: countryAlpha2,
    latestAvailableYear: 2024,
    latestImportValueUsd: 10_000_000,
    latestImportQuantityTonnes: 1_000,
    latestDerivedUnitValueUsdPerKg: 4,
    indiaImportValueUsd: 1_000_000,
    indiaShare: 0.10,
    indiaRank: 3,
    indiaPresence: "present",
    originCount: 10,
    topOriginCountry: "CN",
    topOriginValueUsd: 2_000_000,
    top1OriginShare: 0.20,
    top3OriginShare: 0.45,
    hhi: 0.15,
    yoy: 5,
    cagr3Year: 5,
    cagr5Year: 4,
    volatility: 0.15,
    validAnnualPeriods: 7,
    observedYears: [2018, 2019, 2020, 2021, 2022, 2023, 2024],
    analyticalCoveragePct: 100,
    completeBilateralCoverage: true,
    dataConfidenceScore: 90,
    confidenceContributors: {
      sourceQuality: 15,
      mappingQuality: 15,
      coverage: 15,
      recency: 15,
      completeness: 15,
      consistency: 15,
    },
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

function review(rows: CalibrationReviewCountryRow[]): CalibrationReviewReport {
  return {
    rows,
    competitiveOpportunityWarnings: buildCompetitiveOpportunityWarnings(rows),
  } as CalibrationReviewReport;
}

const componentValues = (candidate: ReturnType<typeof scoreCandidateB>) =>
  Object.values(candidate).filter((value): value is number => value !== null);

describe("MI1G.1 warning regression", () => {
  it("warns for KR and JP but not a diversified low-India market", () => {
    const warnings = buildCompetitiveOpportunityWarnings([
      row("KR", {
        indiaShare: 0.0000597,
        indiaRank: 12,
        hhi: 0.9514,
        top1OriginShare: 0.9753,
      }),
      row("JP", {
        indiaShare: 0.003326,
        indiaRank: 11,
        hhi: 0.6991,
        top1OriginShare: 0.8318,
      }),
      row("DV", {
        indiaShare: 0,
        indiaRank: null,
        indiaPresence: "absent",
        hhi: 0.15,
        top1OriginShare: 0.20,
      }),
    ]);

    expect(warnings.map((warning) => warning.countryAlpha2)).toEqual(["KR", "JP"]);
    expect(warnings.every((warning) =>
      warning.reason.includes("Low India presence") &&
      warning.reason.includes("incumbent concentration")
    )).toBe(true);
  });
});

describe.each([
  ["Candidate B", scoreCandidateB],
  ["Candidate C", scoreCandidateC],
] as const)("MI1G.1 %s monotonicity and bounds", (_label, score) => {
  it("is monotonic for demand, applicable CAGR, India share, and inverse CV", () => {
    expect(score(row("HI", { latestImportValueUsd: 100_000_000 })).demandSize)
      .toBeGreaterThanOrEqual(score(row("LO", { latestImportValueUsd: 1_000_000 })).demandSize!);
    expect(score(row("HI", { cagr3Year: 15, yoy: -100 })).demandGrowth)
      .toBeGreaterThanOrEqual(score(row("LO", { cagr3Year: -5, yoy: 100 })).demandGrowth!);
    expect(score(row("HI", { indiaShare: 0.60, indiaRank: 3 })).indiaPosition)
      .toBeGreaterThanOrEqual(score(row("LO", { indiaShare: 0.05, indiaRank: 3 })).indiaPosition!);
    expect(score(row("HI", { volatility: 0.30 })).demandStability)
      .toBeLessThanOrEqual(score(row("LO", { volatility: 0.10 })).demandStability!);
  });

  it("keeps every supported component within 0..100", () => {
    const inputs = [
      row("A", { latestImportValueUsd: 0, cagr3Year: -1_000, indiaShare: 0, hhi: 1, volatility: 10 }),
      row("B", { latestImportValueUsd: 1e15, cagr3Year: 1_000, indiaShare: 1, hhi: 0, volatility: 0 }),
    ];
    for (const input of inputs) {
      for (const value of componentValues(score(input))) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it("penalises concentrated whitespace and bounds derived unit value", () => {
    const common = {
      indiaShare: 0,
      indiaRank: null,
      indiaPresence: "absent" as const,
    };
    const concentrated = score(row("CO", {
      ...common, hhi: 0.95, top1OriginShare: 0.97, top3OriginShare: 0.995,
    }));
    const diversified = score(row("DI", {
      ...common, hhi: 0.15, top1OriginShare: 0.20, top3OriginShare: 0.45,
    }));
    expect(concentrated.competitiveOpportunity).toBeLessThanOrEqual(10);
    expect(diversified.competitiveOpportunity).toBeGreaterThanOrEqual(80);
    expect(diversified.competitiveOpportunity).toBeGreaterThan(concentrated.competitiveOpportunity!);

    const highUnit = score(row("UV", { latestDerivedUnitValueUsdPerKg: 1_000 }));
    const tinyQuantity = score(row("TQ", {
      latestDerivedUnitValueUsdPerKg: 1_000,
      latestImportQuantityTonnes: 1,
    }));
    expect(highUnit.priceAttractiveness).toBeLessThan(100);
    expect(tinyQuantity.priceAttractiveness).toBeLessThanOrEqual(40);
  });
});

describe("MI1G.1 deterministic shadow comparison", () => {
  const countries = Array.from({ length: 18 }, (_, index) => row(
    `C${String(index + 1).padStart(2, "0")}`,
    {
      latestImportValueUsd: 500_000 * (index + 1) ** 2,
      cagr3Year: -8 + index * 1.4,
      indiaShare: Math.min(0.98, index * 0.055),
      indiaRank: Math.min(18, index + 1),
      hhi: 0.18 + index * 0.035,
      top1OriginShare: 0.30 + index * 0.035,
      top3OriginShare: 0.50 + index * 0.025,
      latestDerivedUnitValueUsdPerKg: 2 + index * 0.3,
      volatility: 0.09 + index * 0.015,
      diagnosticFitScore: 69 - index * 2,
    },
  ));

  it("returns all countries, deterministic rank diagnostics, passing scenarios, and unchanged confidence", () => {
    const first = buildCalibrationComparison(review(countries));
    const second = buildCalibrationComparison(review(countries));

    expect(first).toEqual(second);
    expect(first.countries).toHaveLength(18);
    expect(new Set(first.countries.map((country) => country.countryAlpha2)).size).toBe(18);
    expect(first.countries.every((country) =>
      country.provisional.dataConfidenceScore === 90 &&
      country.candidateB.dataConfidenceScore === 90 &&
      country.candidateC.dataConfidenceScore === 90 &&
      country.candidateB.recommendationStatus === "indicative" &&
      country.candidateC.recommendationStatus === "indicative"
    )).toBe(true);
    expect(Number.isFinite(first.diagnostics.candidateB.versusProvisional.spearmanCorrelation)).toBe(true);
    expect(Number.isFinite(first.diagnostics.candidateC.versusProvisional.spearmanCorrelation)).toBe(true);
    expect(first.scenarioTests.every((scenario) => scenario.passed)).toBe(true);
    expect(first.productionNormalizationReplaced).toBe(false);
  });

  it("uses the unchanged conceptual weights and explicit frozen anchors", () => {
    expect(SHADOW_WEIGHTS).toEqual({
      demandSize: 25,
      demandGrowth: 20,
      indiaPosition: 20,
      competitiveOpportunity: 15,
      priceAttractiveness: 10,
      demandStability: 10,
    });
    expect(Object.values(SHADOW_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(CANDIDATE_B_ANCHORS.demandLog10Usd).toHaveLength(5);
    expect(CANDIDATE_C_ANCHORS.demandLog10Usd).toHaveLength(5);
    expect(DEFAULT_NORMALIZATION.demandSizeBreaksLog10).toEqual([5, 6, 6.75, 7.5, 8.5]);
  });
});
