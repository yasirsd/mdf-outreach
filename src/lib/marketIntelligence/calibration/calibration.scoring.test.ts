import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MarketReadRepositoryObservation } from "../marketReadRepository";
import { RECOMMENDATION_MIN_CONFIDENCE_FOR_ACTIONABLE } from "../marketFit";
import { calibrationCohort } from "./cohort";
import { buildCalibrationEvidenceContext } from "./evidence";
import { computeCountryPrimitives } from "./primitives";
import {
  DEFAULT_NORMALIZATION,
  LEGACY_PROVISIONAL_NORMALIZATION,
  candidateComponentScores,
  piecewise,
  piecewiseInverse,
} from "./normalize";
import {
  CONFIDENCE_CONTRIBUTOR_COUNT,
  CONFIDENCE_WEIGHTS,
  computeDataConfidence,
} from "./confidence";
import {
  UNCALIBRATED_EXPERIMENTAL_GATE,
  composeCandidateFit,
} from "./formula";
import {
  CALIBRATION_REPORT_VERSION,
  PRODUCTION_NORMALIZATION,
  PROVISIONAL_NORMALIZATION,
  buildCalibrationReport,
} from "./report";

const PROVIDER_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024] as const;

function row(
  reporter: string, year: number, partner: string, usd: number, tonnes: number | null,
): MarketReadRepositoryObservation {
  return {
    id: `${reporter}-${year}-${partner}`,
    sourceId: "src-1",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    reporterCountry: reporter,
    partnerCountry: partner,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCode: "090421",
    frequency: "annual",
    period: String(year),
    tradeValueUsd: usd,
    quantity: tonnes,
    quantityUnit: tonnes === null ? null : "tonne",
    netWeightKg: null,
    retrievedAt: "2026-01-01T00:00:00.000Z",
  };
}

function malaysiaRows(): MarketReadRepositoryObservation[] {
  const rows: MarketReadRepositoryObservation[] = [];
  for (let y = 2018; y <= 2024; y += 1) {
    const scale = (y - 2017) / 6;
    rows.push(row("MY", y, "CN", Math.round(60_000_000 * (0.7 + 0.05 * scale)), 20_000));
    rows.push(row("MY", y, "IN", Math.round(40_000_000 * (0.6 + 0.13 * scale)), 15_000));
    rows.push(row("MY", y, "TH", Math.round(3_000_000  * (0.9 + 0.1  * scale)),  1_200));
  }
  rows.splice(rows.length - 3, 3,
    row("MY", 2024, "CN", 63_349_647, 25_000),
    row("MY", 2024, "IN", 50_939_611, 22_000),
    row("MY", 2024, "TH",  3_060_000,  1_753),
  );
  return rows;
}

function completeCtx(reporter: string, rows: MarketReadRepositoryObservation[]) {
  const bilateralCount = rows.filter((r) => r.partnerCountry !== null).length;
  return buildCalibrationEvidenceContext({
    reporterCountry: reporter,
    hsRevision: "HS17",
    hsCode: "090421",
    observations: rows,
    ledgerEntry: {
      outcome: "success", rowsReceived: bilateralCount, safeMetadata: {},
      fetchedAt: "2026-09-20T00:00:00.000Z", freshUntil: "2026-10-20T00:00:00.000Z",
    },
    requestedStartYear: 2017, requestedEndYear: 2024,
    providerSupportedYears: PROVIDER_YEARS,
  });
}

