import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeDataConfidence, composeMarketFit } from "./marketFit";
import { buildMarketRecommendation } from "./recommendation";

const calculatedAt = "2026-09-06T00:00:00.000Z";
const diagnosticFit = composeMarketFit([
  { key: "demand_size", value: 90, reason: "Large mapped trade category", supportCount: 5 },
  { key: "demand_growth", value: 80, reason: "Consecutive annual growth", supportCount: 5 },
  { key: "india_position", value: 70, reason: "India has a measured position", supportCount: 5 },
], calculatedAt);
const confidence = composeDataConfidence({
  sourceTier: "A", coverageCompleteness: 0.9, dataRecency: 0.9,
  periodContinuity: 0.9, quantityAvailability: 0.8,
  partnerCompleteness: 0.9, hsMappingCertainty: 0.95,
}, calculatedAt);

describe("MI1A central Market Recommendation publication contract", () => {
  it("suppresses a composite mapping's diagnostic score from publication", () => {
    expect(diagnosticFit.score).not.toBeNull();
    const result = buildMarketRecommendation({
      diagnosticFit, dataConfidence: confidence, mappingKind: "composite", mappingConfidence: 0.3,
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(result.diagnosticFitScore).toBe(diagnosticFit.score);
    expect(result.publishedFitScore).toBeNull();
    expect(result.recommendationStatus).toBe("insufficient_evidence");
    expect(result.publicationReason).toBe("insufficient_mapping_specificity");
    expect(result.isTradeProxy).toBe(false);
  });

  it("publishes a proxy score with a mandatory trade-proxy flag and indicative cap", () => {
    const result = buildMarketRecommendation({
      diagnosticFit, dataConfidence: confidence, mappingKind: "proxy", mappingConfidence: 0.7,
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(result.publishedFitScore).toBe(diagnosticFit.score);
    expect(result.isTradeProxy).toBe(true);
    expect(result.recommendationStatus).toBe("indicative");
    expect(result.publicationReason).toBe("published_trade_proxy");
  });

  it("allows an exact mapping to become actionable when every gate passes", () => {
    const result = buildMarketRecommendation({
      diagnosticFit, dataConfidence: confidence, mappingKind: "exact", mappingConfidence: 0.95,
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(result.publishedFitScore).toBe(diagnosticFit.score);
    expect(result.isTradeProxy).toBe(false);
    expect(result.recommendationStatus).toBe("actionable");
    expect(result.publicationReason).toBe("published_exact");
  });

  it("withholds publication when a required evidence or confidence gate is absent", () => {
    const missingHistory = buildMarketRecommendation({
      diagnosticFit, dataConfidence: confidence, mappingKind: "exact", mappingConfidence: 0.95,
      hasDemandSizeEvidence: true, hasHistoricalEvidence: false,
    });
    expect(missingHistory.publishedFitScore).toBeNull();
    expect(missingHistory.recommendationStatus).toBe("insufficient_evidence");

    const missingConfidence = buildMarketRecommendation({
      diagnosticFit, dataConfidence: null, mappingKind: "exact", mappingConfidence: 0.95,
      hasDemandSizeEvidence: true, hasHistoricalEvidence: true,
    });
    expect(missingConfidence.publishedFitScore).toBeNull();
    expect(missingConfidence.publicationReason).toBe("missing_data_confidence");
  });

  it("keeps raw diagnostic composition out of UI, actions, and repositories", () => {
    const roots = ["src/app", "src/components", "src/lib/repositories"];
    const sourceFiles: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) visit(file);
        else if (/\.(?:ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
          sourceFiles.push(file);
        }
      }
    };
    for (const root of roots) visit(path.resolve(process.cwd(), root));

    const offenders = sourceFiles.filter((file) => readFileSync(file, "utf8").includes("composeMarketFit"));
    expect(offenders).toEqual([]);
  });
});
