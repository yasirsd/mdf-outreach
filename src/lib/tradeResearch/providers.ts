import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { PRODUCTS } from "@/lib/catalogue/products";
import { PRODUCT_TRADE_MAPPINGS } from "@/lib/marketIntelligence/product";
import {
  AUTOMATIC_SPEND_RUPEES,
  TRADE_RESEARCH_PLANNER_VERSION,
  type ProviderCostClass,
  type ProviderRole,
  type ResearchContext,
} from "./types";
import { THAILAND_PROVIDER_PLAN_VERSION } from "./thailand/versions";

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
  // TH04B Step 0 — `monthly` added for Thai Customs Data Catalog
  // which releases ctm_06_11 resources monthly. US / Canada
  // providers remain `quarterly` / `annual`; the shared type now
  // tolerates all three without perturbing existing descriptors.
  datasetCadence: "monthly" | "quarterly" | "annual";
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

/**
 * BI4F Phase 2B — Canadian Importers Database (CID).
 *
 * Publisher: Innovation, Science and Economic Development Canada
 * (ISED), based on CBSA import data.
 * Licence:   Open Government Licence – Canada, v2.0.
 * Semantics: company + HS product + origin country. NEVER shipment
 *            evidence — per-company quantity and value are explicitly
 *            suppressed. See `docs/bi4f-phase2b-canada-cid-legitimacy.md`
 *            for the full semantics matrix and confidentiality rules.
 *
 * READY FOR CONTROLLED PRODUCTION QA (scaffold-only).
 *
 * `costClass` is `"unsupported"` by default so `planTradeResearch`
 * refuses eligibility and no production traffic reaches this
 * descriptor. Turning `costClass` to `"free"` is a deliberate,
 * separately-reviewed action gated by the adapter implementation
 * phase — do not flip this without: (a) an adapter that fetches +
 * parses + matches Canada CID rows, (b) a widened
 * `TradeResearchResultSummary` capable of representing
 * `productEvidence` / `originEvidence` beyond the Phase 2A literals,
 * and (c) a controlled owner-only QA on a single Canadian candidate.
 */
/**
 * BI4F Phase 2B — the specific CID dataset year the worker consults.
 * Set to the latest ISED-published year the adapter has been
 * validated against. Bump this constant in a reviewed change once a
 * new CID year is fetched, parsed, and tested end-to-end. The worker
 * never probes speculative future URLs.
 */
/**
 * BI4F Phase 2B — the CID dataset year the worker consults. The
 * 2023 and 2024 releases publish only XLSB (unsupported here); the
 * 2022 CSV placeholder is empty on ISED. 2020 is the newest CID CSV
 * release that fits comfortably under `CANADA_CID_MAX_BYTES` (36 MB).
 * When ISED next releases a CID year as CSV under the 40 MB cap,
 * this constant may be bumped in a reviewed change.
 */
export const CANADA_CID_SUPPORTED_YEAR = 2020;

export const CANADA_CID_DESCRIPTOR: TradeResearchProviderDescriptor = {
  id: "canada-cid",
  displayName: "Canadian Importers Database",
  // v2 gates product/origin interpretation behind accepted company
  // identity. Historical v1 plan rows can therefore be identified for
  // later review/recomputation without mutating persisted result JSON.
  version: "canada-cid-v2",
  // BI4F Phase 2B final integration — adapter + worker dispatch +
  // per-provider snapshot lookup + gate flip all land in the same
  // reviewed change. Descriptor is planner-eligible for Canadian
  // candidates; the worker's provider-dispatch fetches the joined
  // `Major Importers by HS6, by country` resource, never composes a
  // company+origin claim from separate CID resources.
  costClass: "free",
  countries: ["CA"],
  roles: ["COMPANY_MATCH", "PRODUCT_SIGNAL", "ORIGIN_SIGNAL", "OFFICIAL_CORROBORATION"],
  automationAllowed: true,
  termsApproved: true,
  termsVersion: "ogl-canada-v2.0",
  datasetCadence: "annual",
  cacheMaxAgeDays: 365,
  compatiblePlannerVersions: [TRADE_RESEARCH_PLANNER_VERSION],
};

