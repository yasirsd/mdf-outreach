import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ThailandEvidencePanel } from "./ThailandEvidencePanel";
import { aggregateThailandResearch, resolveActiveThailandManualEvidence, THAILAND_PROVIDER_PLAN_V1 } from "@/lib/tradeResearch/thailand";

const WS = "11111111-1111-4111-8111-111111111111";
const CAND = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const JURISTIC = "0105560123456";

function dbdRow(status: "verified" | "not_found" | "inconclusive" = "verified") {
  return {
    id: "dbd-1", workspace_id: WS, candidate_id: CAND, provider_id: "thai-dbd",
    captured_at: "2026-10-02T00:00:00Z", captured_by_user_id: USER,
    source_url: "https://datawarehouse.dbd.go.th/profile", source_label: "DBD lookup",
    evidence_payload: { kind: "thai-dbd", juristicRegistrationNumber: JURISTIC, legalNameSnapshot: "บริษัท สยามสปิเซส จำกัด" },
    evidence_status: status, supersedes_id: null, lookup_basis: "juristic_number",
  } as Record<string, unknown>;
}

function textOf(container: HTMLElement): string {
  return container.textContent ?? "";
}

describe("TH06 — Thailand evidence panel", () => {
  it("10. displays company_shipment_activity = Unknown explicitly", () => {
    const agg = aggregateThailandResearch({ manual: { conflicts: [] } });
    const { container } = render(<ThailandEvidencePanel aggregate={agg} />);
    const text = textOf(container);
    expect(text).toContain("Company shipment activity");
    expect(text).toContain("Unknown");
  });

  it("7/8. India-origin row carries market-level caveat; never implies candidate imports from India", () => {
    const agg = aggregateThailandResearch({
      manual: { conflicts: [] },
      thaiCustomsStats: {
        status: "completed",
        marketImportActivity: "observed", indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
    });
    const { container } = render(<ThailandEvidencePanel aggregate={agg} />);
    const text = textOf(container);
    expect(text).toContain("India-origin market activity");
    expect(text).toContain("Never a candidate-level India-origin claim");
    expect(text).not.toContain("This company imports from India");
    expect(text).not.toMatch(/candidate imports from India/i);
  });

  it("25. overall `evidence_complete` label is NOT 'verified buyer'", () => {
    const manual = resolveActiveThailandManualEvidence({
      workspaceId: WS, candidateId: CAND,
      rows: [
        dbdRow("verified"),
        { ...dbdRow("verified"), id: "op", provider_id: "thai-customs-operator",
          evidence_payload: { kind: "thai-customs-operator", juristicRegistrationNumber: JURISTIC } },
        { ...dbdRow("verified"), id: "fda", provider_id: "thai-fda-importer",
          evidence_payload: { kind: "thai-fda-importer", juristicRegistrationNumber: JURISTIC, licenseNumberSnapshot: "L1" } },
      ],
    });
    const agg = aggregateThailandResearch({
      manual, candidateIdentity: { juristicRegistrationNumber: JURISTIC },
      thaiCustomsStats: {
        status: "completed",
        marketImportActivity: "observed", indiaOriginMarketActivity: "observed", productRelevance: "observed",
      },
      publicWebsite: {
        status: "completed", productSignalsObserved: true, identityMatchLevel: "strong",
        observedPublicEmails: ["info@x.co.th"], observedPublicPhones: [],
      },
    });
    const { container } = render(<ThailandEvidencePanel aggregate={agg} />);
    const text = textOf(container);
    expect(text).toContain("Evidence checks complete");
    expect(text).not.toMatch(/verified buyer/i);
    expect(text).not.toMatch(/strong buyer/i);
    expect(text).not.toMatch(/high.?quality buyer/i);
    expect(text).not.toMatch(/likely importer/i);
    expect(text).not.toMatch(/buyer probability/i);
    expect(text).not.toMatch(/AI confidence/i);
  });

  it("coverage group shows pending manual checks", () => {
    const agg = aggregateThailandResearch({ manual: { conflicts: [] } });
    const { container } = render(<ThailandEvidencePanel aggregate={agg} />);
    const text = textOf(container);
    expect(text).toContain("Pending manual checks");
    expect(text).toContain("thai-dbd");
    expect(text).toContain("thai-customs-operator");
    expect(text).toContain("thai-fda-importer");
  });

  it("TH06 Step 0 — Thailand automated plan still exactly 2 providers; manual providers absent from executor", () => {
    expect([...THAILAND_PROVIDER_PLAN_V1.automatedProviderIds]).toEqual(["thai-customs-stats", "public-website"]);
    expect([...THAILAND_PROVIDER_PLAN_V1.manualOnlyProviderIds].sort()).toEqual([
      "thai-customs-operator", "thai-dbd", "thai-fda-importer",
    ]);
  });
});
