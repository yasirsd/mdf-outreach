import { describe, expect, it } from "vitest";
import { cagr, stabilityIndex, trendDirection, yearOverYear, type DatedPoint } from "./series";

function pts(values: (number | null)[], startYear = 2020): DatedPoint[] {
  return values.map((v, i) => ({ period: String(startYear + i), value: v }));
}

function pt(period: string, value: number | null): DatedPoint {
  return { period, value };
}

describe("MI0.1 series growth primitives — consecutive-YoY", () => {
  it("insufficient_periods when fewer than two known annual points exist", () => {
    expect(yearOverYear(pts([null, null, 100])).percent).toBeNull();
    expect(yearOverYear(pts([null, null, 100])).reason).toBe("insufficient_periods");
  });

  it("computes YoY when the two most recent known points are consecutive years", () => {
    const result = yearOverYear(pts([100, 120]));
    expect(result.percent).toBeCloseTo(0.2, 5);
    expect(result.reason).toBe("ok");
    expect(result.yearsSpanned).toBe(1);
  });

  it("MI0.1 — REJECTS a YoY when the two most recent known points are not consecutive", () => {
    // Previously (MI0 draft) this returned 20 %. MI0.1 rejects it.
    const result = yearOverYear(pts([100, null, 120]));
    expect(result.percent).toBeNull();
    expect(result.reason).toBe("non_consecutive_periods");
    expect(result.yearsSpanned).toBe(2);
  });

  it("returns null when the base is zero (no +∞, no NaN)", () => {
    const result = yearOverYear(pts([0, 10]));
    expect(result.percent).toBeNull();
    expect(result.reason).toBe("zero_base");
  });

  it("dedupes on year — a duplicate 2024 label does not sneak in as a YoY partner", () => {
    const result = yearOverYear([
      pt("2022", 100),
      pt("2023", 120),
      pt("2024", 150),
      pt("2024", 999),
    ]);
    expect(result.reason).toBe("ok");
    expect(result.percent).toBeCloseTo((150 - 120) / 120, 5);
  });

  it("returns unsorted series correctly (sorted internally)", () => {
    const result = yearOverYear([pt("2024", 150), pt("2023", 120)]);
    expect(result.reason).toBe("ok");
    expect(result.percent).toBeCloseTo(0.25, 5);
  });
});

describe("MI0.1 series growth primitives — calendar-span CAGR", () => {
  it("uses actual elapsed calendar years even with gaps in the series", () => {
    // 2020 → 2024 with only endpoints known ⇒ 4-year exponent.
    const result = cagr(pts([100, null, null, null, 200]), 4);
    expect(result.reason).toBe("ok");
    expect(result.percent).toBeCloseTo(Math.pow(2, 1 / 4) - 1, 5);
    expect(result.yearsSpanned).toBe(4);
    expect(result.supportCount).toBe(2);
  });

  it("classic dense 4-year CAGR still lands on the documented value", () => {
    // 100 → 200 across 2020..2024 ⇒ 4-year CAGR.
    const result = cagr(pts([100, 120, 150, 180, 200]), 4);
    expect(result.reason).toBe("ok");
    expect(result.percent).toBeCloseTo(Math.pow(2, 1 / 4) - 1, 5);
    expect(result.yearsSpanned).toBe(4);
  });

  it("insufficient_periods when no base sits inside the requested trailing window", () => {
    // Series is 2015, 2024. Latest = 2024. Request 3-year CAGR.
    // Target base is 2021; only 2015 exists (too early); return insufficient.
    const result = cagr([pt("2015", 100), pt("2024", 200)], 3);
    expect(result.percent).toBeNull();
    expect(result.reason).toBe("insufficient_periods");
  });

  it("zero_base returns null rather than +∞", () => {
    const result = cagr(pts([0, 100]), 1);
    expect(result.reason).toBe("zero_base");
    expect(result.percent).toBeNull();
    expect(result.yearsSpanned).toBe(1);
  });

  it("negative or non-finite `years` argument is refused", () => {
    expect(cagr(pts([100, 200]), 0).reason).toBe("insufficient_periods");
    expect(cagr(pts([100, 200]), Number.NaN).reason).toBe("insufficient_periods");
  });
});

describe("MI0.1 stabilityIndex + trendDirection (unchanged semantics)", () => {
  it("stabilityIndex returns null with fewer than three known points; flat series scores near 1", () => {
    expect(stabilityIndex(pts([100])).index).toBeNull();
    expect(stabilityIndex(pts([100, 100, 100, 100])).index).toBeCloseTo(1, 5);
  });

  it("volatile series score lower than flat series", () => {
    const flat = stabilityIndex(pts([100, 102, 98, 101])).index ?? 0;
    const volatile = stabilityIndex(pts([100, 300, 50, 400])).index ?? 0;
    expect(flat).toBeGreaterThan(volatile);
  });

  it("trendDirection classifies rising / falling / flat / unknown deterministically", () => {
    expect(trendDirection(pts([10, 20, 30]))).toBe("rising");
    expect(trendDirection(pts([30, 20, 10]))).toBe("falling");
    expect(trendDirection(pts([100, 101, 100]))).toBe("flat");
    expect(trendDirection(pts([null, null, 10]))).toBe("unknown");
  });
});
