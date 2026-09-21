import { describe, expect, it } from "vitest";
import {
  BACI_NUMBER_MAX_DECIMAL_PLACES,
  BACI_NUMBER_TOLERANCE_MULTIPLIER,
  baciNumberTolerance,
  canonicalizeBaciNumber,
} from "./numeric";

describe("MI1F.3 BACI floating-point canonicalization", () => {
  it.each([
    [675.9999999999999, 676],
    [537.9999999999999, 538],
    [240914.00000000003, 240914],
    [7087.000000000001, 7087],
    [173.00000000000003, 173],
    [0.052000000000000005, 0.052],
    [89.01799999999999, 89.018],
    [18.660999999999998, 18.661],
    [202.96900000000002, 202.969],
    [175.25400000000002, 175.254],
  ])("stabilizes observed BACI representation noise: %s -> %s", (input, expected) => {
    expect(canonicalizeBaciNumber(input)).toBe(expected);
  });

  it("documents a conservative machine-precision tolerance and decimal search bound", () => {
    expect(BACI_NUMBER_TOLERANCE_MULTIPLIER).toBe(4);
    expect(BACI_NUMBER_MAX_DECIMAL_PLACES).toBe(15);
    expect(baciNumberTolerance(240914)).toBe(
      4 * Number.EPSILON * Math.max(1, Math.abs(240914)),
    );
  });

  it("preserves exact zero and does not collapse a non-zero value to zero", () => {
    expect(canonicalizeBaciNumber(0)).toBe(0);
    expect(canonicalizeBaciNumber(1e-16)).toBe(1e-16);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeBaciNumber(Number.NaN)).toThrow(/finite number/);
    expect(() => canonicalizeBaciNumber(Number.POSITIVE_INFINITY)).toThrow(/finite number/);
    expect(() => canonicalizeBaciNumber(Number.NEGATIVE_INFINITY)).toThrow(/finite number/);
  });

  it("preserves genuine differences and legitimate high precision", () => {
    expect(canonicalizeBaciNumber(676)).toBe(676);
    expect(canonicalizeBaciNumber(677)).toBe(677);
    expect(canonicalizeBaciNumber(0.052)).toBe(0.052);
    expect(canonicalizeBaciNumber(0.053)).toBe(0.053);
    expect(canonicalizeBaciNumber(1.234567)).toBe(1.234567);
    expect(canonicalizeBaciNumber(1.234568)).toBe(1.234568);
    expect(canonicalizeBaciNumber(Math.PI)).toBe(Math.PI);
  });
});
