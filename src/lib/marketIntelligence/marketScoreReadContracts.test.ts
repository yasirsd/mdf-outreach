import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MI1I read repository contracts", () => {
  const source = readFileSync(path.resolve(
    process.cwd(), "src/lib/marketIntelligence/marketReadRepository.ts",
  ), "utf8");

  it("exposes current, component, and history readers with supersession metadata", () => {
    expect(source).toContain("getCurrentMarketScore(");
    expect(source).toContain("getMarketScoreComponents(scoreId: string)");
    expect(source).toContain("getMarketScoreHistory(");
    expect(source).toContain("superseded_at");
    expect(source).toContain("metadata");
  });

  it("keeps reads narrow and current selection explicit", () => {
    expect(source).toContain('.from("market_product_scores")');
    expect(source).toContain('.from("market_product_score_components")');
    expect(source).toContain('.is("superseded_at", null)');
    expect(source).not.toMatch(/select\(\s*["'`]\*["'`]\s*\)/);
  });
});
