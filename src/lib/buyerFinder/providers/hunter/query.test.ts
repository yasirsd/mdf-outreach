import { describe, it, expect } from "vitest";
import type { ProductKey } from "@/lib/email/themes/types";
import {
  BUYER_TYPE_SEARCH_KEYWORDS,
  PRODUCT_SEARCH_KEYWORDS,
  buildHunterDiscoverPlan,
  collectHunterKeywords,
  countryToIsoAlpha2,
} from "./query";
import { HunterDiscoveryError } from "./errors";

describe("countryToIsoAlpha2", () => {
  it("maps Thailand to TH", () => {
    expect(countryToIsoAlpha2("Thailand")).toBe("TH");
  });

  it("maps UAE and United Arab Emirates to AE", () => {
    expect(countryToIsoAlpha2("UAE")).toBe("AE");
    expect(countryToIsoAlpha2("United Arab Emirates")).toBe("AE");
  });

  it("accepts an already-valid ISO code", () => {
    expect(countryToIsoAlpha2("vn")).toBe("VN");
  });

  it("returns undefined for unknown countries", () => {
    expect(countryToIsoAlpha2("")).toBeUndefined();
    expect(countryToIsoAlpha2("Not A Real Country")).toBeUndefined();
  });
});

describe("collectHunterKeywords / buildHunterDiscoverPlan", () => {
  it("maps existing ProductKeys to the expected Hunter keywords", () => {
    expect(PRODUCT_SEARCH_KEYWORDS["guntur-chilli"]).toEqual([
      "dry red chilli",
      "red chilli",
      "chilli",
      "chili",
      "spices",
      "food spices",
    ]);
    expect(PRODUCT_SEARCH_KEYWORDS["banganapalli-mango"]).toEqual([
      "mango",
      "fresh mango",
      "fresh fruit",
    ]);
    expect(PRODUCT_SEARCH_KEYWORDS.pomegranate).toEqual(["pomegranate", "fresh fruit"]);
    expect(PRODUCT_SEARCH_KEYWORDS["indian-apple"]).toEqual(["apple", "fresh apple", "fresh fruit"]);
  });

  it("does not inject generic import/importer for MDF buyer types", () => {
    const keywords = collectHunterKeywords({
      productKey: "guntur-chilli",
      buyerTypes: ["Importer", "Distributor"],
    });
    expect(keywords).not.toContain("import");
    expect(keywords).not.toContain("importer");
    expect(keywords).not.toContain("export");
    expect(keywords).not.toContain("logistics");
    expect(keywords).not.toContain("freight");
    expect(BUYER_TYPE_SEARCH_KEYWORDS.Importer).toEqual([]);
    const body = buildHunterDiscoverPlan({
      country: "Thailand",
      productKey: "guntur-chilli",
      buyerTypes: ["Importer"],
    }).body;
    expect(body).not.toHaveProperty("company_type");
  });

  it("product-led intent uses only product keywords", () => {
    const keywords = collectHunterKeywords({
      productKey: "guntur-chilli",
      keywordIntent: "product-led",
    });
    expect(keywords).toEqual([
      "dry red chilli",
      "red chilli",
      "chilli",
      "chili",
      "spices",
      "food spices",
    ]);
  });

  it("food-trade intent adds commercial phrases without standalone import", () => {
    const keywords = collectHunterKeywords({
      productKey: "guntur-chilli",
      keywordIntent: "food-trade",
    });
    expect(keywords).toEqual(expect.arrayContaining(["food importer", "spice importer"]));
    expect(keywords).not.toContain("import");
    expect(keywords).not.toContain("importer");
  });

  it("hybrid intent uses a small high-signal set", () => {
    const keywords = collectHunterKeywords({
      productKey: "guntur-chilli",
      keywordIntent: "hybrid",
    });
    expect(keywords.length).toBeLessThanOrEqual(6);
    expect(keywords).toEqual([
      "dry red chilli",
      "red chilli",
      "spice importer",
      "food importer",
      "spice trading",
      "chilli distributor",
    ]);
  });

  it("treats arbitrary industry as a keyword, not a Hunter industry filter", () => {
    const plan = buildHunterDiscoverPlan({
      country: "Thailand",
      productKey: "pomegranate",
      industry: "Food ingredients",
    });
    expect(plan.keywords).toContain("Food ingredients");
    expect(plan.body).not.toHaveProperty("industry");
  });

  it("does not send Hunter company_type, limit, or offset", () => {
    const plan = buildHunterDiscoverPlan({
      country: "Thailand",
      productKey: "guntur-chilli",
      buyerTypes: ["Importer"],
      limit: 20,
    });
    expect(plan.body).not.toHaveProperty("company_type");
    expect(plan.body).not.toHaveProperty("limit");
    expect(plan.body).not.toHaveProperty("offset");
    expect(plan.body).not.toHaveProperty("query");
    expect(plan.body.keywords.match).toBe("any");
    expect(plan.body.headquarters_location.include).toEqual([{ country: "TH" }]);
  });

  it("is deterministic for the same query", () => {
    const q = {
      country: "Thailand",
      productKey: "guntur-chilli" as const,
      buyerTypes: ["Importer" as const],
    };
    expect(JSON.stringify(buildHunterDiscoverPlan(q).body)).toBe(
      JSON.stringify(buildHunterDiscoverPlan(q).body),
    );
  });

  it("fails before any network concern for invalid ProductKey or country", () => {
    expect(() =>
      buildHunterDiscoverPlan({
        country: "Thailand",
        productKey: "not-a-product" as ProductKey,
      }),
    ).toThrow(HunterDiscoveryError);
    expect(() =>
      buildHunterDiscoverPlan({
        country: "Narnia",
        productKey: "guntur-chilli",
      }),
    ).toThrow(/Unsupported or empty country/);
  });
});
