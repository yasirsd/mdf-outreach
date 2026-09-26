import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  CANADA_CID_ATTRIBUTION,
  CANADA_CID_DATASET_ID,
  canadaCidByHs6ByCountryUrl,
  CanadaCidParserError,
  extractCanadianProvince,
  fetchCanadaCidByHs6ByCountry,
  matchCanadaCidCompany,
  normalizeCompanyName,
  normalizeHs6,
  parseCanadaCidRows,
  parseCanadaCidXlsx,
  type CanadaCidRow,
} from "./canadaCid";
import {
  CANADA_CID_DESCRIPTOR,
  canonicalHs6ForProduct,
  DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
  FDA_FSVP_DESCRIPTOR,
  isAutomaticallyExecutable,
  planTradeResearch,
} from "./providers";

const REPO_ROOT = process.cwd();
const LEGITIMACY_DOC_PATH = "docs/bi4f-phase2b-canada-cid-legitimacy.md";

function caCandidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000102",
    companyName: "Loblaw Companies Limited",
    country: "Canada",
    city: "Brampton, ON L6Y 5S5",
    industry: "Food",
    isImporter: true,
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function usCandidate(): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    companyName: "Iberia Foods",
    country: "United States",
    city: "Brooklyn, NY 11220",
    industry: "Food",
    isImporter: true,
    discoveryStatus: "ready",
    reviewStatus: "pending",
  };
}

function xlsx(): Uint8Array {
  const shared = [
    "Canadian Importers Database — Major Importers by HS6, country (2024)",
    "HS6", "Country of Origin", "Importer Name", "Province", "City",
    "090421", "IND", "LOBLAW COMPANIES LIMITED", "ON", "Brampton",
    "090421", "CHN", "LOBLAW COMPANIES LIMITED", "ON", "Brampton",
    "090421", "IND", "MDF EXPORTS SANDBOX INC.", "QC", "Montréal",
  ];
  return zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8([
      `<worksheet><sheetData>`,
      `<row><c r="A1" t="s"><v>0</v></c></row>`,
      `<row>`,
        `<c r="A2" t="s"><v>1</v></c>`,
        `<c r="B2" t="s"><v>2</v></c>`,
        `<c r="C2" t="s"><v>3</v></c>`,
        `<c r="D2" t="s"><v>4</v></c>`,
        `<c r="E2" t="s"><v>5</v></c>`,
      `</row>`,
      `<row>`,
        `<c r="A3" t="s"><v>6</v></c>`,
        `<c r="B3" t="s"><v>7</v></c>`,
        `<c r="C3" t="s"><v>8</v></c>`,
        `<c r="D3" t="s"><v>9</v></c>`,
        `<c r="E3" t="s"><v>10</v></c>`,
      `</row>`,
      `<row>`,
        `<c r="A4" t="s"><v>11</v></c>`,
        `<c r="B4" t="s"><v>12</v></c>`,
        `<c r="C4" t="s"><v>13</v></c>`,
        `<c r="D4" t="s"><v>14</v></c>`,
        `<c r="E4" t="s"><v>15</v></c>`,
      `</row>`,
      `<row>`,
        `<c r="A5" t="s"><v>16</v></c>`,
        `<c r="B5" t="s"><v>17</v></c>`,
        `<c r="C5" t="s"><v>18</v></c>`,
        `<c r="D5" t="s"><v>19</v></c>`,
        `<c r="E5" t="s"><v>20</v></c>`,
      `</row>`,
      `</sheetData></worksheet>`,
    ].join("")),
  });
}

