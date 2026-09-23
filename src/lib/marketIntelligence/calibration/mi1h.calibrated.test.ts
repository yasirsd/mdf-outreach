import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_CONFIDENCE_VERSION,
  MARKET_FIT_MIN_SUPPORTED_WEIGHT,
  MARKET_FIT_VERSION,
  RECOMMENDATION_MIN_CONFIDENCE_FOR_ACTIONABLE,
} from "../marketFit";
import { CONFIDENCE_CONTRIBUTOR_COUNT, CONFIDENCE_WEIGHTS } from "./confidence";
import { DEFAULT_COMPONENT_WEIGHTS, composeCandidateFit } from "./formula";
import {
  CALIBRATED_NORMALIZATION,
  DEFAULT_NORMALIZATION,
  calibratedComponentScores,
  type NormalizationPrimitiveInput,
} from "./normalize";
import {
  CANDIDATE_B_ANCHORS,
  CANDIDATE_C_ANCHORS,
  MI1H_EXPECTED_CALIBRATED_FIT_SNAPSHOT,
} from "./shadow";

function input(overrides: Partial<NormalizationPrimitiveInput> = {}): NormalizationPrimitiveInput {
  return {
    latestImportValueUsd: 10 ** 7.25 - 1,
    latestImportQuantityTonnes: 1_000,
    latestDerivedUnitValueUsdPerKg: 5,
    indiaShare: 0.20,
    indiaRank: 3,
    indiaPresence: "present",
    hhi: 0.40,
    top1OriginShare: 0.60,
    top3OriginShare: 0.80,
    yoy: 99,
    cagr3Year: 2.5,
    cagr5Year: -99,
    volatility: 0.20,
    hasAtLeast5Periods: true,
    completeBilateralCoverage: true,
    ...overrides,
  };
}

function fit(
  mappingKind: "exact" | "proxy" | "composite",
  confidenceScore = 90,
) {
  const components = calibratedComponentScores(input());
  return composeCandidateFit({
    components,
    mappingKind,
    mappingConfidence: mappingKind === "exact" ? 0.95 : mappingKind === "proxy" ? 0.7 : 0.3,
    confidence: { score: confidenceScore, components: {}, supported: true },
    hasDemandSizeEvidence: true,
    hasHistoricalEvidence: true,
  });
}

describe("MI1H authoritative Candidate-C contract", () => {
  it("freezes the exact production config, version, and weights", () => {
    expect(DEFAULT_NORMALIZATION).toBe(CALIBRATED_NORMALIZATION);
    expect(CANDIDATE_C_ANCHORS).toBe(CALIBRATED_NORMALIZATION);
    expect(CALIBRATED_NORMALIZATION).toMatchObject({
      methodology: "candidate-c-conservative-hybrid",
      marketFitVersion: "mi-fit-v2",
      isProvisional: false,
      demandLog10Usd: [6, 6.75, 7.25, 7.75, 8.5],
      growthCagrPct: [-10, -5, 2.5, 10, 20],
      indiaShare: [0, 0.05, 0.20, 0.50, 0.90],
      hhiWorstToBest: [0.85, 0.60, 0.40, 0.25, 0.15],
      top1WorstToBest: [0.90, 0.75, 0.60, 0.45, 0.30],
      top3WorstToBest: [0.98, 0.90, 0.80, 0.65, 0.50],
      derivedUnitValueUsdPerKg: [2, 3, 5, 8, 12],
      boundedUnitValueScale: [10, 35, 60, 75, 85],
      volatilityWorstToBest: [0.50, 0.30, 0.20, 0.10, 0.05],
      smallQuantityThresholdTonnes: 10,
      smallQuantityScoreCap: 30,
    });
    expect(MARKET_FIT_VERSION).toBe("mi-fit-v2");
    expect(DEFAULT_COMPONENT_WEIGHTS).toEqual({
      demandSize: 25,
      demandGrowth: 20,
      indiaPosition: 20,
      competitiveOpportunity: 15,
      priceAttractiveness: 10,
      demandStability: 10,
    });
    expect(Object.values(DEFAULT_COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0))
      .toBe(100);
    expect(CANDIDATE_B_ANCHORS).not.toBe(CALIBRATED_NORMALIZATION);
  });

  it("pins exact rounded component and Fit outputs for a central fixture", () => {
    const components = calibratedComponentScores(input());
    expect(components).toEqual({
      demandSize: 50,
      demandGrowth: 50,
      indiaPosition: 61,
      competitiveOpportunity: 20,
      priceAttractiveness: 60,
      demandStability: 50,
    });
    const result = fit("proxy");
    expect(result.diagnosticFitScore).toBe(49);
    expect(result.calculationVersion).toBe("mi-fit-v2");
  });

  it("is monotonic in demand, CAGR, India share, and inverse CV", () => {
    expect(calibratedComponentScores(input({ latestImportValueUsd: 1e9 })).demandSize)
      .toBeGreaterThan(calibratedComponentScores(input({ latestImportValueUsd: 1e6 })).demandSize!);
    expect(calibratedComponentScores(input({ cagr3Year: 20 })).demandGrowth)
      .toBeGreaterThan(calibratedComponentScores(input({ cagr3Year: -10 })).demandGrowth!);
    expect(calibratedComponentScores(input({ indiaShare: 0.9, indiaRank: 3 })).indiaPosition)
      .toBeGreaterThan(calibratedComponentScores(input({ indiaShare: 0.05, indiaRank: 3 })).indiaPosition!);
    expect(calibratedComponentScores(input({ volatility: 0.4 })).demandStability)
      .toBeLessThan(calibratedComponentScores(input({ volatility: 0.1 })).demandStability!);
  });

  it("enforces contestability, the 85 unit-value cap, and the small-quantity safeguard", () => {
    const whitespace = {
      indiaShare: 0,
      indiaRank: null,
      indiaPresence: "absent" as const,
    };
    const concentrated = calibratedComponentScores(input({
      ...whitespace,
      hhi: 0.95,
      top1OriginShare: 0.97,
      top3OriginShare: 0.995,
    }));
    const diversified = calibratedComponentScores(input({
      ...whitespace,
      hhi: 0.15,
      top1OriginShare: 0.20,
      top3OriginShare: 0.45,
    }));
    expect(concentrated.competitiveOpportunity).toBe(0);
    expect(diversified.competitiveOpportunity).toBe(100);
    expect(calibratedComponentScores(input({ latestDerivedUnitValueUsdPerKg: 100 }))
      .priceAttractiveness).toBe(85);
    expect(calibratedComponentScores(input({
      latestDerivedUnitValueUsdPerKg: 100,
      latestImportQuantityTonnes: 1,
    })).priceAttractiveness).toBe(30);
  });

  it("pins the remaining scenario behavior", () => {
    expect(calibratedComponentScores(input({ indiaShare: 0.98, indiaRank: 1 })).indiaPosition)
      .toBe(100);
    expect(calibratedComponentScores(input({ cagr3Year: -2, volatility: 0.05 })))
      .toMatchObject({ demandGrowth: 35, demandStability: 100 });
    expect(calibratedComponentScores(input({ cagr3Year: 30, volatility: 0.60 })))
      .toMatchObject({ demandGrowth: 100, demandStability: 0 });
  });
});

