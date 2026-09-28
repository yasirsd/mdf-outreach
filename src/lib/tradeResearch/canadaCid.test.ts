import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type { ResearchContext } from "./types";
import {
  CANADA_CID_ATTRIBUTION,
  CANADA_CID_DATASET_ID,
  canadaCidByHs6ByCountryUrl,
  CanadaCidParserError,
  classifyCanadaCidBody,
  extractCanadianProvince,
  fetchCanadaCidByHs6ByCountry,
  matchCanadaCidCompany,
  normalizeCidCountry,
  normalizeCompanyName,
  normalizeHs6,
  parseCanadaCidCsv,
  parseCanadaCidXlsx,
  parseCsvRows,
  type CanadaCidRow,
} from "./canadaCid";
import {
  CANADA_CID_DESCRIPTOR,
  CANADA_CID_SUPPORTED_YEAR,
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

function researchContext(marketCountryCode: string, productId = "guntur-dry-red-chilli"): ResearchContext {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    candidateId: "00000000-0000-4000-8000-000000000002",
    marketCountryCode,
    productId,
    productForm: null,
    researchGoal: "screen_trade_activity",
    providerPlanVersion: "trade-planner-v1",
    interpretationVersion: "trade-interpretation-v1",
  };
}

const CID_CSV_HEADER =
  "HS6-SH6,COMPANY-ENTREPRISE,COUNTRY,PAYS,PROVINCE_ENG,PROVINCE_FRA,CITY-VILLE,POSTAL_CODE-CODE_POSTAL,DATA_YEAR-ANNÉE_DES_DONNÉES";

function cidCsvBytes(rows: string[] = []): Uint8Array {
  const body = [CID_CSV_HEADER, ...rows].join("\n");
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const text = new TextEncoder().encode(body);
  const out = new Uint8Array(bom.byteLength + text.byteLength);
  out.set(bom, 0);
  out.set(text, bom.byteLength);
  return out;
}