describe("BI4F 2B — descriptor is enabled with the worker dispatch", () => {
  it("costClass is 'free' — planner treats CID as an automatically-executable free source", () => {
    expect(CANADA_CID_DESCRIPTOR.costClass).toBe("free");
    expect(isAutomaticallyExecutable(CANADA_CID_DESCRIPTOR)).toBe(true);
  });

  it("countries stays CA-only", () => {
    expect(CANADA_CID_DESCRIPTOR.countries).toEqual(["CA"]);
  });

  it("CA candidate + Canada CID → eligible", () => {
    const [plan] = planTradeResearch({
      candidate: caCandidate(), countryCode: "CA", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: [CANADA_CID_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(true);
    expect(plan.reason).toBe("eligible");
    expect(plan.automaticSpendRupees).toBe(0);
  });

  it("CA candidate + FDA FSVP → wrong_country (Phase 2A unchanged)", () => {
    const [plan] = planTradeResearch({
      candidate: caCandidate(), countryCode: "CA", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: [FDA_FSVP_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("wrong_country");
  });

  it("US candidate + FDA FSVP → eligible (Phase 2A regression preserved)", () => {
    const [plan] = planTradeResearch({
      candidate: usCandidate(), countryCode: "US", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: [FDA_FSVP_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(true);
    expect(plan.reason).toBe("eligible");
  });

  it("US candidate + Canada CID → wrong_country", () => {
    const [plan] = planTradeResearch({
      candidate: usCandidate(), countryCode: "US", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: [CANADA_CID_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("wrong_country");
  });

  it("US candidate against BOTH default descriptors → exactly ONE eligible (FDA); Canada CID refused", () => {
    const plans = planTradeResearch({
      candidate: usCandidate(), countryCode: "US", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligible = plans.filter((plan) => plan.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.descriptor.id).toBe("fda-fsvp");
    expect(plans.find((p) => p.descriptor.id === "canada-cid")!.reason).toBe("wrong_country");
  });

  it("CA candidate against BOTH default descriptors → exactly ONE eligible (Canada CID); FDA wrong_country", () => {
    const plans = planTradeResearch({
      candidate: caCandidate(), countryCode: "CA", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligible = plans.filter((plan) => plan.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.descriptor.id).toBe("canada-cid");
    expect(plans.find((p) => p.descriptor.id === "fda-fsvp")!.reason).toBe("wrong_country");
  });
});

describe("BI4F 2B — canonical HS6 mapping (never treat proxy/composite as exact evidence)", () => {
  it("guntur-dry-red-chilli maps to HS6 090421 as a proxy (not exact)", () => {
    const mapping = canonicalHs6ForProduct("guntur-dry-red-chilli");
    expect(mapping).toEqual({ hs6: "090421", kind: "proxy" });
  });

  it("indian-apples maps to HS6 080810 as exact", () => {
    const mapping = canonicalHs6ForProduct("indian-apples");
    expect(mapping).toEqual({ hs6: "080810", kind: "exact" });
  });

  it("banganapalli-mango maps to HS6 080450 as a composite (mango shares bucket with guava, mangosteen)", () => {
    const mapping = canonicalHs6ForProduct("banganapalli-mango");
    expect(mapping).toEqual({ hs6: "080450", kind: "composite" });
  });

  it("returns undefined for an unknown product ID", () => {
    expect(canonicalHs6ForProduct("not-a-real-product")).toBeUndefined();
    expect(canonicalHs6ForProduct(undefined)).toBeUndefined();
  });
});

describe("BI4F 2B — adapter URL + attribution", () => {
  it("returns the ISED file URL for the given dataset year", () => {
    expect(canadaCidByHs6ByCountryUrl(2024)).toBe(
      "https://ised-isde.canada.ca/site/ised/sites/default/files/documents/cid-bdic-majorimportersbyhs6bycountry2024.xls",
    );
  });

  it("declares the correct dataset identifier (matches Open Government resource title)", () => {
    expect(CANADA_CID_DATASET_ID).toBe("cid-major-importers-by-hs6-by-country");
  });

  it("emits the exact OGL Canada attribution string for downstream evidence payloads", () => {
    expect(CANADA_CID_ATTRIBUTION).toBe(
      "Contains information licensed under the Open Government Licence – Canada.",
    );
  });
});

describe("BI4F 2B — HS6 and company-name normalization", () => {
  it("preserves the leading zero on HS6 codes read from Excel-numericised cells", () => {
    expect(normalizeHs6("090421")).toBe("090421");
    expect(normalizeHs6("90421")).toBe("090421");
    expect(normalizeHs6(90421)).toBe("090421");
    expect(normalizeHs6("  090421  ")).toBe("090421");
    expect(normalizeHs6("")).toBeUndefined();
    expect(normalizeHs6("abc")).toBeUndefined();
  });

  it("drops English and French legal suffixes deterministically (never fuzzy)", () => {
    expect(normalizeCompanyName("Loblaw Companies Limited")).toBe("LOBLAW COMPANIES");
    expect(normalizeCompanyName("Loblaw Companies Ltd.")).toBe("LOBLAW COMPANIES");
    expect(normalizeCompanyName("Loblaw Companies Ltée")).toBe("LOBLAW COMPANIES");
    expect(normalizeCompanyName("Sobeys Inc.")).toBe("SOBEYS");
    expect(normalizeCompanyName("Métro Inc.")).toBe("METRO");
  });

  it("extracts Canadian province from address text (postal-code anchored + name)", () => {
    expect(extractCanadianProvince(undefined, "Brampton, ON L6Y 5S5")).toBe("ON");
    expect(extractCanadianProvince("100 rue Rachel Est, Montréal, QC H2W 1E7", undefined)).toBe("QC");
    expect(extractCanadianProvince(undefined, "Vancouver, British Columbia")).toBe("BC");
    expect(extractCanadianProvince(undefined, "Halifax, Nova Scotia")).toBe("NS");
    expect(extractCanadianProvince(undefined, undefined)).toBeUndefined();
    expect(extractCanadianProvince(undefined, "Anywhere USA")).toBeUndefined();
  });
});

describe("BI4F 2B — XLSX parser (Major Importers by HS6, country)", () => {
  it("parses a valid workbook, preserves HS6 leading zeros, and emits normalized rows", () => {
    const parsed = parseCanadaCidXlsx(xlsx());
    expect(parsed.publishedPeriod).toBe("2024");
    expect(parsed.malformedRowCount).toBe(0);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toEqual({
      hs6: "090421", originCountry: "IND", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton",
    });
  });

  it("throws PARSER_INCOMPATIBLE on bytes that are not a zip", () => {
    expect(() => parseCanadaCidXlsx(new Uint8Array([1, 2, 3]))).toThrow(CanadaCidParserError);
  });

  it("throws PARSER_INCOMPATIBLE when the expected headers are missing", () => {
    const matrix: Record<string, string>[] = [
      { A: "Some other workbook" },
      { A: "Unrelated header 1", B: "Unrelated header 2" },
    ];
    expect(() => parseCanadaCidRows(matrix)).toThrow(CanadaCidParserError);
  });

  it("counts malformed rows without abandoning valid data", () => {
    const matrix: Record<string, string>[] = [
      { A: "Canadian Importers Database (2024)" },
      { A: "HS6", B: "Country of Origin", C: "Importer Name", D: "Province", E: "City" },
      { A: "090421", B: "IND", C: "LOBLAW COMPANIES LIMITED", D: "ON", E: "Brampton" },
      { A: "not-a-number", B: "IND", C: "BAD ROW LTD", D: "ON", E: "Toronto" }, // malformed HS
      { A: "090421", B: "??", C: "ANOTHER BAD ROW", D: "ON", E: "Toronto" }, // malformed origin
    ];
    const parsed = parseCanadaCidRows(matrix);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.malformedRowCount).toBe(2);
  });

  it("deduplicates identical (HS6, origin, normalized company) rows", () => {
    const matrix: Record<string, string>[] = [
      { A: "Canadian Importers Database (2024)" },
      { A: "HS6", B: "Country of Origin", C: "Importer Name", D: "Province", E: "City" },
      { A: "090421", B: "IND", C: "LOBLAW COMPANIES LIMITED", D: "ON", E: "Brampton" },
      { A: "090421", B: "IND", C: "Loblaw Companies Ltd", D: "ON", E: "Brampton" },
    ];
    const parsed = parseCanadaCidRows(matrix);
    expect(parsed.rows).toHaveLength(1);
  });
});

describe("BI4F 2B — company matching (deterministic, HS6-scoped)", () => {
  const rows: CanadaCidRow[] = [
    { hs6: "090421", originCountry: "IND", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
    { hs6: "090421", originCountry: "CHN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
    { hs6: "090421", originCountry: "IND", companyName: "MDF EXPORTS SANDBOX INC.", province: "QC", city: "Montréal" },
    { hs6: "080810", originCountry: "USA", companyName: "APPLE CANADA CORP.", province: "ON", city: "Toronto" },
  ];

  it("exact name + matching province → 'strong'", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies Limited", city: "Brampton, ON L6Y 5S5",
      targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("strong");
    expect(result.candidateProvince).toBe("ON");
    expect(result.matchedRows).toHaveLength(2);
    expect(result.originCountries.sort()).toEqual(["CHN", "IND"]);
  });

  it("name matches but no candidate province → 'ambiguous'", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies Ltd", targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("ambiguous");
    expect(result.candidateProvince).toBeUndefined();
    expect(result.originCountries.sort()).toEqual(["CHN", "IND"]);
  });

  it("name matches but province conflicts (all CID rows carry province) → 'rejected'", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies Limited", city: "Vancouver, BC V6B 4Y8",
      targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("rejected");
    expect(result.candidateProvince).toBe("BC");
  });

  it("no company match for target HS6 → 'none'", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies Limited", city: "Brampton, ON",
      targetHs6: "080810", // apples, not chilli
      rows,
    });
    expect(result.decision).toBe("none");
    expect(result.matchedRows).toHaveLength(0);
    expect(result.originCountries).toHaveLength(0);
  });

  it("empty candidate name → 'none' (never fuzzy-matches)", () => {
    const result = matchCanadaCidCompany({
      companyName: "  ", targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("none");
  });

  it("target HS6 is malformed → 'none' with a safe reason (never guesses HS)", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies", targetHs6: "not-a-hs", rows,
    });
    expect(result.decision).toBe("none");
    expect(result.reason).toMatch(/target hs6/i);
  });
});

describe("BI4F 2B — evidence-join safety (prohibited inference stays prohibited)", () => {
  it("matcher never returns origin countries that are not on the SAME row as the matched company", () => {
    // The Loblaw+IND row and the Metro+CHN row must NEVER combine to
    // yield 'Loblaw imports from CHN'. matchCanadaCidCompany only
    // returns originCountries from rows whose normalized company
    // name matches the input.
    const rows: CanadaCidRow[] = [
      { hs6: "090421", originCountry: "IND", companyName: "LOBLAW COMPANIES LIMITED", province: "ON" },
      { hs6: "090421", originCountry: "CHN", companyName: "METRO INC.", province: "QC" },
    ];
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies", city: "Brampton, ON L6Y 5S5",
      targetHs6: "090421", rows,
    });
    expect(result.originCountries).toEqual(["IND"]);
    expect(result.matchedRows.every((row) => row.companyName === "LOBLAW COMPANIES LIMITED")).toBe(true);
  });

  it("matcher HS6-scopes correctly: a company row for HS 080810 cannot corroborate a HS 090421 query", () => {
    const rows: CanadaCidRow[] = [
      { hs6: "080810", originCountry: "USA", companyName: "LOBLAW COMPANIES LIMITED", province: "ON" },
    ];
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies", city: "Brampton, ON",
      targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("none");
    expect(result.originCountries).toHaveLength(0);
  });
});

describe("BI4F 2B — network fetch (bounded, conditional, safe)", () => {
  it("returns 'not_modified' on a 304 without downloading bytes", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    const result = await fetchCanadaCidByHs6ByCountry({
      year: 2024, etag: "\"v1\"", lastModified: "Wed, 25 Sep 2026 08:27:55 GMT", fetchImpl,
    });
    expect(result.outcome).toBe("not_modified");
    expect(result.bytes).toBeUndefined();
    expect(result.sourceUrl).toContain("cid-bdic-majorimportersbyhs6bycountry2024.xls");
  });

  it("returns a SHA-256 material hash for a downloaded payload", async () => {
    const bytes = xlsx();
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/vnd.ms-excel", etag: "\"v2\"", "last-modified": "Fri, 26 Sep 2026 08:27:55 GMT" },
    })) as unknown as typeof fetch;
    const result = await fetchCanadaCidByHs6ByCountry({ year: 2024, fetchImpl });
    expect(result.outcome).toBe("downloaded");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.materialHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.etag).toBe("\"v2\"");
    expect(result.lastModified).toBe("Fri, 26 Sep 2026 08:27:55 GMT");
  });

  it("classifies a transient 5xx as TRANSIENT_HTTP for retry-wait release", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream error", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchCanadaCidByHs6ByCountry({ year: 2024, fetchImpl }))
      .rejects.toMatchObject({ code: "TRANSIENT_HTTP", status: 502 });
  });

  it("rejects an oversized payload declared via content-length", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(0), {
      status: 200, headers: { "content-length": String(200 * 1024 * 1024) },
    })) as unknown as typeof fetch;
    await expect(fetchCanadaCidByHs6ByCountry({ year: 2024, fetchImpl }))
      .rejects.toBeInstanceOf(CanadaCidParserError);
  });
});

describe("BI4F 2B — legitimacy doc is present and unchanged in spirit", () => {
  const doc = readFileSync(path.resolve(REPO_ROOT, LEGITIMACY_DOC_PATH), "utf8");

  it("names publisher (ISED) and source data (CBSA)", () => {
    expect(doc).toMatch(/Innovation, Science and Economic Development Canada/i);
    expect(doc).toMatch(/Canada Border Services Agency/i);
  });

  it("names the OGL Canada v2.0 and captures the verbatim attribution string", () => {
    expect(doc).toMatch(/Open Government Licence [–-] Canada, v2\.0/);
    expect(doc).toMatch(/Contains information licensed under the Open Government Licence [–-] Canada\./);
  });

  it("locks the shipment-absent contract", () => {
    expect(doc).toMatch(/shipment.*(?:no|absent|suppressed)/i);
    expect(doc).toMatch(/not divulged|explicitly suppressed/i);
  });
});
