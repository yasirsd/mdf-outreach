import { describe, it, expect } from "vitest";
import {
  assertScore,
  blankToUndefined,
  normalizeDomain,
  normalizeOptionalEmail,
  normalizeOptionalUrl,
} from "./normalize";
import { requireProductKey } from "./productKey";

describe("normalizeDomain", () => {
  it("lowercases, strips www and protocol, and maps blanks to undefined", () => {
    expect(normalizeDomain("  ")).toBeUndefined();
    expect(normalizeDomain("ABCFoods.EXAMPLE")).toBe("abcfoods.example");
    expect(normalizeDomain("https://www.Example.com/path")).toBe("example.com");
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });
});

describe("normalizeOptionalEmail", () => {
  it("trims, lowercases, and maps empty string to undefined", () => {
    expect(normalizeOptionalEmail("")).toBeUndefined();
    expect(normalizeOptionalEmail("  ")).toBeUndefined();
    expect(normalizeOptionalEmail("  Somchai@ABC.example  ")).toBe("somchai@abc.example");
  });
});

describe("normalizeOptionalUrl", () => {
  it("rejects blank and javascript URLs", () => {
    expect(normalizeOptionalUrl("")).toBeUndefined();
    expect(normalizeOptionalUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeOptionalUrl("https://example.com")).toBe("https://example.com");
  });
});

describe("blankToUndefined", () => {
  it("trims whitespace-only values", () => {
    expect(blankToUndefined(undefined)).toBeUndefined();
    expect(blankToUndefined(" x ")).toBe("x");
  });
});

describe("assertScore", () => {
  it("allows 0–100 and rejects out of range", () => {
    expect(assertScore(undefined, "s")).toBeUndefined();
    expect(assertScore(0, "s")).toBe(0);
    expect(assertScore(100, "s")).toBe(100);
    expect(() => assertScore(-20, "s")).toThrow(/s/);
    expect(() => assertScore(500, "s")).toThrow(/s/);
  });
});

describe("requireProductKey", () => {
  it("accepts existing MDF ProductKeys and rejects others", () => {
    expect(requireProductKey("guntur-dry-red-chilli")).toBe("guntur-dry-red-chilli");
    expect(requireProductKey("banganapalli-mango")).toBe("banganapalli-mango");
    expect(requireProductKey("indian-pomegranate")).toBe("indian-pomegranate");
    expect(requireProductKey("indian-apples")).toBe("indian-apples");
    expect(() => requireProductKey("dry-red-chilli")).toThrow(/Invalid MDF business product id/);
    expect(() => requireProductKey("")).toThrow(/Invalid MDF business product id/);
  });
});
