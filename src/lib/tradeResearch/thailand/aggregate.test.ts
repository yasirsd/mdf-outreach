import { describe, expect, it } from "vitest";

import {
  THAILAND_AGGREGATE_CONTRACT_VERSION,
  aggregateThailandResearch,
  resolveActiveThailandManualEvidence,
  THAILAND_PROVIDER_PLAN_V1,
  type ThailandAggregateInput,
} from "./";

const WS = "11111111-1111-4111-8111-111111111111";
const CAND = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const JURISTIC = "0105560123456";

const strongIdentity = {
  juristicRegistrationNumber: JURISTIC,
  thaiLegalName: "บริษัท สยามสปิเซส จำกัด",
  englishLegalName: "Siam Spices Co., Ltd.",
};
const weakIdentity = { thaiLegalName: "บริษัท ก จำกัด" };

function dbdPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "thai-dbd",
    juristicRegistrationNumber: JURISTIC,
    legalNameSnapshot: "บริษัท สยามสปิเซส จำกัด",
    registeredAddressSnapshot: "123 Silom Rd Bangkok 10500",
    ...over,
  };
}
function operatorPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "thai-customs-operator",
    juristicRegistrationNumber: JURISTIC,
    operatorIdSnapshot: null,
    operatorTypeSnapshot: "importer",
    registrationStatusSnapshot: "active",
    ...over,
  };
}
function fdaPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "thai-fda-importer",
    juristicRegistrationNumber: JURISTIC,
    licenseNumberSnapshot: "FDA-123-ABC",
    licenseTypeSnapshot: "Food Importer",
    ...over,
  };
}

function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "root",
    workspace_id: WS,
    candidate_id: CAND,
    provider_id: "thai-dbd",
    captured_at: "2026-10-01T00:00:00Z",
    captured_by_user_id: USER,
    source_url: "https://datawarehouse.dbd.go.th/x",
    source_label: "DBD",
    evidence_payload: dbdPayload(),
    evidence_status: "verified",
    supersedes_id: null,
    lookup_basis: "juristic_number",
    ...over,
  };
}

function manual(dbd?: Record<string, unknown>, operator?: Record<string, unknown>, fda?: Record<string, unknown>) {
  const rows: Record<string, unknown>[] = [];
  if (dbd) rows.push({ ...row(), evidence_payload: dbdPayload(), ...dbd });
  if (operator) rows.push({ ...row({ provider_id: "thai-customs-operator", id: "op", evidence_payload: operatorPayload() }), ...operator });
  if (fda) rows.push({ ...row({ provider_id: "thai-fda-importer", id: "fda", evidence_payload: fdaPayload() }), ...fda });
  return resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
}

describe("TH05 Step 0A — active-evidence resolver (chain-leaf semantics)", () => {
  it("1. A→B makes B active, A historical", () => {
    const rows = [
      row({ id: "a", supersedes_id: null }),
      row({ id: "b", supersedes_id: "a" }),
    ];
    const r = resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
    expect(r.dbd?.id).toBe("b");
  });

  it("2. A→B→C makes C active, A/B historical", () => {
    const rows = [
      row({ id: "a", supersedes_id: null }),
      row({ id: "b", supersedes_id: "a" }),
      row({ id: "c", supersedes_id: "b" }),
    ];
    const r = resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
    expect(r.dbd?.id).toBe("c");
  });

  it("3. withdrawn current leaf → no active evidence", () => {
    const rows = [
      row({ id: "a", supersedes_id: null }),
      row({ id: "b", supersedes_id: "a", evidence_status: "withdrawn" }),
    ];
    const r = resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
    expect(r.dbd).toBeUndefined();
  });

  it("4/5. two children of A (fork) → surfaced as duplicate_active conflict (defense-in-depth)", () => {
    const rows = [
      row({ id: "a", supersedes_id: null }),
      row({ id: "b1", supersedes_id: "a" }),
      row({ id: "b2", supersedes_id: "a" }),
    ];
    const r = resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
    expect(r.dbd).toBeUndefined();
    expect(r.conflicts[0]?.reason).toBe("duplicate_active");
  });

  it("6. historical rows remain queryable (resolver reads them, just doesn't surface as active)", () => {
    const rows = [row({ id: "a", supersedes_id: null }), row({ id: "b", supersedes_id: "a" })];
    const r = resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
    expect(r.dbd?.id).toBe("b"); // query the data; resolver did not drop "a" from input
  });

  it("8. workspace isolation still holds", () => {
    const rows = [row({ id: "a", workspace_id: "99999999-9999-4999-8999-999999999999" })];
    const r = resolveActiveThailandManualEvidence({ workspaceId: WS, candidateId: CAND, rows });
    expect(r.dbd).toBeUndefined();
  });
});

