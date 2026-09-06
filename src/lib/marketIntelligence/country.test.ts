import { describe, expect, it } from "vitest";
import { countryDisplayName, marketCountryOptions, toCountryAlpha2 } from "./country";

describe("MI0 country identity", () => {
  it("resolves ISO alpha-2 codes case-insensitively", () => {
    expect(toCountryAlpha2("MY")).toBe("MY");
    expect(toCountryAlpha2("my")).toBe("MY");
    expect(toCountryAlpha2("Ae")).toBe("AE");
  });

  it("resolves canonical display names", () => {
    expect(toCountryAlpha2("United Arab Emirates")).toBe("AE");
    expect(toCountryAlpha2("Malaysia")).toBe("MY");
  });

  it("resolves aliases operators actually type", () => {
    expect(toCountryAlpha2("UAE")).toBe("AE");
    expect(toCountryAlpha2("USA")).toBe("US");
    expect(toCountryAlpha2("UK")).toBe("GB");
  });

  it("returns undefined for garbage rather than inventing a country", () => {
    expect(toCountryAlpha2("Zorbistan")).toBeUndefined();
    expect(toCountryAlpha2("")).toBeUndefined();
    expect(toCountryAlpha2(undefined)).toBeUndefined();
    // Two letters that are not an assigned ISO code
    expect(toCountryAlpha2("ZZ")).toBeUndefined();
  });

  it("countryDisplayName returns a readable name for a canonical code", () => {
    expect(countryDisplayName("MY")).toBe("Malaysia");
    expect(countryDisplayName("AE")).toBe("United Arab Emirates");
    expect(countryDisplayName(undefined)).toBeUndefined();
  });

  it("marketCountryOptions returns the ISO catalogue sorted alphabetically", () => {
    const opts = marketCountryOptions();
    expect(opts.length).toBeGreaterThan(200);
    const names = opts.map((o) => o.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    // Every code is uppercase alpha-2.
    expect(opts.every((o) => /^[A-Z]{2}$/.test(o.code))).toBe(true);
  });
});
