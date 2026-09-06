import { describe, expect, it } from "vitest";
import { cagr, stabilityIndex, trendDirection, yearOverYear, type DatedPoint } from "./series";

function pts(values: (number | null)[], startYear = 2020): DatedPoint[] {
  return values.map((v, i) => ({ period: String(startYear + i), value: v }));
}

describe("MI0 series growth primitives — zero vs missing", () => {
  it("YoY returns null with insufficient_periods when fewer than two known points exist", () => {
    expect(yearOverYear(pts([null, null, 100])).percent).toBeNull();
    expect(yearOverYear(pts([null, null, 100])).reason).toBe("insufficient_periods");
  });

  it("YoY skips null samples and computes from the two most recent known points", () => {
    const result = yearOverYear(pts([100, null, 120]));
    expect(result.percent).toBeCloseTo(0.2, 5);
    expect(result.reason).toBe("ok");
    expect(result.supportCount).toBe(2);
  });

  it("YoY returns null when the base is zero (no +∞, no NaN)", () => {
    const result = yearOverYear(pts([50, 0, 10]));
    expect(result.percent).toBeNull();
    expect(result.reason).toBe("zero_base");
  });

  it("CAGR requires a positive base and at least two ordered points", () => {
    expect(cagr(pts([0, 100]), 3).reason).toBe("zero_base");
    expect(cagr(pts([100]), 3).reason).toBe("insufficient_periods");
    expect(cagr(pts([null, null, null]), 3).reason).toBe("insufficient_periods");
  });

  it("CAGR computes the trailing N-year rate correctly", () => {
    // 100 → 200 over 5 annual points (4-year span) ⇒ (2)^(1/4) − 1 ≈ 0.1892
    const result = cagr(pts([100, 120, 150, 180, 200]), 4);
    expect(result.reason).toBe("ok");
    expect(result.percent).toBeCloseTo(Math.pow(2, 1 / 4) - 1, 4);
    expect(result.supportCount).toBe(5);
  });

  it("stabilityIndex returns null with fewer than three known points; a flat series scores near 1", () => {
    expect(stabilityIndex(pts([100])).index).toBeNull();
    expect(stabilityIndex(pts([100, 100, 100, 100])).index).toBeCloseTo(1, 5);
  });

  it("stabilityIndex compresses toward 0 as coefficient of variation grows", () => {
    const flat = stabilityIndex(pts([100, 102, 98, 101])).index ?? 0;
    const volatile = stabilityIndex(pts([100, 300, 50, 400])).index ?? 0;
    expect(flat).toBeGreaterThan(volatile);
    expect(volatile).toBeGreaterThanOrEqual(0);
    expect(volatile).toBeLessThanOrEqual(1);
  });

  it("trendDirection classifies rising / falling / flat / unknown deterministically", () => {
    expect(trendDirection(pts([10, 20, 30]))).toBe("rising");
    expect(trendDirection(pts([30, 20, 10]))).toBe("falling");
    expect(trendDirection(pts([100, 101, 100]))).toBe("flat");
    expect(trendDirection(pts([null, null, 10]))).toBe("unknown");
  });
});
