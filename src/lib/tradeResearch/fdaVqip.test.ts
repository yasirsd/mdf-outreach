import { describe, expect, it, vi } from "vitest";

import {
  FDA_VQIP_ATTRIBUTION,
  FDA_VQIP_DATASET_ID,
  FDA_VQIP_PARSE_VERSION,
  FDA_VQIP_SOURCE_URL,
  FdaVqipParserError,
  fetchFdaVqipDataset,
  matchFdaVqipCompany,
  normalizeCompanyName,
  parseFdaVqipHtml,
} from "./fdaVqip";
import { FDA_VQIP_DESCRIPTOR, isAutomaticallyExecutable, planTradeResearch, DEFAULT_TRADE_RESEARCH_DESCRIPTORS } from "./providers";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";

function usCandidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    companyName: "LT Foods Americas",
    country: "United States",
    city: "Cypress, CA 90630",
    industry: "Food",
    isImporter: true,
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function caCandidate(): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000202",
    companyName: "Loblaw",
    country: "Canada",
    city: "Brampton, ON L6Y 5S5",
    industry: "Food",
    isImporter: true,
    discoveryStatus: "ready",
    reviewStatus: "pending",
  };
}

// Synthetic VQIP-shaped HTML page reflecting the actual production
// table structure verified 2026-09-27.
function vqipHtml(rows: Array<{ firm: string; addr: string }> = [
  { firm: "LT Foods Americas", addr: "11130 Warland Dr, <br>Cypress, CA 90630-5302 US" },
  { firm: "Costco Wholesale Corporation", addr: "999 Lake Dr, <br>Issaquah, WA 98027-8990 US" },
]): Uint8Array {
  const trs = rows.map((r) => `<tr><td>${r.firm}</td><td>${r.addr}</td><td><a href="mailto:x@x">x@x</a></td><td><a href="http://x/">x</a></td></tr>`).join("");
  const html = `<!DOCTYPE html><html><body>
  <p>This is the publicly available list of approved VQIP importers for the fiscal year 2026 (FY2026) Benefit Period (i.e., 10/1/2025 to 9/30/2026).</p>
  <table><thead><tr><th>Firm Name</th><th>Address</th><th>Email</th><th>Website</th></tr></thead><tbody>${trs}</tbody></table>
  </body></html>`;
  return new TextEncoder().encode(html);
}

describe("BI4F 2C — FDA VQIP adapter", () => {
  it("URL constant points to the live public list page", () => {
    expect(FDA_VQIP_SOURCE_URL).toContain("voluntary-qualified-importer-program-vqip");
    expect(FDA_VQIP_SOURCE_URL).toContain("public-list-approved-vqip-importers");
  });

  it("dataset id + attribution + parse version are stable", () => {
    expect(FDA_VQIP_DATASET_ID).toBe("fda-vqip-participant-list");
    expect(FDA_VQIP_PARSE_VERSION).toBe("fda-vqip-html-v1");
    expect(FDA_VQIP_ATTRIBUTION).toBe("Source: U.S. Food & Drug Administration — Public List of Approved VQIP Importers.");
  });

  it("parses a valid VQIP HTML table + extracts firm name, address, and US state", () => {
    const parsed = parseFdaVqipHtml(vqipHtml());
    expect(parsed.publishedPeriod).toContain("FY2026");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({
      firmName: "LT Foods Americas",
      stateCode: "CA",
      address: "11130 Warland Dr, Cypress, CA 90630-5302 US",
    });
    expect(parsed.rows[1].stateCode).toBe("WA");
    expect(parsed.malformedRowCount).toBe(0);
  });

  it("deduplicates identical firm rows", () => {
    const parsed = parseFdaVqipHtml(vqipHtml([
      { firm: "LT Foods Americas", addr: "111 Foo, Cypress, CA 90630 US" },
      { firm: "LT Foods Americas", addr: "222 Bar, Cypress, CA 90630 US" },
    ]));
    expect(parsed.rows).toHaveLength(1);
  });

  it("throws VQIP_SOURCE_HTML_MISSING_TABLE when the response is not the expected HTML page", () => {
    const bytes = new TextEncoder().encode("<html><body>Something else</body></html>");
    try { parseFdaVqipHtml(bytes); expect.fail("should throw"); }
    catch (e) { expect((e as FdaVqipParserError).code).toBe("VQIP_SOURCE_HTML_MISSING_TABLE"); }
  });

  it("throws VQIP_REQUIRED_HEADERS_MISSING when the table headers don't match", () => {
    const bytes = new TextEncoder().encode("<html><body><table><thead><tr><th>Foo</th><th>Bar</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table></body></html>");
    try { parseFdaVqipHtml(bytes); expect.fail("should throw"); }
    catch (e) { expect((e as FdaVqipParserError).code).toBe("VQIP_REQUIRED_HEADERS_MISSING"); }
  });

  it("throws VQIP_EMPTY on empty body", () => {
    try { parseFdaVqipHtml(new Uint8Array(0)); expect.fail(); }
    catch (e) { expect((e as FdaVqipParserError).code).toBe("VQIP_EMPTY"); }
  });

  it("company matcher: strong match (name + state)", () => {
    const rows = parseFdaVqipHtml(vqipHtml()).rows;
    const result = matchFdaVqipCompany({
      companyName: "LT Foods Americas", city: "Cypress, CA 90630",
      rows,
    });
    expect(result.decision).toBe("strong");
    expect(result.matchedRows[0].firmName).toBe("LT Foods Americas");
  });

  it("company matcher: ambiguous (name but no state)", () => {
    const rows = parseFdaVqipHtml(vqipHtml()).rows;
    const result = matchFdaVqipCompany({ companyName: "LT Foods Americas", rows });
    expect(result.decision).toBe("ambiguous");
  });

  it("company matcher: rejected (name matches but state conflicts)", () => {
    const rows = parseFdaVqipHtml(vqipHtml()).rows;
    const result = matchFdaVqipCompany({ companyName: "LT Foods Americas", city: "Fresno, CA — wait actually Miami, FL 33001", rows });
    // Candidate state = FL, VQIP row state = CA → rejected.
    expect(result.decision).toBe("rejected");
  });

  it("company matcher: none (no name match)", () => {
    const rows = parseFdaVqipHtml(vqipHtml()).rows;
    const result = matchFdaVqipCompany({ companyName: "Something Unrelated", city: "Anywhere, TX 78701", rows });
    expect(result.decision).toBe("none");
  });

  it("company name normalizer drops legal suffixes", () => {
    expect(normalizeCompanyName("LT Foods Americas Inc.")).toBe("LT FOODS AMERICAS");
    expect(normalizeCompanyName("Costco Wholesale Corporation")).toBe("COSTCO WHOLESALE");
  });

  it("fetch returns not_modified on 304", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    const r = await fetchFdaVqipDataset({ etag: "\"v1\"", fetchImpl });
    expect(r.outcome).toBe("not_modified");
  });

  it("fetch returns SHA-256 material hash on 200", async () => {
    const bytes = vqipHtml();
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200, headers: { "content-type": "text/html", etag: "\"v2\"" } })) as unknown as typeof fetch;
    const r = await fetchFdaVqipDataset({ fetchImpl });
    expect(r.outcome).toBe("downloaded");
    expect(r.materialHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fetch classifies 5xx as TRANSIENT_HTTP for retry-wait", async () => {
    const fetchImpl = vi.fn(async () => new Response("err", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchFdaVqipDataset({ fetchImpl })).rejects.toMatchObject({ code: "TRANSIENT_HTTP" });
  });
});

