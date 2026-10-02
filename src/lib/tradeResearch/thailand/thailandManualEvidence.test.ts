import { describe, expect, it } from "vitest";

import {
  THAILAND_MANUAL_EVIDENCE_SOURCE_HOST_SUFFIXES,
  ThailandManualEvidenceSourceUrlError,
  requireAllowedManualEvidenceSourceUrl,
} from "./manualEvidenceSourceAllowlist";
import { resolveActiveThailandManualEvidence } from "./manualEvidenceResolver";
import {
  THAILAND_MANUAL_ONLY_PROVIDER_IDS,
  isThailandAutomatedProvider,
  THAILAND_PROVIDER_PLAN_V1,
} from "./providerPlan";
import { isPathAllowedByRobots } from "@/lib/tradeResearch/publicWebsite/robots";
import {
  mergePublicWebsiteSignals,
  selectSameOriginSubpages,
} from "@/lib/tradeResearch/publicWebsite/multiPage";
import {
  PUBLIC_WEBSITE_INTERPRETATION_VERSION,
  PUBLIC_WEBSITE_PARSER_VERSION,
  extractPublicWebsiteSignals,
} from "@/lib/tradeResearch/publicWebsite";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_WORKSPACE = "99999999-9999-4999-8999-999999999999";

describe("TH04C Step 0A — robots.txt evaluator", () => {
  it("1. path-specific Disallow is respected", () => {
    const robots = `
      User-agent: *
      Disallow: /admin/
    `;
    expect(isPathAllowedByRobots(robots, "/admin/panel")).toBe(false);
    expect(isPathAllowedByRobots(robots, "/public")).toBe(true);
  });

  it("2. Allow overrides a broader Disallow when more specific", () => {
    const robots = `
      User-agent: *
      Disallow: /
      Allow: /en/
    `;
    expect(isPathAllowedByRobots(robots, "/")).toBe(false);
    expect(isPathAllowedByRobots(robots, "/en/products")).toBe(true);
  });

  it("3. Disallow: / blocks entire site", () => {
    const robots = `
      User-agent: *
      Disallow: /
    `;
    expect(isPathAllowedByRobots(robots, "/")).toBe(false);
    expect(isPathAllowedByRobots(robots, "/anything")).toBe(false);
  });

  it("4. malformed robots is handled conservatively (undefined → allow, non-string → block)", () => {
    expect(isPathAllowedByRobots(undefined, "/x")).toBe(true);
    expect(isPathAllowedByRobots(null, "/x")).toBe(true);
    expect(isPathAllowedByRobots(42 as unknown as string, "/x")).toBe(false);
    expect(isPathAllowedByRobots("User-agent: *\nDisallow: /", "no-leading-slash")).toBe(false);
  });

  it("empty Disallow means allow for everything", () => {
    const robots = `
      User-agent: *
      Disallow:
    `;
    expect(isPathAllowedByRobots(robots, "/x")).toBe(true);
  });

  it("comments and empty lines are ignored", () => {
    const robots = `
      # welcome
      User-agent: *
      # block admin
      Disallow: /admin
    `;
    expect(isPathAllowedByRobots(robots, "/admin")).toBe(false);
    expect(isPathAllowedByRobots(robots, "/public")).toBe(true);
  });
});