describe("MI1E.1 normalize + piecewise (mechanics only, breakpoints provisional)", () => {
  it("piecewise clamps below/above; interpolates linearly between breaks", () => {
    const breaks = [0, 10, 20];
    expect(piecewise(-5, breaks)).toBe(0);
    expect(piecewise(10, breaks)).toBe(50);
    expect(piecewise(20, breaks)).toBe(100);
    expect(piecewise(null, breaks)).toBeNull();
  });

  it("piecewiseInverse rewards lower inputs; requires descending breaks", () => {
    expect(piecewiseInverse(1.0, [1.0, 0.1])).toBe(0);
    expect(piecewiseInverse(0.1, [1.0, 0.1])).toBe(100);
    expect(() => piecewiseInverse(0.5, [0.1, 0.5])).toThrow();
  });

  it("candidateComponentScores gates India + concentration on proven completeness", () => {
    const p = computeCountryPrimitives(completeCtx("MY", malaysiaRows()));
    const complete = candidateComponentScores(p);
    expect(complete.indiaPosition).not.toBeNull();
    expect(complete.competitiveOpportunity).not.toBeNull();
    expect(complete.demandSize).not.toBeNull();

    // Same rows but with a partial ledger → origin-dependent components null.
    const partialCtx = buildCalibrationEvidenceContext({
      reporterCountry: "MY", hsRevision: "HS17", hsCode: "090421",
      observations: malaysiaRows(),
      ledgerEntry: {
        outcome: "partial", rowsReceived: 1000, safeMetadata: { failure_reason: "pagination_gap" },
        fetchedAt: "2026-09-20T00:00:00.000Z", freshUntil: "2026-09-20T00:00:00.000Z",
      },
      requestedStartYear: 2017, requestedEndYear: 2024, providerSupportedYears: PROVIDER_YEARS,
    });
    const partial = candidateComponentScores(computeCountryPrimitives(partialCtx));
    expect(partial.indiaPosition).toBeNull();
    expect(partial.competitiveOpportunity).toBeNull();
    expect(partial.demandSize).toBeNull();
  });
});

