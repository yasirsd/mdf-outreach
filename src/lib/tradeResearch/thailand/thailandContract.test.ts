import { describe, expect, it } from "vitest";

import {
  canonicalizeResearchContext,
  fingerprintResearchContext,
  resolveProviderPlanVersion,
} from "../context";
import {
  TRADE_RESEARCH_INTERPRETATION_VERSION,
  TRADE_RESEARCH_PLANNER_VERSION,
  type ResearchContext,
} from "../types";
import {
  emptyThailandEvidence,
  findThailandHsMapping,
  isThailandAutomatedProvider,
  ThailandEvidenceInvariants,
  THAI_CUSTOMS_STATS_INTERPRETATION_VERSION,
  THAI_CUSTOMS_STATS_PARSER_VERSION,
  THAILAND_AUTOMATED_PROVIDER_IDS,
  THAILAND_AUTOMATIC_SPEND_RUPEES,
  THAILAND_HS_MAPPINGS,
  THAILAND_MANUAL_ONLY_PROVIDER_IDS,
  THAILAND_PROVIDER_PLAN_V1,
  THAILAND_PROVIDER_PLAN_VERSION,
  type ThailandManualOnlyProviderId,
} from "./";
import { THAILAND_PROVIDER_PLAN_VERSION as VERSIONS_SOURCE } from "./versions";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";

function baseContext(over: Partial<ResearchContext> = {}): ResearchContext {
  return {
    workspaceId: WORKSPACE,
    candidateId: CANDIDATE,
    marketCountryCode: "TH",
    productId: "guntur-dry-red-chilli",
    productForm: null,
    researchGoal: "screen_trade_activity",
    providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
    ...over,
  };
}

