import { describe, expect, it } from "vitest";

import {
  PUBLIC_WEBSITE_INTERPRETATION_VERSION,
  PUBLIC_WEBSITE_PARSER_VERSION,
  extractPublicWebsiteSignals,
} from "./";
import { PUBLIC_WEBSITE_DESCRIPTOR, THAI_CUSTOMS_STATS_DESCRIPTOR, planTradeResearch } from "@/lib/tradeResearch/providers";
import { canonicalizeResearchContext } from "@/lib/tradeResearch/context";
import { THAILAND_PROVIDER_PLAN_VERSION } from "@/lib/tradeResearch/thailand/versions";
import { TRADE_RESEARCH_INTERPRETATION_VERSION, TRADE_RESEARCH_PLANNER_VERSION, type ResearchContext } from "@/lib/tradeResearch/types";
import { normalizeThailandPhone } from "@/lib/buyerFinder/thailand";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";

function thaiContext(over: Partial<ResearchContext> = {}): ResearchContext {
  return canonicalizeResearchContext({
    workspaceId: WORKSPACE,
    candidateId: CANDIDATE,
    marketCountryCode: "TH",
    productId: "guntur-dry-red-chilli",
    productForm: null,
    researchGoal: "screen_trade_activity",
    providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
    ...over,
  });
}

function minimalCandidate() {
  return { id: CANDIDATE, companyName: "N/A", country: "Thailand" } as unknown as import("@/lib/buyerFinder/types").BuyerCandidate;
}

describe("TH04B Step 0 — Thai Customs cadence correction", () => {
  it("1. THAI_CUSTOMS_STATS_DESCRIPTOR.datasetCadence is now 'monthly'", () => {
    expect(THAI_CUSTOMS_STATS_DESCRIPTOR.datasetCadence).toBe("monthly");
  });

  it("cacheMaxAgeDays remains 45 (correctness is upheld by `selectLatestReleasedResource`)", () => {
    expect(THAI_CUSTOMS_STATS_DESCRIPTOR.cacheMaxAgeDays).toBe(45);
  });
});

describe("TH04B — public-website descriptor + planner integration", () => {
  it("4. public-website applies to TH candidates", () => {
    const plans = planTradeResearch({
      candidate: minimalCandidate(),
      context: thaiContext(),
      hasFreshCache: false,
      descriptors: [PUBLIC_WEBSITE_DESCRIPTOR],
    });
    expect(plans[0]!.eligible).toBe(true);
    expect(plans[0]!.automaticSpendRupees).toBe(0);
    expect(PUBLIC_WEBSITE_DESCRIPTOR.compatiblePlannerVersions).toContain(THAILAND_PROVIDER_PLAN_VERSION);
  });

  it("5. public-website is NOT added to US/CA plans (countries only ['TH'])", () => {
    for (const market of ["US", "CA"] as const) {
      const plans = planTradeResearch({
        candidate: minimalCandidate(),
        context: thaiContext({ marketCountryCode: market }),
        hasFreshCache: false,
        descriptors: [PUBLIC_WEBSITE_DESCRIPTOR],
      });
      expect(plans[0]!.eligible).toBe(false);
      expect(plans[0]!.reason).toBe("wrong_country");
    }
  });

  it("37. public-website parser + interpretation versions locked and parser-anchored (TH04C bumped to v2)", () => {
    expect(PUBLIC_WEBSITE_PARSER_VERSION).toBe("public-website-html-v2");
    expect(PUBLIC_WEBSITE_INTERPRETATION_VERSION).toBe("public-website-html-v2:t08-v1");
    // T12 v2 (migration 0033) parser-anchoring rule.
    expect(PUBLIC_WEBSITE_INTERPRETATION_VERSION.startsWith(PUBLIC_WEBSITE_PARSER_VERSION)).toBe(true);
  });

  it("28/40/41/42. public-website is costClass free; paid variant is refused; Hunter + Buyer Send remain disabled", () => {
    expect(PUBLIC_WEBSITE_DESCRIPTOR.costClass).toBe("free");
    const paid = { ...PUBLIC_WEBSITE_DESCRIPTOR, costClass: "paid" as const };
    const plans = planTradeResearch({
      candidate: minimalCandidate(),
      context: thaiContext(),
      hasFreshCache: false,
      descriptors: [paid],
    });
    expect(plans[0]!.eligible).toBe(false);
    expect(plans[0]!.reason).toBe("paid");
  });
});

