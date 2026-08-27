import { describe, it, expect } from "vitest";
import {
  clampPercent,
  formatUsageResetDate,
  percentUsed,
  primaryUsageBucket,
  toUsageBucket,
  usageLevel,
} from "./usage";
import { MOCK_HUNTER_USAGE, MOCK_HUNTER_USAGE_SPLIT } from "./mock/usage";

describe("percentUsed / clampPercent", () => {
  it("computes used / available * 100", () => {
    expect(percentUsed(8, 50)).toBe(16);
  });

  it("clamps to 0–100", () => {
    expect(clampPercent(-4)).toBe(0);
    expect(clampPercent(116)).toBe(100);
    expect(percentUsed(150, 100)).toBe(100);
  });

  it("available = 0 is a safe zero state (no NaN / Infinity)", () => {
    expect(percentUsed(8, 0)).toBe(0);
    expect(percentUsed(0, 0)).toBe(0);
    expect(percentUsed(Number.NaN, 50)).toBe(0);
    expect(percentUsed(8, Number.POSITIVE_INFINITY)).toBe(0);
    const bucket = toUsageBucket(8, 0, 0);
    expect(bucket.percentUsed).toBe(0);
    expect(Number.isFinite(bucket.percentUsed)).toBe(true);
  });

  it("maps percent to usage levels", () => {
    expect(usageLevel(0)).toBe("normal");
    expect(usageLevel(59)).toBe("normal");
    expect(usageLevel(60)).toBe("attention");
    expect(usageLevel(79)).toBe("attention");
    expect(usageLevel(80)).toBe("low");
    expect(usageLevel(94)).toBe("low");
    expect(usageLevel(95)).toBe("critical");
    expect(usageLevel(100)).toBe("critical");
  });
});

describe("formatUsageResetDate", () => {
  it("formats a date-only reset as Month D, YYYY", () => {
    expect(formatUsageResetDate("2026-09-17")).toBe("Sep 17, 2026");
  });

  it("returns null for missing or invalid reset dates", () => {
    expect(formatUsageResetDate(null)).toBeNull();
    expect(formatUsageResetDate(undefined)).toBeNull();
    expect(formatUsageResetDate("")).toBeNull();
    expect(formatUsageResetDate("not-a-date")).toBeNull();
  });
});

describe("primaryUsageBucket", () => {
  it("prefers unified credits", () => {
    const primary = primaryUsageBucket(MOCK_HUNTER_USAGE);
    expect(primary?.label).toBe("Credits");
    expect(primary?.bucket.remaining).toBe(50);
  });

  it("falls back to searches when unified credits are absent", () => {
    const primary = primaryUsageBucket(MOCK_HUNTER_USAGE_SPLIT);
    expect(primary?.label).toBe("Search credits");
    expect(primary?.bucket.remaining).toBe(40);
  });
});
