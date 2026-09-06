import { describe, expect, it } from "vitest";
import { derivedUnitValue } from "./unitValue";

describe("MI0 derived unit value — unit safety", () => {
  it("computes USD/kg from a matching pair", () => {
    const result = derivedUnitValue({ tradeValueUsd: 10000, quantity: 5000, quantityUnit: "kg" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.value).toBeCloseTo(2, 5);
      expect(result.result.unit).toBe("USD/kg");
      expect(result.result.label).toBe("Derived import unit value");
    }
  });

  it("refuses to compute when quantity is missing", () => {
    const result = derivedUnitValue({
      tradeValueUsd: 10000,
      quantity: null,
      quantityUnit: "kg",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_quantity");
  });

  it("refuses to compute when the unit is unsupported (never mixes scales)", () => {
    const result = derivedUnitValue({
      tradeValueUsd: 10000,
      quantity: 5000,
      quantityUnit: "other",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_unit");
  });

  it("refuses non-positive inputs so we never produce Infinity or negative unit values", () => {
    expect(derivedUnitValue({ tradeValueUsd: -1, quantity: 100, quantityUnit: "kg" }).ok).toBe(false);
    expect(derivedUnitValue({ tradeValueUsd: 100, quantity: 0, quantityUnit: "kg" }).ok).toBe(false);
  });
});
