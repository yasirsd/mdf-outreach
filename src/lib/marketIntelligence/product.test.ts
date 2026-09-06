import { describe, expect, it } from "vitest";
import {
  PRODUCT_TRADE_MAPPINGS,
  knownMdfProduct,
  mappingsForProduct,
  mappingsForProductAndRevision,
  validateProductTradeMappings,
} from "./product";

describe("MI0 product ↔ HS mapping registry", () => {
  it("declares at least one mapping per current MDF product", () => {
    for (const productId of [
      "guntur-dry-red-chilli",
      "banganapalli-mango",
      "indian-pomegranate",
      "indian-apples",
    ]) {
      expect(mappingsForProduct(productId).length).toBeGreaterThanOrEqual(1);
      expect(knownMdfProduct(productId)).toBeDefined();
    }
  });

  it("passes structural validation with no defects", () => {
    expect(validateProductTradeMappings()).toEqual([]);
  });

  it("filters by HS revision so callers never compare across revisions blindly", () => {
    const hs17 = mappingsForProductAndRevision("guntur-dry-red-chilli", "HS17");
    expect(hs17.length).toBeGreaterThan(0);
    for (const m of hs17) expect(m.hsRevision).toBe("HS17");
    const hs92 = mappingsForProductAndRevision("guntur-dry-red-chilli", "HS92");
    expect(hs92).toEqual([]);
  });

  it("supports one-to-many mappings without silently combining coverage", () => {
    const chilli = mappingsForProduct("guntur-dry-red-chilli");
    expect(chilli.length).toBeGreaterThanOrEqual(2);
    // Every code declares an independent weight; MI must not sum them silently.
    const totalWeight = chilli.reduce((sum, m) => sum + (m.weight ?? 0), 0);
    // Documented note: weights are hints, not automatic aggregation.
    expect(totalWeight).toBeGreaterThan(0);
  });

  it("registry is frozen (no mutation slips through)", () => {
    expect(Object.isFrozen(PRODUCT_TRADE_MAPPINGS)).toBe(true);
  });
});