describe("MI1E.1 confidence contract", () => {
  it("declares exactly SIX contributors and weights sum to exactly 1.0", () => {
    expect(CONFIDENCE_CONTRIBUTOR_COUNT).toBe(6);
    const keys = Object.keys(CONFIDENCE_WEIGHTS);
    expect(keys).toHaveLength(6);
    const sum = Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it("bilateralCompleteness enters confidence from LEDGER-PROVEN coverage, not raw presence", () => {
    const p = computeCountryPrimitives(completeCtx("MY", malaysiaRows()));
    const confHi = computeDataConfidence({
      primitives: p, mappingKind: "proxy", sourceTier: "A", currentYear: 2026,
    });
    const partialCtx = buildCalibrationEvidenceContext({
      reporterCountry: "MY", hsRevision: "HS17", hsCode: "090421",
      observations: malaysiaRows(),
      ledgerEntry: {
        outcome: "partial", rowsReceived: 1000, safeMetadata: {},
        fetchedAt: "2026-09-20T00:00:00.000Z", freshUntil: "2026-09-20T00:00:00.000Z",
      },
      requestedStartYear: 2017, requestedEndYear: 2024, providerSupportedYears: PROVIDER_YEARS,
    });
    const pPartial = computeCountryPrimitives(partialCtx);
    const confLo = computeDataConfidence({
      primitives: pPartial, mappingKind: "proxy", sourceTier: "A", currentYear: 2026,
    });
    expect(confHi.components.bilateralCompleteness).toBe(100);
    expect(confLo.components.bilateralCompleteness).toBe(0);
    expect(confHi.score).toBeGreaterThan(confLo.score);
  });

  it("provider-unsupported year (2017) does NOT lower coverage — denominator is analytical window", () => {
    const p = computeCountryPrimitives(completeCtx("MY", malaysiaRows()));
    const conf = computeDataConfidence({
      primitives: p, mappingKind: "proxy", sourceTier: "A", currentYear: 2026,
    });
    expect(conf.components.coverage).toBe(100);
  });
});

describe("MI1E.1 fit composer delegates to central buildMarketRecommendation", () => {
  it("proxy mapping IS publishable per the central contract (publishedFitScore = diagnosticFit)", () => {
    const p = computeCountryPrimitives(completeCtx("MY", malaysiaRows()));
    const components = candidateComponentScores(p);
    const conf = computeDataConfidence({
      primitives: p, mappingKind: "proxy", sourceTier: "A", currentYear: 2026,
    });
    const fit = composeCandidateFit({
      components, mappingKind: "proxy", mappingConfidence: 0.7,
      confidence: conf, hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(fit.recommendationStatus).toBe("indicative");
    expect(fit.publicationReason).toBe("published_trade_proxy");
    expect(fit.publishedFitScore).toBe(fit.diagnosticFitScore);
    expect(fit.fitEligibility).toBe("proxy_allowed");
  });

  it("proxy is CAPPED at indicative — never actionable", () => {
    const forced = {
      demandSize: 100, demandGrowth: 100, indiaPosition: 100,
      competitiveOpportunity: 100, priceAttractiveness: 100, demandStability: 100,
    };
    const p = computeCountryPrimitives(completeCtx("MY", malaysiaRows()));
    const conf = computeDataConfidence({
      primitives: p, mappingKind: "proxy", sourceTier: "A", currentYear: 2026,
    });
    const fit = composeCandidateFit({
      components: forced, mappingKind: "proxy", mappingConfidence: 0.7,
      confidence: conf, hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(fit.recommendationStatus).toBe("indicative");
  });

  it("composite mapping is never publishable (publishedFitScore null, insufficient_specificity)", () => {
    const components = candidateComponentScores(
      computeCountryPrimitives(completeCtx("MY", malaysiaRows())),
    );
    const fit = composeCandidateFit({
      components, mappingKind: "composite", mappingConfidence: 0.3,
      confidence: { score: 90, components: {}, supported: true },
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(fit.publishedFitScore).toBeNull();
    expect(fit.fitEligibility).toBe("insufficient_specificity");
    expect(fit.recommendationStatus).toBe("insufficient_evidence");
  });

  it("exact mapping reaches actionable when confidence ≥ 65 (the AUTHORITATIVE threshold, not 70)", () => {
    // 65 is defined in the central gate (marketFit.ts).
    expect(RECOMMENDATION_MIN_CONFIDENCE_FOR_ACTIONABLE).toBe(65);
    const forced = {
      demandSize: 80, demandGrowth: 80, indiaPosition: 80,
      competitiveOpportunity: 80, priceAttractiveness: 80, demandStability: 80,
    };
    const fitAt65 = composeCandidateFit({
      components: forced, mappingKind: "exact", mappingConfidence: 0.95,
      confidence: { score: 65, components: {}, supported: true },
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(fitAt65.recommendationStatus).toBe("actionable");
    const fitAt64 = composeCandidateFit({
      components: forced, mappingKind: "exact", mappingConfidence: 0.95,
      confidence: { score: 64, components: {}, supported: true },
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(fitAt64.recommendationStatus).toBe("indicative");
  });

  it("experimental uncalibrated Fit floor NARROWS actionable and never loosens it", () => {
    const forced = {
      demandSize: 40, demandGrowth: 40, indiaPosition: 40,
      competitiveOpportunity: 40, priceAttractiveness: 40, demandStability: 40,
    };
    const conf = { score: 80, components: {}, supported: true } as const;
    const withoutGate = composeCandidateFit({
      components: forced, mappingKind: "exact", mappingConfidence: 0.95,
      confidence: conf, hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(withoutGate.recommendationStatus).toBe("actionable");

    const withGate = composeCandidateFit({
      components: forced, mappingKind: "exact", mappingConfidence: 0.95,
      confidence: conf, hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
      experimentalGate: { IS_UNCALIBRATED: true, minDiagnosticFitScore: 60 },
    });
    expect(withGate.recommendationStatus).toBe("indicative");
  });

  it("UNCALIBRATED_EXPERIMENTAL_GATE carries no default Fit threshold", () => {
    expect(UNCALIBRATED_EXPERIMENTAL_GATE.IS_UNCALIBRATED).toBe(true);
    expect(UNCALIBRATED_EXPERIMENTAL_GATE.minDiagnosticFitScore).toBeUndefined();
  });
});

describe("MI1H calibrated production normalization + report", () => {
  it("keeps the legacy provisional config identifiable but makes Candidate C the production default", () => {
    expect(PROVISIONAL_NORMALIZATION.isProvisional).toBe(true);
    expect(PROVISIONAL_NORMALIZATION.config).toBe(LEGACY_PROVISIONAL_NORMALIZATION);
    expect(PRODUCTION_NORMALIZATION.isProvisional).toBe(false);
    expect(PRODUCTION_NORMALIZATION.config).toBe(DEFAULT_NORMALIZATION);
    expect(DEFAULT_NORMALIZATION.marketFitVersion).toBe("mi-fit-v2");
  });

  it("builds a development report using the calibrated production contract", () => {
    const cohort = calibrationCohort();
    const evidence = new Map<string, ReturnType<typeof completeCtx>>();
    for (const entry of cohort) {
      const seed = entry.countryAlpha2.charCodeAt(0);
      const rows: MarketReadRepositoryObservation[] = [];
      for (let y = 2020; y <= 2024; y += 1) {
        rows.push(row(entry.countryAlpha2, y, "IN", 5_000_000 + seed * 1000, 500));
        rows.push(row(entry.countryAlpha2, y, "CN", 7_000_000 + seed * 1000, 700));
        rows.push(row(entry.countryAlpha2, y, "TH", 1_500_000 + seed * 1000, 100));
      }
      evidence.set(entry.countryAlpha2, completeCtx(entry.countryAlpha2, rows));
    }
    const report = buildCalibrationReport({
      cohortAvailable: cohort,
      cohortUnavailable: [],
      evidenceByCountry: evidence,
      mappingKind: "proxy",
      mappingConfidence: 0.7,
      sourceTier: "B",
      currentYear: 2026,
      now: () => new Date("2026-09-21T00:00:00.000Z"),
    });
    expect(report.version).toBe(CALIBRATION_REPORT_VERSION);
    expect(report.isDevelopmentOnly).toBe(true);
    expect(report.normalization.isProvisional).toBe(false);
    expect(report.normalization.marketFitVersion).toBe("mi-fit-v2");
    expect(report.experimentalGate.IS_UNCALIBRATED).toBe(true);
    // Proxy mapping: no country may reach actionable.
    for (const c of report.countries) {
      expect(c.fit.recommendationStatus).not.toBe("actionable");
    }
    expect(report.distributions.latestImportsUsd.n).toBeGreaterThan(0);
  });
});

describe("MI1E.1 source-code safety", () => {
  const HERE = process.cwd();
  const files = [
    "src/lib/marketIntelligence/calibration/cohort.ts",
    "src/lib/marketIntelligence/calibration/evidence.ts",
    "src/lib/marketIntelligence/calibration/primitives.ts",
    "src/lib/marketIntelligence/calibration/distribution.ts",
    "src/lib/marketIntelligence/calibration/normalize.ts",
    "src/lib/marketIntelligence/calibration/confidence.ts",
    "src/lib/marketIntelligence/calibration/formula.ts",
    "src/lib/marketIntelligence/calibration/report.ts",
  ];
  const bodies = files.map((f) => readFileSync(path.resolve(HERE, f), "utf8"));

  it("no calibration module calls Supabase, writers, or fetch", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/createClient|supabase|ingestSource|verifySourceRights|ingestTradeObservation|recordFetchResult|getMarketIntelligenceServiceRoleClient|getMarketIntelligenceWriter/);
      expect(body).not.toMatch(/\bfetch\s*\(/);
      // formula.ts imports buildMarketRecommendation — that's an in-memory
      // function, not a writer. Assert no production score table names.
      expect(body).not.toMatch(/market_product_scores|market_product_score_components/);
    }
  });

  it("no calibration module contaminates Buyer Intelligence tables", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/buyer_trade_observations|buyer_intelligence|BUYER_SEND_ENABLED/);
    }
  });

  it("no calibration module automatically includes HS 090422", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/090422/);
    }
  });
});