describe("BI4F 2C — planner routes FDA VQIP correctly", () => {
  it("US candidate + VQIP → eligible", () => {
    const [plan] = planTradeResearch({
      candidate: usCandidate(), countryCode: "US", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: [FDA_VQIP_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(true);
    expect(plan.reason).toBe("eligible");
    expect(plan.automaticSpendRupees).toBe(0);
  });

  it("CA candidate + VQIP → wrong_country", () => {
    const [plan] = planTradeResearch({
      candidate: caCandidate(), countryCode: "CA", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: [FDA_VQIP_DESCRIPTOR],
    });
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe("wrong_country");
  });

  it("US candidate + full default descriptors → FSVP + VQIP eligible, CID wrong_country", () => {
    const plans = planTradeResearch({
      candidate: usCandidate(), countryCode: "US", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligibleIds = plans.filter((p) => p.eligible).map((p) => p.descriptor.id);
    expect(eligibleIds.sort()).toEqual(["fda-fsvp", "fda-vqip"]);
    expect(plans.find((p) => p.descriptor.id === "canada-cid")!.reason).toBe("wrong_country");
  });

  it("CA candidate + full default descriptors → only CID eligible", () => {
    const plans = planTradeResearch({
      candidate: caCandidate(), countryCode: "CA", goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli", hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligibleIds = plans.filter((p) => p.eligible).map((p) => p.descriptor.id);
    expect(eligibleIds).toEqual(["canada-cid"]);
    expect(plans.find((p) => p.descriptor.id === "fda-fsvp")!.reason).toBe("wrong_country");
    expect(plans.find((p) => p.descriptor.id === "fda-vqip")!.reason).toBe("wrong_country");
  });

  it("FDA_VQIP_DESCRIPTOR is planner-eligible (costClass free, US only)", () => {
    expect(FDA_VQIP_DESCRIPTOR.costClass).toBe("free");
    expect(FDA_VQIP_DESCRIPTOR.countries).toEqual(["US"]);
    expect(FDA_VQIP_DESCRIPTOR.roles).toEqual(["COMPANY_MATCH", "OFFICIAL_CORROBORATION"]);
    expect(FDA_VQIP_DESCRIPTOR.roles).not.toContain("SHIPMENT_DETAIL");
    expect(FDA_VQIP_DESCRIPTOR.roles).not.toContain("PRODUCT_SIGNAL");
    expect(FDA_VQIP_DESCRIPTOR.roles).not.toContain("ORIGIN_SIGNAL");
    expect(isAutomaticallyExecutable(FDA_VQIP_DESCRIPTOR)).toBe(true);
  });

  it("VQIP descriptor NEVER supports product/origin/shipment (fields absent from source)", () => {
    expect(FDA_VQIP_DESCRIPTOR.roles).not.toContain("PRODUCT_SIGNAL");
    expect(FDA_VQIP_DESCRIPTOR.roles).not.toContain("ORIGIN_SIGNAL");
    expect(FDA_VQIP_DESCRIPTOR.roles).not.toContain("SHIPMENT_DETAIL");
  });
});