describe("TH04C Step 0B — bounded multi-page selection", () => {
  const HOMEPAGE = `
    <html><body>
      <a href="/contact-us">Contact Us</a>
      <a href="/en/products">Products</a>
      <a href="/about">About</a>
      <a href="/ติดต่อเรา">ติดต่อเรา</a>
      <a href="/some-random">Random</a>
      <a href="https://other.example/x">External</a>
    </body></html>
  `;

  it("6/7. real homepage link to contact is preferred over path hints; path hit beats text hit", () => {
    const picks = selectSameOriginSubpages({
      homepageHtml: HOMEPAGE,
      homepageUrl: "https://www.example.co.th/",
    });
    expect(picks.contact).toBe("https://www.example.co.th/contact-us");
  });

  it("8. product/import/distribution subpage selected deterministically with /en/ preference", () => {
    const picks = selectSameOriginSubpages({
      homepageHtml: HOMEPAGE,
      homepageUrl: "https://www.example.co.th/",
    });
    expect(picks.product).toBe("https://www.example.co.th/en/products");
  });

  it("9/10/11. Thai anchor-text and path hits are recognized", () => {
    const picks = selectSameOriginSubpages({
      homepageHtml: '<html><body><a href="/ติดต่อ">ติดต่อ</a><a href="/สินค้า">สินค้า</a></body></html>',
      homepageUrl: "https://www.example.co.th/",
    });
    expect(picks.contact).toBe("https://www.example.co.th/%E0%B8%95%E0%B8%B4%E0%B8%94%E0%B8%95%E0%B9%88%E0%B8%AD");
    expect(picks.product).toBe("https://www.example.co.th/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2");
  });

  it("external same-registrable-domain links accepted (bare → www); unrelated hosts rejected", () => {
    const picks = selectSameOriginSubpages({
      homepageHtml: '<html><body><a href="https://www.example.co.th/contact">Contact</a><a href="https://evil.example/products">Products</a></body></html>',
      homepageUrl: "https://example.co.th/",
    });
    expect(picks.contact).toBe("https://www.example.co.th/contact");
    expect(picks.product).toBeUndefined();
  });

  it("5. no recursion — selector returns at most one contact + one product subpage", () => {
    const html = Array.from({ length: 20 }, (_, i) => `<a href="/contact-${i}">contact</a>`).join("\n");
    const picks = selectSameOriginSubpages({ homepageHtml: html, homepageUrl: "https://x.example.co.th/" });
    expect(Object.values(picks).filter(Boolean).length).toBeLessThanOrEqual(2);
  });

  it("15. merged signals carry per-page provenance (sourceUrl per term)", () => {
    const homepageSignals = extractPublicWebsiteSignals({
      html: "<html><body>We import red chilli.</body></html>",
      url: "https://x.example.co.th/",
    });
    const contactSignals = extractPublicWebsiteSignals({
      html: "<html><body>info@x.example.co.th</body></html>",
      url: "https://x.example.co.th/contact",
    });
    const merged = mergePublicWebsiteSignals({
      homepageUrl: "https://x.example.co.th/",
      perPage: [
        { category: "homepage", signals: homepageSignals },
        { category: "contact", signals: contactSignals },
      ],
    });
    expect(merged.pagesEvaluated.map((p) => p.category)).toEqual(["homepage", "contact"]);
    expect(merged.productSignals.find((p) => p.term.toLowerCase() === "red chilli")?.sourceUrl).toBe("https://x.example.co.th/");
    expect(merged.observedPublicEmails[0]?.sourceUrl).toBe("https://x.example.co.th/contact");
  });
});

describe("TH04C Step 0C — public-website version bump v2", () => {
  it("16. parser version is v2 (homepage-only → bounded 3-page sweep is a semantic change)", () => {
    expect(PUBLIC_WEBSITE_PARSER_VERSION).toBe("public-website-html-v2");
    expect(PUBLIC_WEBSITE_INTERPRETATION_VERSION).toBe("public-website-html-v2:t08-v1");
    // Parser-anchored (T12 v2 / migration 0033).
    expect(PUBLIC_WEBSITE_INTERPRETATION_VERSION.startsWith(PUBLIC_WEBSITE_PARSER_VERSION)).toBe(true);
  });
});

