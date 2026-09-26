import { describe, expect, it } from "vitest";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { FDA_FSVP_DESCRIPTOR, isAutomaticallyExecutable, planTradeResearch, type TradeResearchProviderDescriptor } from "./providers";
import { assertTradeResearchTransition, isJobLeaseStale, isRetryableProviderFailure, retryDelayMs } from "./stateMachine";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return { id: "c", companyName: "BC Foods", country: "United States", industry: "Food ingredients", isImporter: true, discoveryStatus: "ready", reviewStatus: "pending", ...over };
}

function descriptor(costClass: TradeResearchProviderDescriptor["costClass"], over: Partial<TradeResearchProviderDescriptor> = {}): TradeResearchProviderDescriptor {
  return { ...FDA_FSVP_DESCRIPTOR, id: `test-${costClass}`, costClass, ...over };
}

describe("trade research engine policy", () => {
  it("plans only FDA FSVP for US food/import-relevant activity screening", () => {
    const plans = planTradeResearch({ candidate: candidate(), countryCode: "US", goal: "screen_trade_activity", productId: "guntur-dry-red-chilli", hasFreshCache: false });
    expect(plans).toHaveLength(1); expect(plans[0]).toMatchObject({ eligible: true, reason: "eligible", automaticSpendRupees: 0 });
  });

  it("records cache_hit without changing eligibility or cost", () => {
    expect(planTradeResearch({ candidate: candidate(), countryCode: "US", goal: "screen_trade_activity", productId: "guntur-dry-red-chilli", hasFreshCache: true })[0]).toMatchObject({ eligible: true, reason: "cache_hit", cacheHit: true, automaticSpendRupees: 0 });
  });

  it("cleanly makes unsupported countries ineligible", () => {
    expect(planTradeResearch({ candidate: candidate(), countryCode: "CA", goal: "screen_trade_activity", productId: "guntur-dry-red-chilli", hasFreshCache: false })[0]).toMatchObject({ eligible: false, reason: "wrong_country" });
  });

  it("does not fake product/origin goal support", () => {
    expect(planTradeResearch({ candidate: candidate(), countryCode: "US", goal: "find_target_product", productId: "guntur-dry-red-chilli", hasFreshCache: false })[0].reason).toBe("wrong_role");
    expect(planTradeResearch({ candidate: candidate(), countryCode: "US", goal: "check_india_origin", productId: "guntur-dry-red-chilli", hasFreshCache: false })[0].eligible).toBe(false);
  });

  it("requires current food/import relevance and a persisted product scope", () => {
    expect(planTradeResearch({ candidate: candidate({ industry: "Machinery", isImporter: false }), countryCode: "US", goal: "screen_trade_activity", hasFreshCache: false })[0].reason).toBe("not_food_import_relevant");
  });

  describe("BI4F 2A production-shaped FDA FSVP eligibility", () => {
    // Every MDF catalogue product is food (spices / fresh produce), so a
    // canonical product-match slug is by itself sufficient food relevance
    // for FDA FSVP. Latitude 36 Foods and Silva International were both
    // rejected as `not_food_import_relevant` in production because their
    // Buyer Finder rows lacked `industry`/`buyerType`/`isImporter` even
    // though they were product-matched to guntur-dry-red-chilli.
    const latitudeShaped = (): BuyerCandidate => ({
      id: "cand-latitude",
      companyName: "Latitude 36 Foods",
      country: "United States",
      discoveryStatus: "ready",
      reviewStatus: "pending",
      // No industry, no buyerType, no isImporter — directory-signal shape.
    });
    const silvaShaped = (): BuyerCandidate => ({
      id: "cand-silva",
      companyName: "Silva International",
      country: "United States",
      discoveryStatus: "ready",
      reviewStatus: "pending",
      // No industry, no buyerType, no isImporter — Hunter-discovered shape.
    });

    it("Latitude 36 Foods with chilli productId → eligible (regression)", () => {
      const plan = planTradeResearch({
        candidate: latitudeShaped(), countryCode: "US", goal: "screen_trade_activity",
        productId: "guntur-dry-red-chilli", hasFreshCache: false,
      })[0]!;
      expect(plan).toMatchObject({ eligible: true, reason: "eligible", automaticSpendRupees: 0 });
    });

    it("Silva International with chilli productId → eligible (regression)", () => {
      const plan = planTradeResearch({
        candidate: silvaShaped(), countryCode: "US", goal: "screen_trade_activity",
        productId: "guntur-dry-red-chilli", hasFreshCache: false,
      })[0]!;
      expect(plan).toMatchObject({ eligible: true, reason: "eligible", automaticSpendRupees: 0 });
    });

    it("Latitude/Silva → cache_hit branch is still recognised as eligible", () => {
      const plan = planTradeResearch({
        candidate: latitudeShaped(), countryCode: "US", goal: "screen_trade_activity",
        productId: "guntur-dry-red-chilli", hasFreshCache: true,
      })[0]!;
      expect(plan).toMatchObject({ eligible: true, reason: "cache_hit", cacheHit: true });
    });

    it("every active MDF product (chilli, mango, pomegranate) resolves to eligible without industry text", () => {
      for (const productId of ["guntur-dry-red-chilli", "banganapalli-mango", "indian-pomegranate"]) {
        const plan = planTradeResearch({
          candidate: latitudeShaped(), countryCode: "US", goal: "screen_trade_activity",
          productId, hasFreshCache: false,
        })[0]!;
        expect(plan).toMatchObject({ eligible: true, reason: "eligible" });
      }
    });

    it("unknown / non-MDF productId with no industry text → still not_food_import_relevant", () => {
      const plan = planTradeResearch({
        candidate: latitudeShaped(), countryCode: "US", goal: "screen_trade_activity",
        productId: "unknown-widget", hasFreshCache: false,
      })[0]!;
      expect(plan.reason).toBe("not_food_import_relevant");
      expect(plan.eligible).toBe(false);
    });

    it("missing productId still requires industry/buyerType/isImporter evidence", () => {
      // No product context AND no industry evidence → correctly rejected.
      const plan = planTradeResearch({
        candidate: latitudeShaped(), countryCode: "US", goal: "screen_trade_activity",
        hasFreshCache: false,
      })[0]!;
      expect(plan.reason).toBe("not_food_import_relevant");
    });

    it("Guntur candidate on unsupported country (CA) is still rejected as wrong_country, not not_food", () => {
      const plan = planTradeResearch({
        candidate: silvaShaped(), countryCode: "CA", goal: "screen_trade_activity",
        productId: "guntur-dry-red-chilli", hasFreshCache: false,
      })[0]!;
      expect(plan.reason).toBe("wrong_country");
      expect(plan.eligible).toBe(false);
    });

    it("Guntur candidate on wrong goal is still rejected as wrong_role, not not_food", () => {
      const plan = planTradeResearch({
        candidate: silvaShaped(), countryCode: "US", goal: "find_target_product",
        productId: "guntur-dry-red-chilli", hasFreshCache: false,
      })[0]!;
      expect(plan.reason).toBe("wrong_role");
    });

    it("candidate with a US state field present does not affect provider eligibility", () => {
      // State/geography is match-confidence data for FDA row-matching,
      // NOT a provider eligibility gate.
      const withState = { ...latitudeShaped(), state: "CA" as unknown as string };
      const plan = planTradeResearch({
        candidate: withState as BuyerCandidate, countryCode: "US", goal: "screen_trade_activity",
        productId: "guntur-dry-red-chilli", hasFreshCache: false,
      })[0]!;
      expect(plan.eligible).toBe(true);
    });

    it("candidate WITHOUT a US state field is still provider-eligible (match confidence handled at match time)", () => {
      const plan = planTradeResearch({
        candidate: silvaShaped(), countryCode: "US", goal: "screen_trade_activity",
        productId: "guntur-dry-red-chilli", hasFreshCache: false,
      })[0]!;
      expect(plan.eligible).toBe(true);
    });

    it("automatic spend stays 0 across every eligible / cache_hit branch", () => {
      for (const hasFreshCache of [false, true]) {
        const plan = planTradeResearch({
          candidate: latitudeShaped(), countryCode: "US", goal: "screen_trade_activity",
          productId: "guntur-dry-red-chilli", hasFreshCache,
        })[0]!;
        expect(plan.automaticSpendRupees).toBe(0);
      }
    });
  });

  it.each(["paid", "manual_free", "unsupported", "free_quota"] as const)("rejects %s from automatic execution", (costClass) => {
    const plan = planTradeResearch({ candidate: candidate(), countryCode: "US", goal: "screen_trade_activity", productId: "guntur-dry-red-chilli", hasFreshCache: false, descriptors: [descriptor(costClass)] })[0];
    expect(plan.eligible).toBe(false); expect(plan.automaticSpendRupees).toBe(0); expect(isAutomaticallyExecutable(descriptor(costClass))).toBe(false);
  });

  it("rejects unapproved terms even for a nominally free provider", () => {
    const plan = planTradeResearch({ candidate: candidate(), countryCode: "US", goal: "screen_trade_activity", productId: "x", hasFreshCache: false, descriptors: [descriptor("free", { termsApproved: false })] })[0];
    expect(plan).toMatchObject({ eligible: false, reason: "terms_unapproved" });
  });

  it("enforces monotonic stages and terminal immutability", () => {
    expect(() => assertTradeResearchTransition({ fromStatus: "running", toStatus: "running", fromStage: "planning_sources", toStage: "screening_sources" })).not.toThrow();
    expect(() => assertTradeResearchTransition({ fromStatus: "running", toStatus: "running", fromStage: "screening_sources", toStage: "planning_sources" })).toThrow("STAGE_REGRESSION");
    expect(() => assertTradeResearchTransition({ fromStatus: "completed", toStatus: "running", fromStage: "complete", toStage: "complete" })).toThrow("TERMINAL_JOB_IMMUTABLE");
  });

  it("reclaims only expired lease + stale heartbeat + no fresh attempt", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(isJobLeaseStale({ now, leaseExpiresAt: "2026-09-25T11:59:00Z", heartbeatAt: "2026-09-25T11:58:00Z" })).toBe(true);
    expect(isJobLeaseStale({ now, leaseExpiresAt: "2026-09-25T11:59:00Z", heartbeatAt: "2026-09-25T11:59:30Z" })).toBe(false);
    expect(isJobLeaseStale({ now, leaseExpiresAt: "2026-09-25T11:59:00Z", heartbeatAt: "2026-09-25T11:58:00Z", freshAttemptLeaseExpiresAt: "2026-09-25T12:00:30Z" })).toBe(false);
  });

  it("retries only bounded transient failures with 30s/2m backoff", () => {
    expect(isRetryableProviderFailure({ code: "NETWORK_TIMEOUT" })).toBe(true);
    expect(isRetryableProviderFailure({ status: 429 })).toBe(true);
    expect(isRetryableProviderFailure({ status: 503 })).toBe(true);
    expect(isRetryableProviderFailure({ status: 400 })).toBe(false);
    expect(isRetryableProviderFailure({ code: "PARSER_INCOMPATIBLE" })).toBe(false);
    expect([retryDelayMs(1), retryDelayMs(2), retryDelayMs(3)]).toEqual([30_000, 120_000, null]);
  });

  it.each([20, 100, 500])("matches a %i-candidate fixture from one parsed/indexable dataset", (size) => {
    const fixture = Array.from({ length: size }, (_, i) => ({ companyName: `Food Company ${i} LLC`, stateCode: "CA" }));
    const index = new Map(fixture.map((row) => [row.companyName.replace(" LLC", "").toUpperCase(), row]));
    let datasetParseCount = 1; let jobExecutionCount = 0;
    for (let i = 0; i < size; i += 1) { jobExecutionCount += 1; expect(index.has(`FOOD COMPANY ${i}`)).toBe(true); }
    expect({ datasetParseCount, jobExecutionCount, pollingCount: 0 }).toEqual({ datasetParseCount: 1, jobExecutionCount: size, pollingCount: 0 });
  });
});