/**
 * BI4F Phase 2C — FDA VQIP as a second US free provider.
 *
 * VQIP is the FDA's voluntary US importer program with a public
 * fiscal-year participant list. Row-grain: (firm name, address,
 * email, website). Small universe (~10 rows). No product / origin /
 * shipment fields — VQIP corroborates COMPANY identity + FDA
 * program participation only.
 *
 * Kept gated at `costClass: "unsupported"` in the source registry
 * until the SAME reviewed change lands the adapter + worker branch
 * + multi-provider execution + aggregation model + UI. Flipping to
 * `"free"` while any prerequisite is missing would emit an
 * eligible plan the worker cannot execute.
 */
export const FDA_VQIP_DESCRIPTOR: TradeResearchProviderDescriptor = {
  id: "fda-vqip",
  displayName: "FDA VQIP",
  version: "fda-vqip-v1",
  costClass: "free",
  countries: ["US"],
  roles: ["COMPANY_MATCH", "OFFICIAL_CORROBORATION"],
  automationAllowed: true,
  termsApproved: true,
  termsVersion: "public-fda-list-v1",
  datasetCadence: "annual",
  cacheMaxAgeDays: 200,
  compatiblePlannerVersions: [TRADE_RESEARCH_PLANNER_VERSION],
};

/**
 * TH04A — Thai Customs Statistics provider descriptor.
 *
 * Market-level trade evidence for Thailand sourced from the
 * official Customs Data Catalog dataset `ctm_06_11` (Imports by
 * country of origin). The source is published by the Thai Customs
 * Department under the Open Data Common license with no access
 * conditions — ₹0 and ToS-compatible for an internal business
 * application.
 *
 * NEVER emits company-level evidence. Semantically distinct from
 * FSVP / VQIP / Canada CID which do candidate-name matching.
 */
export const THAI_CUSTOMS_STATS_DESCRIPTOR: TradeResearchProviderDescriptor = {
  id: "thai-customs-stats",
  displayName: "Thai Customs — Imports by Country of Origin",
  version: "thai-customs-stats-v1",
  costClass: "free",
  countries: ["TH"],
  roles: ["TRADE_ACTIVITY", "PRODUCT_SIGNAL", "ORIGIN_SIGNAL"],
  automationAllowed: true,
  termsApproved: true,
  termsVersion: "open-data-common-v1",
  // TH04B Step 0 — ctm_06_11 publishes monthly. The 45-day
  // `cacheMaxAgeDays` is INTENTIONALLY longer than the release
  // cadence: the executor's `selectLatestReleasedResource` always
  // reads the current catalog state, so a new monthly resource is
  // picked up by the first drain after it appears; the 45-day TTL
  // only prevents refetching an immutable past month.
  datasetCadence: "monthly",
  cacheMaxAgeDays: 45,
  // Thailand research contexts carry `providerPlanVersion =
  // THAILAND_PROVIDER_PLAN_VERSION` by TH02's canonicalization —
  // the TH descriptor must declare it compatible, or the planner
  // marks the descriptor `unsupported` on every TH candidate.
  compatiblePlannerVersions: [TRADE_RESEARCH_PLANNER_VERSION, THAILAND_PROVIDER_PLAN_VERSION],
};

/**
 * TH04B — Public-website trade-research descriptor (Thailand V1 only).
 *
 * This is the SECOND Thailand automated provider from
 * `THAILAND_PROVIDER_PLAN_V1`. It is additive — US / CA website
 * evidence continues through the existing Buyer Finder
 * free-enrichment path and the trade-research pipeline did not
 * previously have a public-website provider. `countries: ["TH"]`
 * keeps US / CA plans unchanged.
 */
