import { describe, it, expect } from "vitest";
import {
  COUNTRIES,
  codeForCountryName,
  findCountryByName,
  searchCountries,
} from "./countries";
import { BUYER_TYPES, findBuyerTypeByLabel } from "./buyerTypes";
import {
  activeProducts,
  findProductByDisplayName,
  PRODUCTS,
} from "./products";

describe("Countries catalogue", () => {
  it("contains EXACTLY 249 assigned ISO-3166-1 rows (source: iso-3166 npm package)", () => {
    // The iso-3166 package publishes every currently-assigned ISO-3166-1
    // alpha-2 country/territory (249 at the time of writing). If the
    // package ships a different number in a future update, this assertion
    // deliberately fails so we can review the delta consciously.
    expect(COUNTRIES.length).toBe(249);
  });

  it("covers previously-missing territories the initial F5 subset omitted", () => {
    // These were absent from the earlier hand-curated list. Assertions
    // verify each shows up in the iso-3166-derived catalogue.
    for (const code of [
      // Small/uninhabited territories:
      "BV", // Bouvet Island
      "HM", // Heard Island and McDonald Islands
      "IO", // British Indian Ocean Territory
      "TF", // French Southern Territories
      "UM", // United States Minor Outlying Islands
      // Populated territories the earlier list skipped:
      "AI", // Anguilla
      "MS", // Montserrat
      "VG", // British Virgin Islands
      "SH", // Saint Helena
      "PM", // Saint Pierre and Miquelon
      "GG", // Guernsey
      "JE", // Jersey
      "BQ", // Bonaire, Sint Eustatius and Saba
      "SX", // Sint Maarten
      "CX", // Christmas Island
      "CC", // Cocos (Keeling) Islands
      "MF", // Saint Martin (French part)
      "BL", // Saint Barthélemy
    ]) {
      expect(COUNTRIES.some((c) => c.code === code)).toBe(true);
    }
  });

  it("includes standard territories still present after ISO reconciliation", () => {
    for (const code of ["PR", "YT", "GI", "HK", "GP", "MQ", "RE", "GF"]) {
      expect(COUNTRIES.some((c) => c.code === code)).toBe(true);
    }
  });

  it("preserves informal aliases (UAE / USA / UK / KSA / Burma)", () => {
    expect(searchCountries("UAE").some((c) => c.code === "AE")).toBe(true);
    expect(searchCountries("USA").some((c) => c.code === "US")).toBe(true);
    expect(searchCountries("uk").some((c) => c.code === "GB")).toBe(true);
    expect(searchCountries("KSA").some((c) => c.code === "SA")).toBe(true);
    expect(searchCountries("burma").some((c) => c.code === "MM")).toBe(true);
  });

  it("preserves informal DISPLAY names (South Korea / United Kingdom / United States)", () => {
    expect(findCountryByName("South Korea")?.code).toBe("KR");
    expect(findCountryByName("United Kingdom")?.code).toBe("GB");
    expect(findCountryByName("United States")?.code).toBe("US");
  });

  it("ISO formal names remain matchable via alias search (backwards compat)", () => {
    expect(codeForCountryName("Korea, Republic of")).toBe("KR");
    expect(
      codeForCountryName("United Kingdom of Great Britain and Northern Ireland"),
    ).toBe("GB");
    expect(codeForCountryName("United States of America")).toBe("US");
  });

  it("has stable canonical names with unique codes", () => {
    const codes = new Set(COUNTRIES.map((c) => c.code));
    expect(codes.size).toBe(COUNTRIES.length);
  });

  it("findCountryByName is case-insensitive and matches canonical rows", () => {
    expect(findCountryByName("thailand")?.code).toBe("TH");
    expect(findCountryByName("United States")?.code).toBe("US");
    expect(findCountryByName("bogus")).toBeUndefined();
  });

  it("searchCountries matches aliases (UAE / USA / UK)", () => {
    expect(searchCountries("UAE").some((c) => c.code === "AE")).toBe(true);
    expect(searchCountries("usa").some((c) => c.code === "US")).toBe(true);
    expect(searchCountries("britain").some((c) => c.code === "GB")).toBe(true);
  });

  it("searchCountries returns the canonical row for a country name substring", () => {
    const t = searchCountries("thai");
    expect(t.some((c) => c.code === "TH")).toBe(true);
  });
});

describe("Buyer type taxonomy", () => {
  it("includes an 'Other' escape hatch flagged with isOther", () => {
    const other = BUYER_TYPES.find((t) => t.isOther);
    expect(other?.label).toBe("Other");
  });

  it("lookup is case-insensitive", () => {
    expect(findBuyerTypeByLabel("importer")?.label).toBe("Importer");
    expect(findBuyerTypeByLabel("Distributor")?.label).toBe("Distributor");
    expect(findBuyerTypeByLabel("nothing at all")).toBeUndefined();
  });
});

describe("Product catalogue", () => {
  it("all 4 known MDF products present + active", () => {
    const activeIds = activeProducts().map((p) => p.id);
    expect(activeIds).toContain("guntur-dry-red-chilli");
    expect(activeIds).toContain("banganapalli-mango");
    expect(activeIds).toContain("indian-pomegranate");
    expect(activeIds).toContain("indian-apples");
  });

  it("every product references an emailThemeKey today (parity with email catalogue)", () => {
    for (const p of PRODUCTS) {
      expect(p.emailThemeKey).not.toBeNull();
    }
  });

  it("findProductByDisplayName resolves canonical names case-insensitively", () => {
    expect(findProductByDisplayName("Guntur Dry Red Chilli")?.id).toBe(
      "guntur-dry-red-chilli",
    );
    expect(findProductByDisplayName("guntur dry red chilli")?.id).toBe(
      "guntur-dry-red-chilli",
    );
    expect(findProductByDisplayName("legacy free-text")).toBeUndefined();
  });
});
