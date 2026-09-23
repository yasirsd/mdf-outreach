import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MarketReadRepositoryScore } from "../marketReadRepository";
import { MI1H_EXPECTED_CALIBRATED_FIT_SNAPSHOT } from "../calibration/shadow";
import {
  assessMarketScoreStaleness,
  deterministicMarketScoreHash,
} from "./scorePersistence";

vi.mock("server-only", () => ({}));

function score(overrides: Partial<MarketReadRepositoryScore> = {}): MarketReadRepositoryScore {
  return {
    id: "score-1",
    countryAlpha2: "MY",
    mdfProductId: "guntur-dry-red-chilli",
    diagnosticFitScore: 57,
    publishedFitScore: 57,
    dataConfidenceScore: 90,
    recommendationStatus: "indicative",
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    fitEligibility: "proxy_allowed",
    isTradeProxy: true,
    marketFitVersion: "mi-fit-v2",
    confidenceVersion: "mi-conf-v1",
    providerSelectionVersion: "mi-select-v2",
    recommendationReason: "published_trade_proxy",
    positiveReasons: [],
    negativeReasons: [],
    sourceCoverage: {
      evidence_watermark: "evidence-a",
      mapping_watermark: "mapping-a",
      mapping_registry_version: "mi-product-map-v1",
    },
    calculatedAt: "2026-09-23T00:00:00.000Z",
    supersededAt: null,
    components: [],
    ...overrides,
  };
}

const expected = {
  evidenceWatermark: "evidence-a",
  mappingWatermark: "mapping-a",
  mappingRegistryVersion: "mi-product-map-v1",
};

describe("MI1I fingerprints and stale-state contract", () => {
  it("canonicalizes object keys before hashing", () => {
    expect(deterministicMarketScoreHash({ a: 1, b: 2 }))
      .toBe(deterministicMarketScoreHash({ b: 2, a: 1 }));
  });

  it("reports scoring-version, evidence, and mapping changes explicitly", () => {
    expect(assessMarketScoreStaleness(score(), expected)).toEqual({ stale: false, reasons: [] });
    expect(assessMarketScoreStaleness(score({ marketFitVersion: "mi-fit-v1" }), expected).reasons)
      .toContain("market_fit_version_changed");
    expect(assessMarketScoreStaleness(score({
      sourceCoverage: { ...score().sourceCoverage, evidence_watermark: "evidence-b" },
    }), expected).reasons).toContain("evidence_watermark_changed");
    expect(assessMarketScoreStaleness(score({
      sourceCoverage: { ...score().sourceCoverage, mapping_watermark: "mapping-b" },
    }), expected).reasons).toContain("mapping_watermark_changed");
    expect(assessMarketScoreStaleness(score({
      sourceCoverage: { ...score().sourceCoverage, mapping_registry_version: "mi-product-map-v0" },
    }), expected).reasons).toContain("mapping_registry_version_changed");
  });

  it("retains the exact 18-country mi-fit-v2 regression snapshot used by persistence", () => {
    expect(MI1H_EXPECTED_CALIBRATED_FIT_SNAPSHOT).toEqual({
      US: 66, TH: 62, MY: 57, VN: 53, LK: 53, NL: 52,
      SG: 51, CA: 50, QA: 46, AU: 44, DE: 44, JP: 43,
      KW: 40, GB: 40, AE: 36, KR: 34, SA: 33, OM: 24,
    });
  });

  it("uses existing schema/RPC locking and introduces no migration, provider, bulk, or BI path", () => {
    const root = process.cwd();
    const implementation = [
      "src/lib/marketIntelligence/server/scoreRefresh.ts",
      "src/lib/marketIntelligence/server/scorePersistence.ts",
      "src/app/api/internal/market-intelligence/scores/refresh/route.ts",
    ].map((file) => readFileSync(path.resolve(root, file), "utf8")).join("\n");
    const migration = readFileSync(path.resolve(
      root, "supabase/migrations/0022_market_intelligence_foundation.sql",
    ), "utf8");
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/market_product_scores_current_uidx[\s\S]*?superseded_at is null/);
    expect(migration).toMatch(/source_coverage\s+jsonb/);
    expect(implementation).not.toMatch(/BotMarket|BACI_OEC_API_KEY|buyer_intelligence_|buyer_trade_observations/);
    expect(implementation).not.toMatch(/\bfetch\s*\(/);
    expect(implementation).not.toMatch(/for\s*\([^)]*calibrationCohort|Promise\.all\([^)]*calibrationCohort/);
    expect(readFileSync(path.resolve(root, "src/lib/marketIntelligence/server/writer.ts"), "utf8"))
      .toContain('import "server-only"');
  });
});