describe("BI4F 2B — descriptor is enabled + planner routes correctly", () => {
  it("costClass is 'free' + planner-eligible", () => {
    expect(CANADA_CID_DESCRIPTOR.costClass).toBe("free");
    expect(isAutomaticallyExecutable(CANADA_CID_DESCRIPTOR)).toBe(true);
    expect(CANADA_CID_DESCRIPTOR.countries).toEqual(["CA"]);
  });

  it("CA candidate + Canada CID → eligible", () => {
    const [plan] = planTradeResearch({
      candidate: caCandidate(), context: researchContext("CA"), hasFreshCache: false,
      descriptors: [CANADA_CID_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(true);
    expect(plan.automaticSpendRupees).toBe(0);
  });

  it("US candidate + Canada CID → wrong_country (regression)", () => {
    const [plan] = planTradeResearch({
      candidate: usCandidate(), context: researchContext("US"), hasFreshCache: false,
      descriptors: [CANADA_CID_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("wrong_country");
  });

  it("CA candidate + FDA → wrong_country (regression)", () => {
    const [plan] = planTradeResearch({
      candidate: caCandidate(), context: researchContext("CA"), hasFreshCache: false,
      descriptors: [FDA_FSVP_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("wrong_country");
  });

  it("US candidate + FDA → eligible (Phase 2A regression)", () => {
    const [plan] = planTradeResearch({
      candidate: usCandidate(), context: researchContext("US"), hasFreshCache: false,
      descriptors: [FDA_FSVP_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(true);
  });

  it("CA + both descriptors → exactly ONE eligible (Canada CID)", () => {
    const plans = planTradeResearch({
      candidate: caCandidate(), context: researchContext("CA"), hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligible = plans.filter((p) => p.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.descriptor.id).toBe("canada-cid");
  });
});

describe("BI4F 2B — canonical HS6 mapping (proxy/composite guardrail)", () => {
  it("guntur → 090421 proxy", () => {
    expect(canonicalHs6ForProduct("guntur-dry-red-chilli")).toEqual({ hs6: "090421", kind: "proxy" });
  });
  it("apples → 080810 exact", () => {
    expect(canonicalHs6ForProduct("indian-apples")).toEqual({ hs6: "080810", kind: "exact" });
  });
  it("mango → 080450 composite", () => {
    expect(canonicalHs6ForProduct("banganapalli-mango")).toEqual({ hs6: "080450", kind: "composite" });
  });
});

describe("BI4F 2B — adapter constants + supported year + URL construction", () => {
  it("URL is the .csv path for the supported year", () => {
    expect(canadaCidByHs6ByCountryUrl(CANADA_CID_SUPPORTED_YEAR)).toMatch(/majorimportersbyhs6bycountry\d{4}\.csv$/);
    expect(canadaCidByHs6ByCountryUrl(2020)).toBe(
      "https://ised-isde.canada.ca/site/ised/sites/default/files/documents/cid-bdic-majorimportersbyhs6bycountry2020.csv",
    );
  });
  it("dataset id is stable", () => {
    expect(CANADA_CID_DATASET_ID).toBe("cid-major-importers-by-hs6-by-country");
  });
  it("attribution string is verbatim OGL Canada", () => {
    expect(CANADA_CID_ATTRIBUTION).toBe("Contains information licensed under the Open Government Licence – Canada.");
  });
  it("supported year is the newest usable CSV under the 40 MB cap", () => {
    // 2020 is the latest CID CSV whose content-length fits under our
    // existing 40 MB cap. When ISED next publishes a CID year as
    // CSV under the cap, this constant is bumped in a reviewed change.
    expect(CANADA_CID_SUPPORTED_YEAR).toBe(2020);
  });
});

describe("BI4F 2B — body classifier (magic bytes)", () => {
  it("classifies UTF-8 CSV as 'csv'", () => {
    expect(classifyCanadaCidBody(cidCsvBytes())).toBe("csv");
  });
  it("classifies ZIP magic (XLSX/XLSB) as 'xlsb'", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(classifyCanadaCidBody(bytes)).toBe("xlsb");
  });
  it("classifies OLE2 compound-file magic as 'xls'", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(classifyCanadaCidBody(bytes)).toBe("xls");
  });
  it("classifies '<!DOCTYPE' HTML as 'html'", () => {
    const bytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Not the CSV</body></html>");
    expect(classifyCanadaCidBody(bytes)).toBe("html");
  });
  it("classifies '<html>' HTML as 'html'", () => {
    const bytes = new TextEncoder().encode("<html><body>Error page</body></html>");
    expect(classifyCanadaCidBody(bytes)).toBe("html");
  });
  it("classifies empty body as 'empty'", () => {
    expect(classifyCanadaCidBody(new Uint8Array(0))).toBe("empty");
  });
});

describe("BI4F 2B — normalizers", () => {
  it("HS6 leading zeros preserved", () => {
    expect(normalizeHs6("090421")).toBe("090421");
    expect(normalizeHs6("90421")).toBe("090421");
    expect(normalizeHs6(90421)).toBe("090421");
    expect(normalizeHs6("")).toBeUndefined();
    expect(normalizeHs6("abc")).toBeUndefined();
  });
  it("company name drops English + French legal suffixes deterministically", () => {
    expect(normalizeCompanyName("Loblaw Companies Limited")).toBe("LOBLAW COMPANIES");
    expect(normalizeCompanyName("Loblaw Companies Ltée")).toBe("LOBLAW COMPANIES");
    expect(normalizeCompanyName("Sobeys Inc.")).toBe("SOBEYS");
    expect(normalizeCompanyName("Métro Inc.")).toBe("METRO");
  });
  it("Canadian province extraction (postal-code anchored + name dictionary)", () => {
    expect(extractCanadianProvince(undefined, "Brampton, ON L6Y 5S5")).toBe("ON");
    expect(extractCanadianProvince("100 rue Rachel Est, Montréal, QC H2W 1E7", undefined)).toBe("QC");
    expect(extractCanadianProvince(undefined, "Vancouver, British Columbia")).toBe("BC");
    expect(extractCanadianProvince(undefined, "Anywhere USA")).toBeUndefined();
  });
  it("CID country display name → ISO 3166-1 alpha-2", () => {
    expect(normalizeCidCountry("India")).toBe("IN");
    expect(normalizeCidCountry("United States")).toBe("US");
    expect(normalizeCidCountry("China")).toBe("CN");
    expect(normalizeCidCountry("Canada")).toBe("CA");
    expect(normalizeCidCountry("Not a Real Country")).toBeUndefined();
  });
});

describe("BI4F 2B — CSV parser (production-shape headers)", () => {
  it("parses a valid CSV, preserves HS6 leading zeros, normalizes country + province", () => {
    const parsed = parseCanadaCidCsv(cidCsvBytes([
      "090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "090421,LOBLAW COMPANIES LIMITED,China,Chine,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "080810,APPLE CANADA CORP.,United States,États-Unis,Ontario,Ontario,Toronto,M5V 3A8,2020",
    ]));
    expect(parsed.publishedPeriod).toBe("2020");
    expect(parsed.malformedRowCount).toBe(0);
    expect(parsed.rows).toEqual([
      { hs6: "090421", originCountry: "IN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton", postalCode: "L6Y 5S5" },
      { hs6: "090421", originCountry: "CN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton", postalCode: "L6Y 5S5" },
      { hs6: "080810", originCountry: "US", companyName: "APPLE CANADA CORP.", province: "ON", city: "Toronto", postalCode: "M5V 3A8" },
    ]);
  });

  it("handles commas-in-quoted-fields correctly (RFC 4180)", () => {
    const parsed = parseCanadaCidCsv(cidCsvBytes([
      "090421,\"JOANNE FISHER, MARK MCNUTT\",India,Inde,Ontario,Ontario,Dutton,N0L 1J0,2020",
    ]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].companyName).toBe("JOANNE FISHER, MARK MCNUTT");
  });

  it("handles CRLF line endings", () => {
    const csv = [CID_CSV_HEADER, "090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020"].join("\r\n");
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]);
    const parsed = parseCanadaCidCsv(bytes);
    expect(parsed.rows).toHaveLength(1);
  });

  it("counts malformed rows without abandoning valid data", () => {
    const parsed = parseCanadaCidCsv(cidCsvBytes([
      "090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "not-a-number,BAD ROW LTD,India,Inde,Ontario,Ontario,Toronto,,2020", // malformed HS
      "090421,ANOTHER BAD ROW,Nowhere,Aucune,Ontario,Ontario,Toronto,,2020", // unknown country
      "090421,,India,Inde,Ontario,Ontario,Toronto,,2020",                    // empty company
    ]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.malformedRowCount).toBe(3);
  });

  it("deduplicates identical (HS6, origin, normalized company) rows", () => {
    const parsed = parseCanadaCidCsv(cidCsvBytes([
      "090421,LOBLAW COMPANIES LIMITED,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
      "090421,Loblaw Companies Ltd,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020",
    ]));
    expect(parsed.rows).toHaveLength(1);
  });

  it("province as full English name is normalized to ISO 3166-2:CA code", () => {
    const parsed = parseCanadaCidCsv(cidCsvBytes([
      "090421,LOBLAW COMPANIES LIMITED,India,Inde,British Columbia,Colombie-Britannique,Vancouver,V6B 4Y8,2020",
    ]));
    expect(parsed.rows[0].province).toBe("BC");
  });

  it("throws CID_REQUIRED_HEADERS_MISSING when a required column is absent", () => {
    const bytes = new TextEncoder().encode("CompanyName,SomeOtherColumn\nX,Y\n");
    expect(() => parseCanadaCidCsv(bytes)).toThrow(CanadaCidParserError);
    try { parseCanadaCidCsv(bytes); } catch (e) {
      expect((e as CanadaCidParserError).code).toBe("CID_REQUIRED_HEADERS_MISSING");
    }
  });

  it("throws CID_SOURCE_HTML when the body is an HTML page", () => {
    const bytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Error</body></html>");
    try { parseCanadaCidCsv(bytes); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_SOURCE_HTML"); }
  });

  it("throws CID_XLSB_UNSUPPORTED when the body is a ZIP container (XLSX/XLSB)", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(20)]);
    try { parseCanadaCidCsv(bytes); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_XLSB_UNSUPPORTED"); }
  });

  it("throws CID_LEGACY_XLS_UNSUPPORTED when the body is a BIFF/OLE2 file", () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(20)]);
    try { parseCanadaCidCsv(bytes); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_LEGACY_XLS_UNSUPPORTED"); }
  });

  it("parseCanadaCidXlsx is a back-compat alias for parseCanadaCidCsv", () => {
    expect(parseCanadaCidXlsx).toBe(parseCanadaCidCsv);
  });
});

describe("BI4F 2B — low-level CSV row parser (RFC 4180)", () => {
  it("splits on commas, trims BOM, handles quoted fields", () => {
    const csv = "﻿a,b,\"c,d\"\ne,f,g\n";
    expect(parseCsvRows(csv)).toEqual([["a", "b", "c,d"], ["e", "f", "g"]]);
  });
  it("handles quoted quote escape (\"\")", () => {
    expect(parseCsvRows("\"a\"\"b\",c\n")).toEqual([["a\"b", "c"]]);
  });
  it("throws on unclosed quoted field", () => {
    expect(() => parseCsvRows("\"unclosed,quote\n")).toThrow(CanadaCidParserError);
  });
});

describe("BI4F 2B — matcher (deterministic, HS6-scoped, ISO2 origins)", () => {
  const rows: CanadaCidRow[] = [
    { hs6: "090421", originCountry: "IN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
    { hs6: "090421", originCountry: "CN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
    { hs6: "080810", originCountry: "US", companyName: "APPLE CANADA CORP.", province: "ON", city: "Toronto" },
  ];

  it("strong match: name + province → decision 'strong', both origins preserved", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies Limited", city: "Brampton, ON L6Y 5S5",
      targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("strong");
    expect(result.originCountries.sort()).toEqual(["CN", "IN"]);
  });
  it("ambiguous match: name without candidate province", () => {
    const result = matchCanadaCidCompany({ companyName: "Loblaw Companies", targetHs6: "090421", rows });
    expect(result.decision).toBe("ambiguous");
    expect(result.originCountries.sort()).toEqual(["CN", "IN"]);
  });
  it("rejected match: name matches but candidate province conflicts", () => {
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies", city: "Vancouver, BC V6B 4Y8",
      targetHs6: "090421", rows,
    });
    expect(result.decision).toBe("rejected");
  });
  it("no match for target HS6", () => {
    const result = matchCanadaCidCompany({ companyName: "Loblaw Companies", city: "Brampton, ON", targetHs6: "080810", rows });
    expect(result.decision).toBe("none");
  });
});

describe("BI4F 2B — evidence-join safety", () => {
  it("origins never leak across DIFFERENT companies", () => {
    const rows: CanadaCidRow[] = [
      { hs6: "090421", originCountry: "IN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON" },
      { hs6: "090421", originCountry: "CN", companyName: "METRO INC.", province: "QC" },
    ];
    const result = matchCanadaCidCompany({
      companyName: "Loblaw Companies", city: "Brampton, ON L6Y 5S5",
      targetHs6: "090421", rows,
    });
    expect(result.originCountries).toEqual(["IN"]);
  });
  it("HS6 scoping: a row for HS 080810 cannot corroborate an HS 090421 query", () => {
    const rows: CanadaCidRow[] = [
      { hs6: "080810", originCountry: "US", companyName: "LOBLAW COMPANIES LIMITED", province: "ON" },
    ];
    const result = matchCanadaCidCompany({ companyName: "Loblaw Companies", city: "Brampton, ON", targetHs6: "090421", rows });
    expect(result.decision).toBe("none");
    expect(result.originCountries).toHaveLength(0);
  });
});

describe("BI4F 2B — network fetch (bounded, conditional, safe)", () => {
  it("returns 'not_modified' on a 304 without downloading bytes", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    const result = await fetchCanadaCidByHs6ByCountry({
      year: 2020, etag: "\"v1\"", lastModified: "Wed, 25 Sep 2026 08:27:55 GMT", fetchImpl,
    });
    expect(result.outcome).toBe("not_modified");
    expect(result.bytes).toBeUndefined();
    expect(result.sourceUrl).toContain("cid-bdic-majorimportersbyhs6bycountry2020.csv");
  });

  it("returns SHA-256 material hash for a downloaded CSV payload", async () => {
    const bytes = cidCsvBytes(["090421,LOBLAW,India,Inde,Ontario,Ontario,Brampton,L6Y 5S5,2020"]);
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "text/csv", etag: "\"v2\"", "last-modified": "Fri, 26 Sep 2026 08:27:55 GMT" },
    })) as unknown as typeof fetch;
    const result = await fetchCanadaCidByHs6ByCountry({ year: 2020, fetchImpl });
    expect(result.outcome).toBe("downloaded");
    expect(result.materialHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies a transient 5xx as TRANSIENT_HTTP for retry-wait release", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream error", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchCanadaCidByHs6ByCountry({ year: 2020, fetchImpl }))
      .rejects.toMatchObject({ code: "TRANSIENT_HTTP", status: 502 });
  });

  it("rejects HTML at the fetch boundary (never reaches the parser)", async () => {
    const bytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Error</body></html>");
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    try { await fetchCanadaCidByHs6ByCountry({ year: 2020, fetchImpl }); expect.fail("should have thrown"); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_SOURCE_HTML"); }
  });

  it("rejects XLSB/XLSX at the fetch boundary (never reaches the parser)", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(20)]);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200, headers: { "content-type": "application/vnd.ms-excel" } })) as unknown as typeof fetch;
    try { await fetchCanadaCidByHs6ByCountry({ year: 2020, fetchImpl }); expect.fail("should have thrown"); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_XLSB_UNSUPPORTED"); }
  });

  it("rejects oversized payload declared via content-length", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(0), {
      status: 200, headers: { "content-length": String(200 * 1024 * 1024) },
    })) as unknown as typeof fetch;
    try { await fetchCanadaCidByHs6ByCountry({ year: 2020, fetchImpl }); expect.fail(); }
    catch (e) { expect((e as CanadaCidParserError).code).toBe("CID_OVERSIZE"); }
  });
});

describe("BI4F 2B — legitimacy doc is present", () => {
  const doc = readFileSync(path.resolve(REPO_ROOT, LEGITIMACY_DOC_PATH), "utf8");
  it("names publisher (ISED) and source (CBSA)", () => {
    expect(doc).toMatch(/Innovation, Science and Economic Development Canada/i);
    expect(doc).toMatch(/Canada Border Services Agency/i);
  });
  it("names OGL Canada v2.0 and captures the verbatim attribution string", () => {
    expect(doc).toMatch(/Open Government Licence [–-] Canada, v2\.0/);
    expect(doc).toMatch(/Contains information licensed under the Open Government Licence [–-] Canada\./);
  });
});
