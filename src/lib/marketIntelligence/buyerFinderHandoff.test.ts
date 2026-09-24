import { describe, expect, it } from "vitest";
import {
  buildBuyerFinderHandoffHref,
  buildMarketIntelligenceReturnHref,
  resolveMarketIntelligenceBuyerFinderHandoff,
} from "./buyerFinderHandoff";

describe("MI4 Buyer Finder handoff contract", () => {
  it("builds a canonical identity-only handoff URL", () => {
    const href = buildBuyerFinderHandoffHref({
      productId: "guntur-dry-red-chilli",
      countryAlpha2: "us",
    });
    expect(href).toBe("/buyer-finder?product=guntur-dry-red-chilli&country=US&source=market-intelligence");
    expect(href).not.toMatch(/provider|090421|fit|confidence|query|api/i);
  });

  it("recognizes a valid handoff and canonicalizes lowercase country through the catalogue", () => {
    const handoff = resolveMarketIntelligenceBuyerFinderHandoff({
      source: "market-intelligence",
      product: "guntur-dry-red-chilli",
      country: "th",
      marketFit: "100",
      confidence: "100",
    } as Parameters<typeof resolveMarketIntelligenceBuyerFinderHandoff>[0]);
    expect(handoff).toMatchObject({
      productId: "guntur-dry-red-chilli",
      countryAlpha2: "TH",
      countryName: "Thailand",
    });
    expect(handoff).not.toHaveProperty("marketFit");
    expect(handoff).not.toHaveProperty("confidence");
  });

  it("rejects invalid products, countries, source markers, arrays, and malformed input", () => {
    expect(resolveMarketIntelligenceBuyerFinderHandoff({ source: "market-intelligence", product: "bad", country: "US" })).toBeNull();
    expect(resolveMarketIntelligenceBuyerFinderHandoff({ source: "market-intelligence", product: "guntur-dry-red-chilli", country: "XX" })).toBeNull();
    expect(resolveMarketIntelligenceBuyerFinderHandoff({ source: "other", product: "guntur-dry-red-chilli", country: "US" })).toBeNull();
    expect(resolveMarketIntelligenceBuyerFinderHandoff({ source: ["market-intelligence"], product: "guntur-dry-red-chilli", country: "US" })).toBeNull();
    expect(resolveMarketIntelligenceBuyerFinderHandoff(undefined)).toBeNull();
  });

  it("preserves at most four deduplicated canonical countries for the internal return", () => {
    const handoff = resolveMarketIntelligenceBuyerFinderHandoff({
      source: "market-intelligence",
      product: "guntur-dry-red-chilli",
      country: "US",
      returnCompare: "us,TH,US,MY,AE,JP,XX",
    });
    expect(handoff?.returnComparison).toEqual(["US", "TH", "MY", "AE"]);
    expect(buildMarketIntelligenceReturnHref(handoff!)).toBe(
      "/market-intelligence?product=guntur-dry-red-chilli&country=US&compare=US,TH,MY,AE",
    );
  });

  it("never accepts an arbitrary external return target", () => {
    const handoff = resolveMarketIntelligenceBuyerFinderHandoff({
      source: "market-intelligence",
      product: "guntur-dry-red-chilli",
      country: "US",
      returnCompare: "https://evil.example,TH",
    });
    expect(handoff?.returnComparison).toEqual([]);
    expect(buildMarketIntelligenceReturnHref(handoff!)).toBe(
      "/market-intelligence?product=guntur-dry-red-chilli&country=US",
    );
  });
});
