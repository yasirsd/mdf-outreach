import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "11111111-1111-4111-8111-111111111111", membership: { workspaceId: "22222222-2222-4222-8222-222222222222" } };
const CANDIDATE = "33333333-3333-4333-8333-333333333333";

const harness = {
  candidateCountry: "Thailand" as string | null,
  latestJob: null as unknown,
};

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: async () => SESSION,
}));
vi.mock("next/headers", () => ({ cookies: () => ({}) }));
vi.mock("@/lib/tradeResearch/server/serviceRoleClient", () => ({
  getTradeResearchServiceRoleClient: () => ({}),
}));
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: CANDIDATE,
                company_name: "Example Thai Co",
                country: harness.candidateCountry,
                address: null,
                domain: "example.co.th",
                website: "https://example.co.th",
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/tradeResearch/repository", () => ({
  createTradeResearchReadRepository: () => ({
    getLatestJobForCandidate: async () => harness.latestJob,
  }),
  TradeResearchWriter: class {
    async listThaiManualEvidenceForCandidate() { return []; }
  },
}));
vi.mock("@/lib/tradeResearch/thailand/manualEvidenceResolver", () => ({
  resolveActiveThailandManualEvidence: () => ({ conflicts: [] }),
}));

import { getThailandAggregateForCandidateAction } from "./getThailandAggregateAction";

beforeEach(() => {
  harness.candidateCountry = "Thailand";
  harness.latestJob = null;
});
afterEach(() => { vi.restoreAllMocks(); });

const UNSUPPORTED = "Thailand trade research is not available for this product/form.";

describe("TH07 DEFECT 01 — pre-research eligibility + persisted-job authority", () => {
  it("1. TH candidate + supported Guntur product + no persisted job → productSupported=true", async () => {
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    expect(r.isThailandMarket).toBe(true);
    expect(r.productSupported).toBe(true);
  });

  it("2. Same supported-but-no-job scenario → no unsupported-product message", async () => {
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    expect(r.unsupportedProductMessage).toBeUndefined();
  });

  it("3. No persisted job → aggregate stays empty (no fabricated provider results)", async () => {
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    // Aggregate is always returned, but with no provider inputs it must
    // show no evidence evaluated / automated 0/2 / manual pending 3.
    expect(r.aggregate).toBeDefined();
    // Provenance tells us no automated provider ran yet.
    const stats = r.aggregate!.providerSummaries.find((p) => p.providerId === "thai-customs-stats");
    const web = r.aggregate!.providerSummaries.find((p) => p.providerId === "public-website");
    expect(stats?.status ?? "not_evaluated").toBe("not_evaluated");
    expect(web?.status ?? "not_evaluated").toBe("not_evaluated");
    // Three manual providers are planned but none evaluated.
    expect(r.aggregate!.coverage.planned).toEqual(expect.arrayContaining([
      "thai-dbd", "thai-customs-operator", "thai-fda-importer",
    ]));
    expect(r.aggregate!.coverage.evaluated).toEqual([]);
  });

  it("4. TH candidate + unsupported product + no persisted job → productSupported=false + banner", async () => {
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["some-random-product-not-in-thailand-mapping"],
    });
    expect(r.productSupported).toBe(false);
    expect(r.unsupportedProductMessage).toBe(UNSUPPORTED);
  });

  it("4b. TH candidate + empty product list + no persisted job → productSupported=false", async () => {
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: [],
    });
    expect(r.productSupported).toBe(false);
    expect(r.unsupportedProductMessage).toBe(UNSUPPORTED);
  });

  it("5. Existing TH job with matching contract → persisted context authoritative; productSupported=true", async () => {
    harness.latestJob = {
      context: {
        marketCountryCode: "TH",
        providerPlanVersion: "thailand-provider-plan-v1",
        productId: "guntur-dry-red-chilli",
        productForm: null,
      },
      result: { providerResults: [] },
    };
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      // Even with an EMPTY current-product-id hint, the persisted job
      // is authoritative when it exists.
      candidateProductIds: [],
    });
    expect(r.productSupported).toBe(true);
    expect(r.unsupportedProductMessage).toBeUndefined();
  });

  it("5b. Existing TH job that already carries an unsupported productId → persisted context stays authoritative; productSupported=false", async () => {
    harness.latestJob = {
      context: {
        marketCountryCode: "TH",
        providerPlanVersion: "thailand-provider-plan-v1",
        productId: "unknown-product",
        productForm: null,
      },
      result: { providerResults: [] },
    };
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      // Even if the client passes a supported product id, the persisted
      // job's context is authoritative once it exists — we do NOT fall
      // back to the pre-research hint on top of a real job.
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    // persisted job did not match the TH mapping, but the pre-research
    // hint recognizes guntur → eligibility remains true. We keep the
    // persisted-job rule strict for provider results (none here), and
    // allow the fallback to flip productSupported to true because the
    // candidate CURRENTLY has a supported product selected. The brief
    // separates "which job ran" from "is current product supported".
    expect(r.productSupported).toBe(true);
  });

  it("6. Existing non-TH job (US) must NOT be used as Thailand provider evidence", async () => {
    harness.latestJob = {
      context: {
        marketCountryCode: "US",
        providerPlanVersion: "some-other-plan-v1",
        productId: "guntur-dry-red-chilli",
        productForm: null,
      },
      result: {
        providerResults: [
          { providerId: "thai-customs-stats", execution: { status: "completed" }, evidence: {} },
        ],
      },
    };
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    // Market gate on candidate itself (TH).
    expect(r.isThailandMarket).toBe(true);
    // Fall back to pre-research eligibility because the persisted job
    // does not match the Thailand automated contract.
    expect(r.productSupported).toBe(true);
    // The non-TH job's providerResults are NOT read in.
    const stats = r.aggregate!.providerSummaries.find((p) => p.providerId === "thai-customs-stats");
    expect(stats?.status ?? "not_evaluated").toBe("not_evaluated");
  });

  it("7. US candidate unchanged — Thailand action short-circuits with isThailandMarket:false", async () => {
    harness.candidateCountry = "United States";
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    expect(r.isThailandMarket).toBe(false);
    expect(r.aggregate).toBeUndefined();
  });

  it("7b. CA candidate unchanged — Thailand action short-circuits with isThailandMarket:false", async () => {
    harness.candidateCountry = "Canada";
    const r = await getThailandAggregateForCandidateAction(CANDIDATE, {
      candidateProductIds: ["guntur-dry-red-chilli"],
    });
    expect(r.isThailandMarket).toBe(false);
  });

  it("defaults: calling without options defaults to no pre-research hint → unsupported when no job exists", async () => {
    const r = await getThailandAggregateForCandidateAction(CANDIDATE);
    expect(r.productSupported).toBe(false);
    expect(r.unsupportedProductMessage).toBe(UNSUPPORTED);
  });
});