export const PUBLIC_WEBSITE_DESCRIPTOR: TradeResearchProviderDescriptor = {
  id: "public-website",
  displayName: "Candidate Public Website",
  version: "public-website-v1",
  costClass: "free",
  countries: ["TH"],
  roles: ["COMPANY_MATCH", "PRODUCT_SIGNAL"],
  automationAllowed: true,
  termsApproved: true,
  termsVersion: "candidate-site-public-content-v1",
  datasetCadence: "monthly",
  cacheMaxAgeDays: 14,
  compatiblePlannerVersions: [TRADE_RESEARCH_PLANNER_VERSION, THAILAND_PROVIDER_PLAN_VERSION],
};

/**
 * Default descriptor registry — every production planner call site
 * should use this. Callers may still pass a custom `descriptors`
 * array in tests to isolate a single provider. Order is deterministic
 * and reflects planner sequence for multi-provider execution:
 *   US : FDA FSVP (sequence 1) → FDA VQIP (sequence 2)
 *   CA : Canada CID (sequence 3; only CA)
 *   TH : Thai Customs Stats (sequence 4; only TH)
 */
export const DEFAULT_TRADE_RESEARCH_DESCRIPTORS: readonly TradeResearchProviderDescriptor[] = [
  FDA_FSVP_DESCRIPTOR,
  FDA_VQIP_DESCRIPTOR,
  CANADA_CID_DESCRIPTOR,
  THAI_CUSTOMS_STATS_DESCRIPTOR,
  PUBLIC_WEBSITE_DESCRIPTOR,
];

/**
 * Canonical HS6 mapping for an MDF product. Returns the best-fit HS6
 * from `PRODUCT_TRADE_MAPPINGS` — preferring an exact mapping, then
 * a proxy, then a composite — plus the mapping kind so the caller
 * can honestly downgrade `productEvidence` from "verified" to
 * "supporting" when the HS grain is coarser than the target product.
 */
export function canonicalHs6ForProduct(productId: string | undefined): { hs6: string; kind: "exact" | "proxy" | "composite" } | undefined {
  if (!productId) return undefined;
  const mappings = PRODUCT_TRADE_MAPPINGS.filter((row) => row.mdfProductId === productId && row.hsLevel === 6);
  if (!mappings.length) return undefined;
  const exact = mappings.find((row) => row.mappingKind === "exact");
  if (exact) return { hs6: exact.hsCode, kind: "exact" };
  const proxy = mappings.slice().sort((a, b) => b.mappingConfidence - a.mappingConfidence).find((row) => row.mappingKind === "proxy");
  if (proxy) return { hs6: proxy.hsCode, kind: "proxy" };
  const composite = mappings.slice().sort((a, b) => b.mappingConfidence - a.mappingConfidence)[0]!;
  return { hs6: composite.hsCode, kind: "composite" };
}

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
  context: ResearchContext;
  hasFreshCache: boolean;
  descriptors?: readonly TradeResearchProviderDescriptor[];
}): PlannedProvider[] {
  const descriptors = input.descriptors ?? [FDA_FSVP_DESCRIPTOR];
  return descriptors.map((descriptor): PlannedProvider => {
    let reason: PlanDecisionReason = "eligible";
    if (!descriptor.compatiblePlannerVersions.includes(input.context.providerPlanVersion)) reason = "unsupported";
    else if (descriptor.costClass === "paid") reason = "paid";
    else if (descriptor.costClass === "manual_free") reason = "manual_only";
    else if (descriptor.costClass === "unsupported") reason = "unsupported";
    else if (descriptor.costClass === "free_quota") reason = "quota_unknown";
    else if (!descriptor.termsApproved) reason = "terms_unapproved";
    else if (!descriptor.countries.includes(input.context.marketCountryCode)) reason = "wrong_country";
    else if (input.context.researchGoal !== "screen_trade_activity") reason = "wrong_role";
    else if (!foodImportRelevant(input.candidate, input.context.productId)) reason = "not_food_import_relevant";
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