describe("TH05 — aggregator", () => {
  function withManual(input: Partial<ThailandAggregateInput> = {}): ThailandAggregateInput {
    return {
      manual: input.manual ?? { conflicts: [] },
      ...input,
    };
  }

  it("9. verified DBD + strong identity → company_identity = verified", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual({ evidence_status: "verified", id: "dbd" }),
      candidateIdentity: strongIdentity,
    }));
    expect(agg.companyIdentity.value).toBe("verified");
    expect(agg.companyIdentity.provenance[0]?.manualEvidenceId).toBe("dbd");
  });

  it("10. verified DBD + weak identity → needs_review", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual({ evidence_status: "verified" }),
      candidateIdentity: weakIdentity,
    }));
    expect(agg.companyIdentity.value).toBe("needs_review");
  });

  it("11. website alone CANNOT verify identity (strong site match + no DBD → needs_review max)", () => {
    const agg = aggregateThailandResearch(withManual({
      publicWebsite: {
        status: "completed", productSignalsObserved: false, identityMatchLevel: "strong",
        observedPublicEmails: [], observedPublicPhones: [],
        parserVersion: "public-website-html-v2", interpretationVersion: "public-website-html-v2:t08-v1",
      },
    }));
    expect(agg.companyIdentity.value).toBe("needs_review");
  });

  it("12. Customs operator verified + strong identity → import_export_registration = registered", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual(undefined, { evidence_status: "verified" }),
      candidateIdentity: strongIdentity,
    }));
    expect(agg.importExportRegistration.value).toBe("registered");
  });

  it("13. website importer signal does NOT register operator", () => {
    const agg = aggregateThailandResearch(withManual({
      publicWebsite: {
        status: "completed", productSignalsObserved: true, identityMatchLevel: null,
        observedPublicEmails: [], observedPublicPhones: [],
      },
    }));
    expect(agg.importExportRegistration.value).toBe("unavailable");
  });

  it("14/15. FDA verified → licensed. FDA does NOT imply product/India/shipment", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual(undefined, undefined, { evidence_status: "verified" }),
      candidateIdentity: strongIdentity,
    }));
    expect(agg.foodImportLicense.value).toBe("licensed");
    expect(agg.indiaOriginMarketActivity.value).toBe("unknown");
    expect(agg.companyShipmentActivity.value).toBe("UNKNOWN");
    expect(agg.productRelevance.companyLevel.value).toBe("unknown");
  });

  it("16/17. Thai Customs HS + India rows → market observed + India observed", () => {
    const agg = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "completed",
        marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed",
        productRelevance: "observed",
      },
    }));
    expect(agg.marketImportActivity.value).toBe("observed");
    expect(agg.indiaOriginMarketActivity.value).toBe("observed");
    expect(agg.productRelevance.marketLevel.value).toBe("observed");
  });

  it("18. India-origin market activity does NOT become candidate India origin (grain stays market_product_origin)", () => {
    const agg = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "completed",
        marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed",
        productRelevance: "observed",
      },
    }));
    expect(agg.indiaOriginMarketActivity.provenance[0]?.grain).toBe("market_product_origin");
    expect(agg.companyShipmentActivity.value).toBe("UNKNOWN");
  });

  it("19. valid empty market → not_observed", () => {
    const agg = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "no_match",
        marketImportActivity: "not_observed",
        indiaOriginMarketActivity: "not_observed",
        productRelevance: "not_observed",
      },
    }));
    expect(agg.marketImportActivity.value).toBe("not_observed");
  });

  it("20/31. market provider failure → unknown (never not_observed)", () => {
    const agg = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "failed_retryable",
        marketImportActivity: "unknown",
        indiaOriginMarketActivity: "unknown",
        productRelevance: "unknown",
      },
    }));
    expect(agg.marketImportActivity.value).toBe("unknown");
    expect(agg.indiaOriginMarketActivity.value).toBe("unknown");
  });

  it("21/22/23. product_relevance preserves company vs market grain", () => {
    const agg = aggregateThailandResearch(withManual({
      publicWebsite: {
        status: "completed", productSignalsObserved: true, identityMatchLevel: null,
        observedPublicEmails: [], observedPublicPhones: [],
      },
      thaiCustomsStats: {
        status: "completed",
        marketImportActivity: "observed",
        indiaOriginMarketActivity: "not_observed",
        productRelevance: "observed",
      },
    }));
    expect(agg.productRelevance.companyLevel.value).toBe("observed");
    expect(agg.productRelevance.companyLevel.provenance[0]?.grain).toBe("company_site");
    expect(agg.productRelevance.marketLevel.value).toBe("observed");
    expect(agg.productRelevance.marketLevel.provenance[0]?.grain).toBe("market_product");
  });

  it("24. company_shipment_activity is ALWAYS UNKNOWN (type-pin + runtime guard)", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual({ evidence_status: "verified" }, { evidence_status: "verified" }, { evidence_status: "verified" }),
      candidateIdentity: strongIdentity,
      publicWebsite: {
        status: "completed", productSignalsObserved: true, identityMatchLevel: "exact",
        observedPublicEmails: ["info@x.co.th"], observedPublicPhones: [],
      },
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
    }));
    expect(agg.companyShipmentActivity.value).toBe("UNKNOWN");
  });

  it("25. public email → public_company_email; 26. phone-only → unavailable (Buyer conversion rule intact)", () => {
    const email = aggregateThailandResearch(withManual({
      publicWebsite: {
        status: "completed", productSignalsObserved: false, identityMatchLevel: null,
        observedPublicEmails: ["info@x.co.th"], observedPublicPhones: [],
      },
    }));
    expect(email.contactAvailability.value).toBe("public_company_email");

    const phoneOnly = aggregateThailandResearch(withManual({
      publicWebsite: {
        status: "completed", productSignalsObserved: false, identityMatchLevel: null,
        observedPublicEmails: [], observedPublicPhones: ["+6621234567"],
      },
    }));
    expect(phoneOnly.contactAvailability.value).toBe("unavailable");
  });

  it("27. absent manual evidence → unavailable (dimension) + manual_pending (coverage)", () => {
    const agg = aggregateThailandResearch(withManual({ manual: { conflicts: [] } }));
    expect(agg.companyIdentity.value).toBe("unavailable");
    expect(agg.importExportRegistration.value).toBe("unavailable");
    expect(agg.foodImportLicense.value).toBe("unavailable");
    expect([...agg.coverage.manualPending].sort()).toEqual(["thai-customs-operator", "thai-dbd", "thai-fda-importer"]);
  });

  it("28. manual not_found only becomes `not_found` with strong identity; otherwise unavailable", () => {
    const strong = aggregateThailandResearch(withManual({
      manual: manual(undefined, { evidence_status: "not_found" }),
      candidateIdentity: strongIdentity,
    }));
    expect(strong.importExportRegistration.value).toBe("not_found");

    const weak = aggregateThailandResearch(withManual({
      manual: manual(undefined, { evidence_status: "not_found" }),
      candidateIdentity: weakIdentity,
    }));
    expect(weak.importExportRegistration.value).toBe("unavailable");
  });

  it("29. identity contradiction → needs_review + conflict surfaced", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual({ evidence_status: "verified" }),
      candidateIdentity: strongIdentity,
      publicWebsite: {
        status: "completed", productSignalsObserved: false, identityMatchLevel: "possible",
        observedPublicEmails: [], observedPublicPhones: [],
        contradictsManualIdentity: true,
      },
    }));
    expect(agg.conflicts.find((c) => c.kind === "website_contradicts_manual")).toBeDefined();
  });

  it("30. duplicate active manual rows surfaced as conflicts (no silent pick)", () => {
    const dup = resolveActiveThailandManualEvidence({
      workspaceId: WS, candidateId: CAND,
      rows: [row({ id: "a" }), row({ id: "b" })],
    });
    const agg = aggregateThailandResearch(withManual({ manual: dup }));
    expect(agg.conflicts.find((c) => c.kind === "duplicate_active_manual")).toBeDefined();
  });

  it("32. coverage accurately reports missing manual evidence (manualPending list)", () => {
    const agg = aggregateThailandResearch(withManual({
      manual: manual({ evidence_status: "verified" }),
      candidateIdentity: strongIdentity,
    }));
    expect(agg.coverage.evaluated).toContain("thai-dbd");
    expect([...agg.coverage.manualPending].sort()).toEqual(["thai-customs-operator", "thai-fda-importer"]);
  });

  it("33. provenance retained per dimension (providerId + grain + explanation)", () => {
    const agg = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
    }));
    expect(agg.marketImportActivity.provenance[0]?.providerId).toBe("thai-customs-stats");
    expect(agg.marketImportActivity.provenance[0]?.grain).toBe("market_product");
  });

  it("34/35. Thailand automated plan still has exactly two providers; manual providers absent from executor plan", () => {
    expect([...THAILAND_PROVIDER_PLAN_V1.automatedProviderIds]).toEqual(["thai-customs-stats", "public-website"]);
    expect([...THAILAND_PROVIDER_PLAN_V1.manualOnlyProviderIds].sort()).toEqual([
      "thai-customs-operator", "thai-dbd", "thai-fda-importer",
    ]);
  });

  it("contract version is thailand-aggregate-v1", () => {
    expect(THAILAND_AGGREGATE_CONTRACT_VERSION).toBe("thailand-aggregate-v1");
  });

  it("structural limitations always include the hard caveats", () => {
    const agg = aggregateThailandResearch(withManual());
    expect(agg.limitations.some((l) => /company-level shipment/i.test(l))).toBe(true);
    expect(agg.limitations.some((l) => /Market-level/i.test(l))).toBe(true);
    expect(agg.limitations.some((l) => /Website-only identity/i.test(l))).toBe(true);
  });

  it("overallState reflects coverage: empty → no_evidence; partial → evidence_partial; complete → evidence_complete", () => {
    const none = aggregateThailandResearch(withManual());
    expect(none.overallState).toBe("no_evidence");

    const partial = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "not_observed", productRelevance: "observed",
      },
    }));
    expect(partial.overallState).toBe("evidence_partial");

    const full = aggregateThailandResearch(withManual({
      thaiCustomsStats: {
        status: "completed", marketImportActivity: "observed",
        indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
      publicWebsite: {
        status: "completed", productSignalsObserved: true, identityMatchLevel: "strong",
        observedPublicEmails: ["info@x.co.th"], observedPublicPhones: [],
      },
      manual: manual(
        { evidence_status: "verified" },
        { evidence_status: "verified" },
        { evidence_status: "verified" },
      ),
      candidateIdentity: strongIdentity,
    }));
    // Strong identity through DBD → company_identity verified; no
    // conflicts; everything evaluated. State is evidence_complete.
    expect(full.overallState).toBe("evidence_complete");
    expect(full.companyIdentity.value).toBe("verified");
  });
});