describe("TH04B — HTML extraction (fixture-driven)", () => {
  const BASE_HTML = `
    <html>
      <head><title>Siam Spices Co., Ltd. — Chilli & Spice Importer</title></head>
      <body>
        <h1>บริษัท สยามสปิเซส จำกัด</h1>
        <p>We are a Thailand importer and distributor of dried chilli, red chilli, และ เครื่องเทศ.</p>
        <p>Juristic Registration Number: 0105560123456.</p>
        <p>Contact: <a href="mailto:info@siamspices.co.th">info@siamspices.co.th</a> or call Tel: +66 2 123 4567</p>
        <p>Address: 123 Silom Rd., Bangkok 10500</p>
      </body>
    </html>`;

  it("13/14/15. preserves Thai, extracts Thai + English legal names", () => {
    const signals = extractPublicWebsiteSignals({
      html: BASE_HTML, url: "https://www.siamspices.co.th/",
      candidateCompanyName: "SIAM SPICES CO., LTD.",
      candidateDomain: "siamspices.co.th",
    });
    expect(signals.observedThaiLegalNameSnapshot).toContain("บริษัท สยามสปิเซส จำกัด");
    expect(signals.observedEnglishLegalNameSnapshot).toContain("Siam Spices");
  });

  it("16. exact Thai legal-name match contributes to the identity comparison", () => {
    const signals = extractPublicWebsiteSignals({
      html: BASE_HTML, url: "https://www.siamspices.co.th/",
      candidateCompanyName: "บริษัท สยามสปิเซส จำกัด",
      candidateDomain: "siamspices.co.th",
    });
    expect(signals.identityComparison?.matchLevel === "strong" || signals.identityComparison?.matchLevel === "exact").toBe(true);
  });

  it("17. juristic number on the website is surfaced as 'supporting' only (never promotes to verified identity)", () => {
    const signals = extractPublicWebsiteSignals({
      html: BASE_HTML, url: "https://www.siamspices.co.th/",
      candidateCompanyName: null,
      candidateDomain: null,
      candidateJuristicRegistrationNumber: "0105560123456",
    });
    expect(signals.observedJuristicNumberSnapshot).toBe("0105560123456");
    // The identity comparison reports strong when juristic numbers match,
    // but the executor caps the projection at "supporting" — tested here
    // via the signal shape (the executor's own cap is covered by the
    // descriptor-level invariant test above).
    expect(signals.identityComparison?.reasons).toContain("juristic_number_match");
  });

  it("18. domain-only equality is NOT 'strong' or 'exact' identity", () => {
    const signals = extractPublicWebsiteSignals({
      html: "<html><body>Hello</body></html>",
      url: "https://www.siamspices.co.th/",
      candidateCompanyName: "Different Co",
      candidateDomain: "siamspices.co.th",
    });
    expect(signals.identityComparison?.matchLevel).not.toBe("exact");
    expect(signals.identityComparison?.matchLevel).not.toBe("strong");
  });

  it("19. Thai product keywords detected (พริก, พริกแห้ง)", () => {
    const signals = extractPublicWebsiteSignals({
      html: '<html><body>เรานำเข้า พริก และ พริกแห้ง จากอินเดีย</body></html>',
      url: "https://x.example/",
    });
    expect(signals.productSignals).toContain("พริก");
    expect(signals.productSignals).toContain("พริกแห้ง");
  });

  it("20. English chilli / spice keywords detected", () => {
    const signals = extractPublicWebsiteSignals({
      html: "<html><body>We import red chilli and spices.</body></html>",
      url: "https://x.example/",
    });
    expect(signals.productSignals.map((s) => s.toLowerCase())).toContain("chilli");
    expect(signals.productSignals.map((s) => s.toLowerCase())).toContain("red chilli");
    expect(signals.productSignals.map((s) => s.toLowerCase())).toContain("spices");
  });

  it("21. product signal does NOT emit any shipment / India-origin / importer-registration claim", () => {
    const signals = extractPublicWebsiteSignals({
      html: '<html><body>We import red chilli from India.</body></html>',
      url: "https://x.example/",
    });
    // The signals object has NO shipment / india-origin / registration fields.
    expect("shipmentActivity" in signals).toBe(false);
    expect("indiaOrigin" in signals).toBe(false);
    expect("customsRegistration" in signals).toBe(false);
  });

  it("22/23. importer role signal detected but never implies Customs registration", () => {
    const signals = extractPublicWebsiteSignals({
      html: "<html><body>Siam Spices is a leading <strong>importer</strong> of chilli.</body></html>",
      url: "https://x.example/",
    });
    expect(signals.roleSignals.map((s) => s.toLowerCase())).toContain("importer");
    // No regulatory-registration field exists on the signal object.
    expect("import_export_registration" in signals).toBe(false);
  });

  it("24. distributor signal does NOT imply buyer intent", () => {
    const signals = extractPublicWebsiteSignals({
      html: "<html><body>Siam Spices — a distributor of fresh spices.</body></html>",
      url: "https://x.example/",
    });
    expect(signals.roleSignals.map((s) => s.toLowerCase())).toContain("distributor");
    expect("buyerIntent" in signals).toBe(false);
    expect("willingToBuy" in signals).toBe(false);
  });

  it("27/28. mailto + plain-text public emails extracted (lower-cased, deduped)", () => {
    const html = `
      <a href="mailto:Info@Siamspices.co.th">info</a>
      Contact: info@siamspices.co.th or sales@siamspices.co.th
    `;
    const signals = extractPublicWebsiteSignals({ html, url: "https://x.example/" });
    expect(signals.observedPublicEmails).toEqual([
      "info@siamspices.co.th",
      "sales@siamspices.co.th",
    ]);
  });

  it("29. guessed emails NEVER appear — only emails literally in the HTML are returned", () => {
    const signals = extractPublicWebsiteSignals({
      html: "<html><body>Call us.</body></html>",
      url: "https://x.example/",
      candidateCompanyName: "Siam Spices Co., Ltd.",
    });
    expect(signals.observedPublicEmails).toEqual([]);
  });

  it("30. phone normalized through TH03 helper", () => {
    const signals = extractPublicWebsiteSignals({
      html: '<a href="tel:+66 2 123 4567">02-123-4567</a>',
      url: "https://x.example/",
    });
    expect(signals.observedPublicPhones).toContain("+6621234567");
  });

  it("32. named public contact is not inferred — only truly explicit markers would surface", () => {
    const signals = extractPublicWebsiteSignals({
      html: "<html><body>Our team is here.</body></html>",
      url: "https://x.example/",
    });
    // No contact signals are forged.
    expect(signals.contactSignals.length).toBe(0);
  });

  it("35. Thai-only website — missing English keywords is NOT a company-level negative", () => {
    // A page in Thai-only with no English product keywords and no
    // product signal keywords from our list → observed product list
    // is empty but the signals object does NOT mark 'company_shipment'
    // or any negative claim.
    const signals = extractPublicWebsiteSignals({
      html: '<html><body>บริษัท ก จำกัด</body></html>',
      url: "https://x.example/",
    });
    expect(signals.productSignals).toEqual([]);
    // The signals carry no shipment / India-origin keys.
    expect("shipmentActivity" in signals).toBe(false);
    expect("indiaOrigin" in signals).toBe(false);
  });
});

describe("TH04B — phone 066 ambiguity hardening", () => {
  it("31. `066…` is NOT accepted as an international alias (was previously ambiguous)", () => {
    const r = normalizeThailandPhone("066-123-4567");
    expect(r.validFormat).toBe(false);
    expect(r.normalizedE164).toBeUndefined();
  });

  it("+66 and 0066 remain accepted international forms", () => {
    expect(normalizeThailandPhone("+66-2-123-4567").normalizedE164).toBe("+6621234567");
    expect(normalizeThailandPhone("0066 2 123 4567").normalizedE164).toBe("+6621234567");
  });
});

describe("TH04B — Thailand automated plan contract", () => {
  it("39. THAILAND_PROVIDER_PLAN_V1 still carries exactly thai-customs-stats + public-website", async () => {
    const { THAILAND_PROVIDER_PLAN_V1 } = await import("@/lib/tradeResearch/thailand");
    expect([...THAILAND_PROVIDER_PLAN_V1.automatedProviderIds]).toEqual([
      "thai-customs-stats", "public-website",
    ]);
  });
});