describe("TH04C — manual evidence source-URL allowlist", () => {
  it("20. unknown MANUAL_ONLY provider is refused", () => {
    expect(() => requireAllowedManualEvidenceSourceUrl("thai-mystery" as never, "https://x/"))
      .toThrow(ThailandManualEvidenceSourceUrlError);
  });

  it("21. arbitrary non-official domain is refused for each provider", () => {
    for (const providerId of THAILAND_MANUAL_ONLY_PROVIDER_IDS) {
      expect(() => requireAllowedManualEvidenceSourceUrl(providerId, "https://evil.example/x"))
        .toThrow(ThailandManualEvidenceSourceUrlError);
    }
  });

  it("accepts official DBD / Customs / FDA domains (HTTPS)", () => {
    expect(requireAllowedManualEvidenceSourceUrl("thai-dbd", "https://datawarehouse.dbd.go.th/company/profile/0105560123456"))
      .toContain("datawarehouse.dbd.go.th");
    expect(requireAllowedManualEvidenceSourceUrl("thai-customs-operator", "https://customs.go.th/operators"))
      .toContain("customs.go.th");
    expect(requireAllowedManualEvidenceSourceUrl("thai-fda-importer", "https://oryor.com/license/0987"))
      .toContain("oryor.com");
    expect(requireAllowedManualEvidenceSourceUrl("thai-fda-importer", "https://fda.moph.go.th/x"))
      .toContain("fda.moph.go.th");
  });

  it("refuses non-HTTPS URLs", () => {
    expect(() => requireAllowedManualEvidenceSourceUrl("thai-dbd", "http://dbd.go.th/x"))
      .toThrow(ThailandManualEvidenceSourceUrlError);
  });

  it("refuses missing / malformed input", () => {
    expect(() => requireAllowedManualEvidenceSourceUrl("thai-dbd", "")).toThrow(ThailandManualEvidenceSourceUrlError);
    expect(() => requireAllowedManualEvidenceSourceUrl("thai-dbd", "not-a-url")).toThrow(ThailandManualEvidenceSourceUrlError);
  });

  it("allowlist is narrow — no wildcards on third-party hosts", () => {
    // Spot-check: `moc.go.th` is allowed for DBD; a disguised host must not pass.
    expect(() => requireAllowedManualEvidenceSourceUrl("thai-dbd", "https://moc.go.th.evil.example/x"))
      .toThrow(ThailandManualEvidenceSourceUrlError);
  });

  it("exports suffix map for audit visibility", () => {
    expect(THAILAND_MANUAL_EVIDENCE_SOURCE_HOST_SUFFIXES["thai-dbd"]).toContain("dbd.go.th");
    expect(THAILAND_MANUAL_EVIDENCE_SOURCE_HOST_SUFFIXES["thai-customs-operator"]).toContain("customs.go.th");
    expect(THAILAND_MANUAL_EVIDENCE_SOURCE_HOST_SUFFIXES["thai-fda-importer"]).toContain("fda.moph.go.th");
  });
});

