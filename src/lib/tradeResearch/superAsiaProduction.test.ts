import { describe, expect, it } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  CANADA_CID_DESCRIPTOR,
  canonicalHs6ForProduct,
  DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
  FDA_FSVP_DESCRIPTOR,
  planTradeResearch,
} from "./providers";
import { findCountryByCode, codeForCountryName } from "@/lib/catalogue/countries";

/**
 * BI4F Phase 2B — Super Asia Foods production-shaped regression.
 *
 * The production candidate is displayed as:
 *   country: "Canada" (display name, stored form varies — page will
 *            show "Canada" whether the stored value is "Canada" or
 *            "CA"), product: "Guntur Dry Red Chilli".
 *
 * Under the current code with `CANADA_CID_DESCRIPTOR.costClass = "free"`
 * and `DEFAULT_TRADE_RESEARCH_DESCRIPTORS = [FDA, CID]`, a Canadian
 * candidate with the canonical `guntur-dry-red-chilli` productId MUST
 * yield exactly ONE eligible plan (Canada CID) and FDA must be
 * `wrong_country`. `automaticSpendRupees` MUST be 0.
 *
 * This regression fails LOUDLY if either:
 *   1. `costClass` is ever inadvertently rolled back to "unsupported".
 *   2. `DEFAULT_TRADE_RESEARCH_DESCRIPTORS` no longer includes CID.
 *   3. The country normalizer stops mapping "Canada" (display) to "CA".
 *   4. The HS mapping registry loses the guntur → 090421 (proxy) entry.
 */

function superAsia(countryText: string): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000900",
    companyName: "Super Asia Foods",
    country: countryText,
    city: "Mississauga, ON L5S 1L1",
    industry: "Food, Spices, Groceries",
    isImporter: true,
    discoveryStatus: "ready",
    reviewStatus: "pending",
  };
}

describe("BI4F 2B — Super Asia Foods (Canada, Guntur Dry Red Chilli) planner routing", () => {
  it("stored country 'Canada' normalizes to ISO code CA (as tradeResearchActions does)", () => {
    const displayForm = superAsia("Canada");
    const codeForm = superAsia("CA");
    for (const candidate of [displayForm, codeForm]) {
      const normalized = findCountryByCode(candidate.country)?.code ?? codeForCountryName(candidate.country);
      expect(normalized).toBe("CA");
    }
  });

  it("canonical HS6 for guntur-dry-red-chilli is 090421 with kind 'proxy' (never 'exact')", () => {
    expect(canonicalHs6ForProduct("guntur-dry-red-chilli")).toEqual({ hs6: "090421", kind: "proxy" });
  });

  it("DEFAULT_TRADE_RESEARCH_DESCRIPTORS includes BOTH FDA FSVP and Canada CID", () => {
    const ids = DEFAULT_TRADE_RESEARCH_DESCRIPTORS.map((d) => d.id);
    expect(ids).toContain("fda-fsvp");
    expect(ids).toContain("canada-cid");
  });

  it("CANADA_CID_DESCRIPTOR is planner-eligible (costClass free)", () => {
    expect(CANADA_CID_DESCRIPTOR.costClass).toBe("free");
    expect(CANADA_CID_DESCRIPTOR.countries).toEqual(["CA"]);
  });

  it("Super Asia + Guntur → exactly ONE eligible plan (Canada CID); FDA is wrong_country; automatic spend 0", () => {
    const plans = planTradeResearch({
      candidate: superAsia("Canada"),
      countryCode: "CA",
      goal: "screen_trade_activity",
      productId: "guntur-dry-red-chilli",
      hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligible = plans.filter((p) => p.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.descriptor.id).toBe("canada-cid");
    expect(eligible[0]!.reason).toBe("eligible");
    expect(eligible[0]!.automaticSpendRupees).toBe(0);
    const fdaPlan = plans.find((p) => p.descriptor.id === "fda-fsvp");
    expect(fdaPlan?.eligible).toBe(false);
    expect(fdaPlan?.reason).toBe("wrong_country");
  });

  it("Super Asia + NO productId (missing product-match row) → BOTH descriptors mark not_food_import_relevant", () => {
    // This is the production-shape reason for a sources_checked=0
    // outcome AFTER the deploy — the candidate had no
    // `buyer_candidate_product_matches` row, so tradeResearchActions
    // resolves `productId` to undefined, and the planner refuses to
    // guess HS. The candidate's `industry` text is ignored when
    // productId is missing.
    const plans = planTradeResearch({
      candidate: superAsia("Canada"),
      countryCode: "CA",
      goal: "screen_trade_activity",
      productId: undefined,
      hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    const eligible = plans.filter((p) => p.eligible);
    expect(eligible).toHaveLength(0);
    const canada = plans.find((p) => p.descriptor.id === "canada-cid")!;
    expect(canada.eligible).toBe(false);
    expect(canada.reason).toBe("not_food_import_relevant");
    const fda = plans.find((p) => p.descriptor.id === "fda-fsvp")!;
    expect(fda.eligible).toBe(false);
    // FDA is wrong_country first — a CA candidate never even reaches
    // the food-relevance check on the FDA descriptor.
    expect(fda.reason).toBe("wrong_country");
  });

  it("empty-string productId (batch stored '') is treated identically to undefined", () => {
    const plans = planTradeResearch({
      candidate: superAsia("Canada"),
      countryCode: "CA",
      goal: "screen_trade_activity",
      productId: "",
      hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    });
    expect(plans.every((p) => p.eligible === false)).toBe(true);
  });
});

describe("BI4F 2B — planner is deterministic across planner-version bumps (historical plans stay valid)", () => {
  it("same inputs → same eligibility + same reason on repeated calls (idempotent)", () => {
    const inputs = {
      candidate: superAsia("Canada"),
      countryCode: "CA",
      goal: "screen_trade_activity" as const,
      productId: "guntur-dry-red-chilli",
      hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    };
    const a = planTradeResearch(inputs);
    const b = planTradeResearch(inputs);
    expect(a).toEqual(b);
  });

  it("planner returns the SAME descriptor identity (id + version) each call — historical plan rows keyed by these will resolve consistently", () => {
    const inputs = {
      candidate: superAsia("Canada"),
      countryCode: "CA",
      goal: "screen_trade_activity" as const,
      productId: "guntur-dry-red-chilli",
      hasFreshCache: false,
      descriptors: DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
    };
    const plans = planTradeResearch(inputs);
    for (const plan of plans) {
      expect(typeof plan.descriptor.id).toBe("string");
      expect(typeof plan.descriptor.version).toBe("string");
    }
    // The FDA descriptor version is a stable string; the CID descriptor
    // version is likewise stable. Historical plan rows carry these
    // exact values and never need mutation on planner bumps.
    expect(FDA_FSVP_DESCRIPTOR.version).toBe("fda-fsvp-v1");
    expect(CANADA_CID_DESCRIPTOR.version).toBe("canada-cid-v2");
  });
});
