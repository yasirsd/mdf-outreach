import { describe, expect, it } from "vitest";
import {
  MARKET_FIT_MIN_SUPPORTED_WEIGHT,
  MARKET_FIT_WEIGHTS,
  MARKET_FIT_WEIGHT_VERSION,
  classifyMarketFit,
  clamp01,
  composeDataConfidence,
  composeMarketFit,
  normalizeCompetitiveOpportunity,
  normalizeDemandSize,
  normalizeGrowth,
  normalizeIndiaPosition,
  normalizePriceAttractiveness,
  normalizeStability,
} from "./marketFit";

describe("MI0 Market Fit — weights and versioning", () => {
  it("weights sum to 100", () => {
    const total = Object.values(MARKET_FIT_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });

  it("carries a stable weight version so future changes cannot silently rewrite history", () => {
    expect(MARKET_FIT_WEIGHT_VERSION).toBe("mi-fit-v1");
  });
});

describe("MI0 Market Fit — component normalization", () => {
  it("clamp01 clamps and rejects non-finite input", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it("normalizeDemandSize maps log-scale trade value to 0..100 and refuses non-positive input", () => {
    expect(normalizeDemandSize(null)).toBeNull();
    expect(normalizeDemandSize(0)).toBeNull();
    // At the min-bound: expect a low but non-zero score after rounding.
    const low = normalizeDemandSize(1_000_000)!;
    const mid = normalizeDemandSize(100_000_000)!;
    const high = normalizeDemandSize(5_000_000_000)!;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(high).toBe(100);
  });

  it("normalizeGrowth anchors around 0% and saturates at ±20/30", () => {
    expect(normalizeGrowth(null)).toBeNull();
    expect(normalizeGrowth(-0.25)).toBe(0);
    expect(normalizeGrowth(0)).toBe(40);
    expect(normalizeGrowth(0.1)).toBe(65);
    expect(normalizeGrowth(0.2)).toBe(80);
    expect(normalizeGrowth(0.5)).toBe(100);
  });

  it("normalizeIndiaPosition combines share with trend", () => {
    expect(normalizeIndiaPosition({ indiaShare: null })).toBeNull();
    const risingTop = normalizeIndiaPosition({ indiaShare: 0.5, shareTrend: "rising" })!;
    const risingLow = normalizeIndiaPosition({ indiaShare: 0.05, shareTrend: "rising" })!;
    expect(risingTop).toBeGreaterThan(risingLow);
    expect(risingTop).toBeLessThanOrEqual(100);
  });

  it("normalizeCompetitiveOpportunity inverts origin concentration", () => {
    expect(normalizeCompetitiveOpportunity(null)).toBeNull();
    expect(normalizeCompetitiveOpportunity(0)).toBe(100);
    expect(normalizeCompetitiveOpportunity(1)).toBe(0);
    expect(normalizeCompetitiveOpportunity(0.5)).toBe(50);
  });

  it("normalizePriceAttractiveness returns null when we have no unit value at all", () => {
    expect(normalizePriceAttractiveness({ hasUnitValue: false })).toBeNull();
    expect(normalizePriceAttractiveness({ hasUnitValue: true, unitValueTrend: "rising" })).toBe(80);
    expect(normalizePriceAttractiveness({ hasUnitValue: true, unitValueTrend: "falling" })).toBe(35);
  });

  it("normalizeStability maps 0..1 index to 0..100", () => {
    expect(normalizeStability(null)).toBeNull();
    expect(normalizeStability(0)).toBe(0);
    expect(normalizeStability(0.5)).toBe(50);
    expect(normalizeStability(1)).toBe(100);
  });
});

describe("MI0 Market Fit — aggregation and classification", () => {
  const CALC_AT = "2026-09-01T00:00:00.000Z";

  it("returns insufficient_evidence when supported weight is below the minimum", () => {
    const result = composeMarketFit(
      [
        { key: "demand_size", value: 90, reason: "Large market", supportCount: 5 },
        { key: "demand_growth", value: null, reason: "Growth unavailable", supportCount: 0 },
        { key: "india_position", value: null, reason: "India share unavailable", supportCount: 0 },
        { key: "competitive_opportunity", value: null, reason: "Origins unavailable", supportCount: 0 },
        { key: "price_attractiveness", value: null, reason: "Unit value unavailable", supportCount: 0 },
        { key: "demand_stability", value: null, reason: "Too few periods", supportCount: 0 },
      ],
      CALC_AT,
    );
    expect(result.score).toBeNull();
    expect(result.classification).toBe("insufficient_evidence");
  });

  it("renormalizes by supported weight so missing components neither zero nor inflate the score", () => {
    // Only demand_size + demand_growth + india_position + competitive_opportunity
    // supplied. Their weights = 25+20+20+15 = 80 (≥ 55), so a score is published.
    const result = composeMarketFit(
      [
        { key: "demand_size", value: 90, reason: "Large market", supportCount: 5 },
        { key: "demand_growth", value: 80, reason: "Strong recent growth", supportCount: 5 },
        { key: "india_position", value: 60, reason: "India share moderate", supportCount: 5 },
        { key: "competitive_opportunity", value: 70, reason: "Diverse origins", supportCount: 5 },
        { key: "price_attractiveness", value: null, reason: "Unit value unavailable", supportCount: 0 },
        { key: "demand_stability", value: null, reason: "Too few periods", supportCount: 0 },
      ],
      CALC_AT,
    );
    expect(result.score).not.toBeNull();
    expect(result.classification).toBe("strong_opportunity");
    expect(result.positiveReasons).toContain("Large market");
    expect(result.positiveReasons).toContain("Strong recent growth");
    expect(result.negativeReasons.length).toBe(0);
  });

  it("classifyMarketFit maps score ranges to the documented labels", () => {
    expect(classifyMarketFit(90)).toBe("excellent_opportunity");
    expect(classifyMarketFit(75)).toBe("strong_opportunity");
    expect(classifyMarketFit(60)).toBe("moderate_opportunity");
    expect(classifyMarketFit(45)).toBe("weak_opportunity");
    expect(classifyMarketFit(20)).toBe("low_opportunity");
    expect(classifyMarketFit(null)).toBe("insufficient_evidence");
  });

  it("MIN supported weight is high enough to reject a single-component score", () => {
    // A single demand_size (weight 25) is not enough — publishing a
    // 25/25 score without any other input would be misleading.
    expect(MARKET_FIT_MIN_SUPPORTED_WEIGHT).toBeGreaterThan(25);
    const single = composeMarketFit(
      [
        { key: "demand_size", value: 100, reason: "Large market", supportCount: 5 },
        { key: "demand_growth", value: null, reason: "Growth unavailable", supportCount: 0 },
        { key: "india_position", value: null, reason: "India share unavailable", supportCount: 0 },
        { key: "competitive_opportunity", value: null, reason: "Origins unavailable", supportCount: 0 },
        { key: "price_attractiveness", value: null, reason: "Unit value unavailable", supportCount: 0 },
        { key: "demand_stability", value: null, reason: "Too few periods", supportCount: 0 },
      ],
      CALC_AT,
    );
    expect(single.score).toBeNull();
  });
});

describe("MI0 Data Confidence — deterministic multi-dimension score", () => {
  const CALC_AT = "2026-09-01T00:00:00.000Z";

  it("Tier A + full coverage + full recency lands near 100", () => {
    const result = composeDataConfidence(
      {
        sourceTier: "A",
        coverageCompleteness: 1,
        dataRecency: 1,
        periodContinuity: 1,
        quantityAvailability: 1,
        partnerCompleteness: 1,
        hsMappingCertainty: 1,
      },
      CALC_AT,
    );
    expect(result.score).toBe(100);
  });

  it("Tier E + sparse coverage collapses toward the low end but reports each component", () => {
    const result = composeDataConfidence(
      {
        sourceTier: "E",
        coverageCompleteness: 0.2,
        dataRecency: 0.1,
        periodContinuity: 0.1,
        quantityAvailability: 0.1,
        partnerCompleteness: 0.1,
        hsMappingCertainty: 0.1,
      },
      CALC_AT,
    );
    expect(result.score).toBeLessThan(30);
    // Every component is reported even at low overall confidence.
    expect(result.components.length).toBeGreaterThanOrEqual(7);
  });
});