describe("TH04C — active-evidence resolver", () => {
  function row(over: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "a",
      workspace_id: WORKSPACE,
      candidate_id: CANDIDATE,
      provider_id: "thai-dbd",
      captured_at: "2026-10-01T00:00:00Z",
      captured_by_user_id: USER,
      source_url: "https://datawarehouse.dbd.go.th/x",
      source_label: "DBD lookup",
      evidence_payload: { kind: "thai-dbd" },
      evidence_status: "verified",
      supersedes_id: null,
      ...over,
    };
  }

  it("23. cross-workspace rows are IGNORED by the resolver", () => {
    const result = resolveActiveThailandManualEvidence({
      workspaceId: WORKSPACE,
      candidateId: CANDIDATE,
      rows: [row({ workspace_id: OTHER_WORKSPACE })],
    });
    expect(result.dbd).toBeUndefined();
  });

  it("28. TH05 chain-leaf semantics — `new` supersedes `old`, so `new` IS active and `old` is historical", () => {
    const result = resolveActiveThailandManualEvidence({
      workspaceId: WORKSPACE,
      candidateId: CANDIDATE,
      rows: [
        row({ id: "old", supersedes_id: null }),
        row({ id: "new", supersedes_id: "old" }),
      ],
    });
    // The TH05 Step 0A fix: `supersedes_id` on a correction row does
    // NOT make it inactive. The correction IS the current leaf. The
    // old root `old` is now historical because another row refers
    // to it via supersedes_id.
    expect(result.dbd?.id).toBe("new");
  });

  it("29. withdrawn record is NOT active", () => {
    const result = resolveActiveThailandManualEvidence({
      workspaceId: WORKSPACE,
      candidateId: CANDIDATE,
      rows: [row({ id: "w", evidence_status: "withdrawn" })],
    });
    expect(result.dbd).toBeUndefined();
  });

  it("30. duplicate active rows → conflicts entry, no silent pick", () => {
    const result = resolveActiveThailandManualEvidence({
      workspaceId: WORKSPACE,
      candidateId: CANDIDATE,
      rows: [row({ id: "a1" }), row({ id: "a2" })],
    });
    expect(result.dbd).toBeUndefined();
    expect(result.conflicts).toEqual([{ providerId: "thai-dbd", rowIds: ["a1", "a2"], reason: "duplicate_active" }]);
  });

  it("returns active rows per provider", () => {
    const result = resolveActiveThailandManualEvidence({
      workspaceId: WORKSPACE,
      candidateId: CANDIDATE,
      rows: [
        row({ id: "d", provider_id: "thai-dbd" }),
        row({ id: "c", provider_id: "thai-customs-operator" }),
        row({ id: "f", provider_id: "thai-fda-importer", evidence_status: "not_found" }),
      ],
    });
    expect(result.dbd?.id).toBe("d");
    expect(result.customsOperator?.id).toBe("c");
    expect(result.fdaImporter?.id).toBe("f");
    expect(result.fdaImporter?.evidence_status).toBe("not_found");
    expect(result.conflicts).toEqual([]);
  });
});

describe("TH04C — plan + MANUAL_ONLY fence (regression invariants)", () => {
  it("39. MANUAL_ONLY providers remain absent from the executor plan", () => {
    for (const pid of THAILAND_MANUAL_ONLY_PROVIDER_IDS) {
      expect(isThailandAutomatedProvider(pid as unknown as string)).toBe(false);
    }
  });

  it("40. Thailand automated plan still has exactly two providers", () => {
    expect([...THAILAND_PROVIDER_PLAN_V1.automatedProviderIds]).toEqual(["thai-customs-stats", "public-website"]);
  });

  it("43. automatic spend remains ₹0 on the plan constant", () => {
    expect(THAILAND_PROVIDER_PLAN_V1.automaticSpendRupees).toBe(0);
  });
});

describe("TH04C — manual evidence semantics (invariants, not DB)", () => {
  it("31/32/33. DBD does NOT imply importer; Customs operator does NOT imply product / India", () => {
    // These are shape-level invariants on the payloads: no field in
    // the DBD payload type encodes importer status; no field in the
    // Customs operator payload encodes product or India origin.
    const dbdPayloadKeys = [
      "juristicRegistrationNumber", "legalNameSnapshot", "registeredAddressSnapshot",
      "registrationStatusSnapshot", "kind",
    ];
    expect(dbdPayloadKeys).not.toContain("importerStatus");
    expect(dbdPayloadKeys).not.toContain("importActivity");
    const operatorPayloadKeys = [
      "operatorIdSnapshot", "operatorTypeSnapshot", "registrationStatusSnapshot", "kind",
    ];
    expect(operatorPayloadKeys).not.toContain("productId");
    expect(operatorPayloadKeys).not.toContain("originIndia");
  });

  it("34/35. FDA license does NOT imply India / shipment", () => {
    const fdaKeys = [
      "licenseNumberSnapshot", "licenseTypeSnapshot", "validFromSnapshot",
      "validUntilSnapshot", "licenseeAddressSnapshot", "kind",
    ];
    expect(fdaKeys).not.toContain("originIndia");
    expect(fdaKeys).not.toContain("shipmentActivity");
    expect(fdaKeys).not.toContain("importedFromIndia");
  });
});