describe("MI1H unchanged confidence and publication boundaries", () => {
  it("keeps proxy indicative, composite insufficient, and exact actionable semantics", () => {
    expect(fit("proxy").recommendationStatus).toBe("indicative");
    expect(fit("composite").recommendationStatus).toBe("insufficient_evidence");
    expect(fit("composite").publishedFitScore).toBeNull();
    expect(fit("exact", RECOMMENDATION_MIN_CONFIDENCE_FOR_ACTIONABLE).recommendationStatus)
      .toBe("actionable");
    expect(fit("exact", RECOMMENDATION_MIN_CONFIDENCE_FOR_ACTIONABLE - 1).recommendationStatus)
      .toBe("indicative");
  });

  it("leaves Data Confidence and supported-weight contracts unchanged", () => {
    expect(DATA_CONFIDENCE_VERSION).toBe("mi-conf-v1");
    expect(CONFIDENCE_CONTRIBUTOR_COUNT).toBe(6);
    expect(Object.values(CONFIDENCE_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(1);
    expect(MARKET_FIT_MIN_SUPPORTED_WEIGHT).toBe(55);
  });
});

describe("MI1H regression and safety fixtures", () => {
  it("pins the operator-approved 18-country calibrated Fit snapshot", () => {
    expect(MI1H_EXPECTED_CALIBRATED_FIT_SNAPSHOT).toEqual({
      US: 66, TH: 62, MY: 57, VN: 53, LK: 53, SG: 51,
      NL: 52, CA: 50, QA: 46, AU: 44, DE: 44, JP: 43,
      KW: 40, GB: 40, AE: 36, KR: 34, SA: 33, OM: 24,
    });
  });

  it("contains no provider transport, score writes, BI writes, or migrations", () => {
    const files = [
      "src/lib/marketIntelligence/calibration/normalize.ts",
      "src/lib/marketIntelligence/calibration/formula.ts",
      "src/lib/marketIntelligence/calibration/report.ts",
      "src/lib/marketIntelligence/calibration/review.ts",
      "src/lib/marketIntelligence/calibration/shadow.ts",
      "src/lib/marketIntelligence/server/calibrationReport.ts",
    ];
    const source = files.map((file) =>
      readFileSync(path.resolve(process.cwd(), file), "utf8")
    ).join("\n");
    expect(source).not.toMatch(/providers\/baci\/(server|metadata|proofExecution)/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/getMarketIntelligenceWriter|ingestTradeObservation|recordFetchResult/);
    expect(source).not.toMatch(/buyer_trade_observations|buyer_intelligence_/);
  });

  it("requires no migration because the existing schema accepts arbitrary non-blank versions", () => {
    const migration = readFileSync(path.resolve(
      process.cwd(),
      "supabase/migrations/0022_market_intelligence_foundation.sql",
    ), "utf8");
    expect(migration).toContain("market_fit_version             text not null");
    expect(migration).toContain("btrim(market_fit_version) <> ''");
    expect(migration).not.toMatch(/market_fit_version\s+in\s*\(/i);
  });
});
