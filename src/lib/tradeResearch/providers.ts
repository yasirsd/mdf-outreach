import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { PRODUCTS } from "@/lib/catalogue/products";
import {
  AUTOMATIC_SPEND_RUPEES,
  TRADE_RESEARCH_PLANNER_VERSION,
  type ProviderCostClass,
  type ProviderRole,
  type TradeResearchGoal,
} from "./types";

/**
 * MDF's product catalogue is 100 % food (spices + fresh produce), so a
 * productId that resolves to a canonical catalogue slug is by itself
 * sufficient proof of food-import relevance for FDA FSVP screening.
 * The candidate's own `industry`/`buyerType`/`isImporter` fields are
 * treated as a fallback for the case where no product context is
 * available — never as a gate over an already-approved product match.
 */
const FOOD_CATALOGUE_PRODUCT_IDS: ReadonlySet<string> = new Set(
  PRODUCTS.map((product) => product.id),
);

export interface TradeResearchProviderDescriptor {
  id: string;
  displayName: string;
  version: string;
  costClass: ProviderCostClass;
  countries: readonly string[];
  roles: readonly ProviderRole[];
  automationAllowed: boolean;
  termsApproved: boolean;
  termsVersion: string;
  datasetCadence: "quarterly";
  cacheMaxAgeDays: number;
  compatiblePlannerVersions: readonly string[];
}

export const FDA_FSVP_DESCRIPTOR: TradeResearchProviderDescriptor = {
  id: "fda-fsvp",
  displayName: "FDA FSVP",
  version: "fda-fsvp-v1",
  costClass: "free",
  countries: ["US"],
  roles: ["COMPANY_MATCH", "OFFICIAL_CORROBORATION", "TRADE_ACTIVITY"],
  automationAllowed: true,
  termsApproved: true,
  termsVersion: "official-public-list-v1",
  datasetCadence: "quarterly",
  cacheMaxAgeDays: 100,
  compatiblePlannerVersions: [TRADE_RESEARCH_PLANNER_VERSION],
};

export type PlanDecisionReason =
  | "eligible" | "wrong_country" | "wrong_role" | "paid" | "manual_only"
  | "unsupported" | "quota_unknown" | "terms_unapproved" | "cache_hit"
  | "not_food_import_relevant";

export interface PlannedProvider {
  descriptor: TradeResearchProviderDescriptor;
  eligible: boolean;
  reason: PlanDecisionReason;
  role: "OFFICIAL_CORROBORATION";
  automaticSpendRupees: 0;
  cacheHit: boolean;
}

export function isAutomaticallyExecutable(descriptor: TradeResearchProviderDescriptor): boolean {
  if (!descriptor.automationAllowed || !descriptor.termsApproved) return false;
  if (descriptor.costClass === "free") return true;
  // A future free_quota descriptor needs a positive, authoritative quota
  // reservation. Phase 2A has no quota ledger, so it fails closed.
  return false;
}

/**
 * BI4F 2A fix — treat a canonical MDF product match as sufficient food
 * relevance for FDA FSVP eligibility. Buyer Finder discovers many
 * candidates via directory/Hunter signals that never populate
 * `industry`/`buyerType`/`isImporter` on the row; before this change
 * such candidates were rejected as `not_food_import_relevant` even when
 * they were already product-matched to a chilli, mango, or pomegranate
 * catalogue slug. That produced the Latitude / Silva production regression
 * where FDA FSVP was skipped and `sources_checked` stayed at 0.
 */
function foodImportRelevant(candidate: BuyerCandidate, productId?: string): boolean {
  if (productId && FOOD_CATALOGUE_PRODUCT_IDS.has(productId)) return true;
  if (!productId) return false;
  const text = [candidate.industry, candidate.buyerType].filter(Boolean).join(" ").toLowerCase();
  return candidate.isImporter === true || /food|spice|chilli|pepper|agri|grocery|ingredient|import/.test(text);
}

export function planTradeResearch(input: {
  candidate: BuyerCandidate;
  countryCode: string;
  goal: TradeResearchGoal;
  productId?: string;
  hasFreshCache: boolean;
  descriptors?: readonly TradeResearchProviderDescriptor[];
}): PlannedProvider[] {
  const descriptors = input.descriptors ?? [FDA_FSVP_DESCRIPTOR];
  return descriptors.map((descriptor): PlannedProvider => {
    let reason: PlanDecisionReason = "eligible";
    if (!descriptor.compatiblePlannerVersions.includes(TRADE_RESEARCH_PLANNER_VERSION)) reason = "unsupported";
    else if (descriptor.costClass === "paid") reason = "paid";
    else if (descriptor.costClass === "manual_free") reason = "manual_only";
    else if (descriptor.costClass === "unsupported") reason = "unsupported";
    else if (descriptor.costClass === "free_quota") reason = "quota_unknown";
    else if (!descriptor.termsApproved) reason = "terms_unapproved";
    else if (!descriptor.countries.includes(input.countryCode)) reason = "wrong_country";
    else if (input.goal !== "screen_trade_activity") reason = "wrong_role";
    else if (!foodImportRelevant(input.candidate, input.productId)) reason = "not_food_import_relevant";
    else if (input.hasFreshCache) reason = "cache_hit";
    return {
      descriptor,
      eligible: (reason === "eligible" || reason === "cache_hit") && isAutomaticallyExecutable(descriptor),
      reason,
      role: "OFFICIAL_CORROBORATION",
      automaticSpendRupees: AUTOMATIC_SPEND_RUPEES,
      cacheHit: reason === "cache_hit",
    };
  });
}