describe("TH02 — Thailand research context", () => {
  it("1. TH canonical ResearchContext fingerprints deterministically", () => {
    const ctx = canonicalizeResearchContext(baseContext());
    const a = fingerprintResearchContext(ctx);
    const b = fingerprintResearchContext(ctx);
    expect(a).toMatch(/^trctx-v1:[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("2. US fingerprints byte-identical to pre-TH02 baseline (no market override applied)", () => {
    const us = canonicalizeResearchContext(baseContext({ marketCountryCode: "US" }));
    const fp = fingerprintResearchContext(us);
    // The US canonicalized providerPlanVersion is the shared constant,
    // NOT a Thailand-style override. This is the structural guarantee
    // that US fingerprints are byte-identical to pre-TH02 — the
    // canonicalization input shape to the sha256 is unchanged.
    expect(us.providerPlanVersion).toBe("trade-planner-v1");
    // Re-fingerprint is stable
    expect(fp).toBe(fingerprintResearchContext(us));
    // US ≠ TH on marketCountryCode alone
    expect(fp).not.toBe(fingerprintResearchContext(canonicalizeResearchContext(baseContext())));
    // Explicit caller-supplied value is still respected for US (the
    // resolver has no US override), so pre-TH02 callers that pass
    // "trade-planner-v1" see no change in the resulting fingerprint.
    const usExplicit = canonicalizeResearchContext(baseContext({
      marketCountryCode: "US",
      providerPlanVersion: "trade-planner-v1",
    }));
    expect(fingerprintResearchContext(usExplicit)).toBe(fp);
  });

  it("3. Canada fingerprints byte-identical to pre-TH02 baseline (no market override applied)", () => {
    const ca = canonicalizeResearchContext(baseContext({ marketCountryCode: "CA" }));
    const fp = fingerprintResearchContext(ca);
    expect(ca.providerPlanVersion).toBe("trade-planner-v1");
    expect(fp).toBe(fingerprintResearchContext(ca));
    expect(fp).not.toBe(fingerprintResearchContext(canonicalizeResearchContext(baseContext())));
    expect(fp).not.toBe(fingerprintResearchContext(canonicalizeResearchContext(baseContext({ marketCountryCode: "US" }))));
    const caExplicit = canonicalizeResearchContext(baseContext({
      marketCountryCode: "CA",
      providerPlanVersion: "trade-planner-v1",
    }));
    expect(fingerprintResearchContext(caExplicit)).toBe(fp);
  });
});

describe("TH03 Step 0 — single source of truth for the Thailand plan version", () => {
  it("resolveProviderPlanVersion('TH') === THAILAND_PROVIDER_PLAN_VERSION (same constant, not a duplicated literal)", () => {
    expect(resolveProviderPlanVersion("TH")).toBe(THAILAND_PROVIDER_PLAN_VERSION);
    // The constant exported from the public barrel must be the SAME
    // identity as the constant exported from the dependency-safe
    // `./versions` module.
    expect(THAILAND_PROVIDER_PLAN_VERSION).toBe(VERSIONS_SOURCE);
  });

  it("resolveProviderPlanVersion returns undefined for US/CA (no override)", () => {
    expect(resolveProviderPlanVersion("US")).toBeUndefined();
    expect(resolveProviderPlanVersion("CA")).toBeUndefined();
    expect(resolveProviderPlanVersion("us")).toBeUndefined();
    expect(resolveProviderPlanVersion("ca")).toBeUndefined();
  });

  it("resolveProviderPlanVersion returns thailand-provider-plan-v1 for TH (case-insensitive)", () => {
    expect(resolveProviderPlanVersion("TH")).toBe("thailand-provider-plan-v1");
    expect(resolveProviderPlanVersion("th")).toBe("thailand-provider-plan-v1");
    expect(resolveProviderPlanVersion("Th")).toBe("thailand-provider-plan-v1");
  });

  it("Thailand canonical context substitutes providerPlanVersion = thailand-provider-plan-v1", () => {
    // Even when the caller supplies the shared "trade-planner-v1" value
    // (as the current `serverResearchContext` does for every market),
    // the Thailand canonicalization substitutes the market-dictated version.
    const th = canonicalizeResearchContext(baseContext({
      marketCountryCode: "TH",
      providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION, // "trade-planner-v1"
    }));
    expect(th.providerPlanVersion).toBe("thailand-provider-plan-v1");
    expect(th.marketCountryCode).toBe("TH");
  });

  it("Thailand canonicalization is deterministic AND stable under caller-supplied planner version variation", () => {
    // Caller passed "trade-planner-v1"
    const a = canonicalizeResearchContext(baseContext({
      marketCountryCode: "TH",
      providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    }));
    // Caller passed the Thailand-specific plan directly
    const b = canonicalizeResearchContext(baseContext({
      marketCountryCode: "TH",
      providerPlanVersion: "thailand-provider-plan-v1",
    }));
    // Both canonicalize to the same effective value, so fingerprints match.
    expect(a.providerPlanVersion).toBe("thailand-provider-plan-v1");
    expect(b.providerPlanVersion).toBe("thailand-provider-plan-v1");
    expect(fingerprintResearchContext(a)).toBe(fingerprintResearchContext(b));
  });

  it("Thailand fingerprint changes when the market plan version would be bumped (verified via marketCountryCode difference)", () => {
    // US canonical plan version = "trade-planner-v1"; TH = "thailand-provider-plan-v1".
    // The two contexts differ ONLY in marketCountryCode but their
    // canonicalized providerPlanVersion also differs — fingerprints
    // must therefore differ.
    const us = canonicalizeResearchContext(baseContext({ marketCountryCode: "US" }));
    const th = canonicalizeResearchContext(baseContext({ marketCountryCode: "TH" }));
    expect(us.providerPlanVersion).toBe("trade-planner-v1");
    expect(th.providerPlanVersion).toBe("thailand-provider-plan-v1");
    expect(fingerprintResearchContext(us)).not.toBe(fingerprintResearchContext(th));
  });
});

describe("TH02 — Thailand provider plan", () => {
  it("4. TH provider plan contains exactly thai-customs-stats + public-website", () => {
    expect([...THAILAND_PROVIDER_PLAN_V1.automatedProviderIds]).toEqual([
      "thai-customs-stats",
      "public-website",
    ]);
    expect(THAILAND_PROVIDER_PLAN_V1.version).toBe(THAILAND_PROVIDER_PLAN_VERSION);
    expect(THAILAND_PROVIDER_PLAN_V1.marketCountryCode).toBe("TH");
    expect(THAILAND_PROVIDER_PLAN_V1.automaticSpendRupees).toBe(0);
    expect([...THAILAND_AUTOMATED_PROVIDER_IDS]).toEqual(["thai-customs-stats", "public-website"]);
  });

  it("5. MANUAL_ONLY providers are NOT in the executor plan", () => {
    for (const manual of THAILAND_MANUAL_ONLY_PROVIDER_IDS) {
      expect(THAILAND_PROVIDER_PLAN_V1.automatedProviderIds).not.toContain(manual as never);
      expect(isThailandAutomatedProvider(manual as unknown as string)).toBe(false);
    }
    // Positive controls — the automated set IS automated.
    for (const auto of THAILAND_AUTOMATED_PROVIDER_IDS) {
      expect(isThailandAutomatedProvider(auto)).toBe(true);
    }
    // All three MANUAL_ONLY ids match the audited set from TH01.
    const expectedManual: ThailandManualOnlyProviderId[] = [
      "thai-dbd",
      "thai-customs-operator",
      "thai-fda-importer",
    ];
    expect([...THAILAND_MANUAL_ONLY_PROVIDER_IDS].sort()).toEqual(expectedManual.sort());
  });
});

describe("TH02 — Thailand evidence invariants", () => {
  it("6. Thailand company_shipment_activity defaults UNKNOWN", () => {
    const ev = emptyThailandEvidence();
    expect(ev.company_shipment_activity).toBe("UNKNOWN");
    expect(ThailandEvidenceInvariants.companyShipmentIsUnknown(ev)).toBe(true);
  });

  it("7. Market India-origin evidence cannot promote company India-origin / shipment", () => {
    // Even when market_india_origin says "observed", company_shipment stays UNKNOWN.
    const ev = { ...emptyThailandEvidence(), india_origin_market_activity: "observed" as const };
    expect(ev.company_shipment_activity).toBe("UNKNOWN");
    expect(
      ThailandEvidenceInvariants.marketIndiaOriginDoesNotPromoteCompany(
        ev.india_origin_market_activity,
        ev.company_shipment_activity,
      ),
    ).toBe(true);
    // A hypothetical caller that tried to promote to "verified" would
    // break the type (ThaiCompanyShipmentActivity = "UNKNOWN" only),
    // so the invariant is also enforced at compile time.
  });

  it("8. Provider failure does not become negative evidence (dimension stays neutral)", () => {
    // unknown → unknown is safe; unknown → not_found is NOT (that
    // would be a negative claim after a failure).
    expect(ThailandEvidenceInvariants.providerFailureStaysNeutral("unknown", "unknown")).toBe(true);
    expect(ThailandEvidenceInvariants.providerFailureStaysNeutral("UNKNOWN", "UNKNOWN")).toBe(true);
    expect(ThailandEvidenceInvariants.providerFailureStaysNeutral("unavailable", "unavailable")).toBe(true);
    // The forbidden transition:
    expect(ThailandEvidenceInvariants.providerFailureStaysNeutral("unknown", "not_found")).toBe(false);
    // Missing manual evidence stays unavailable:
    expect(ThailandEvidenceInvariants.missingManualEvidenceStaysUnavailable("unavailable", "unavailable")).toBe(true);
    expect(ThailandEvidenceInvariants.missingManualEvidenceStaysUnavailable("unavailable", "not_found")).toBe(false);
  });
});

describe("TH02 — Thailand HS mapping", () => {
  it("9. TH HS mapping allows semantic 090421 with configurable Thai query codes", () => {
    const mapping = findThailandHsMapping("guntur-dry-red-chilli", null);
    expect(mapping).toBeDefined();
    expect(mapping!.semanticHs6).toBe("090421");
    // TH04A populated the Thai 8-digit verified code from the Thai
    // Customs Data Catalog dataset `ctm_06_11`. `09042190` is
    // intentionally NOT activated in V1.
    expect(mapping!.thaiQueryCodes).toEqual(["09042110"]);
    // The mapping is pure config — the module exports an array of them,
    // so adding a product form or Thai query codes is a data change.
    expect(THAILAND_HS_MAPPINGS.length).toBeGreaterThan(0);
  });

  it("HS mapping absent for unmapped product returns undefined (no fabrication)", () => {
    expect(findThailandHsMapping("non-existent-product-id", null)).toBeUndefined();
  });
});

describe("TH02 — Thailand plan automatic spend", () => {
  it("10. Automatic cost for Thailand provider plan = ₹0", () => {
    expect(THAILAND_AUTOMATIC_SPEND_RUPEES).toBe(0);
    expect(THAILAND_PROVIDER_PLAN_V1.automaticSpendRupees).toBe(0);
  });
});

describe("TH02 — Thailand parser / interpretation versions", () => {
  it("locks the thai-customs-stats parser version", () => {
    expect(THAI_CUSTOMS_STATS_PARSER_VERSION).toBe("thai-customs-stats-csv-v1");
  });

  it("locks the thai-customs-stats interpretation version anchored to the parser", () => {
    expect(THAI_CUSTOMS_STATS_INTERPRETATION_VERSION).toBe("thai-customs-stats-csv-v1:t08-v1");
    // The parser-anchored contract is REQUIRED by T12 v2 (migration 0033):
    // provider evidence.interpretationVersion must start with `${parserVersion}:`.
    expect(THAI_CUSTOMS_STATS_INTERPRETATION_VERSION.startsWith(THAI_CUSTOMS_STATS_PARSER_VERSION)).toBe(true);
  });
});
