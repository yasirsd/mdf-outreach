export const AUTOMATIC_SPEND_RUPEES = 0 as const;
export const TRADE_RESEARCH_PLANNER_VERSION = "trade-planner-v1" as const;

export const TRADE_RESEARCH_STAGES = [
  "preparing_identity",
  "planning_sources",
  "screening_sources",
  "resolving_company_matches",
  "checking_trade_activity",
  "checking_product_evidence",
  "checking_origin_evidence",
  "performing_deep_lookup",
  "deduplicating_evidence",
  "classifying_evidence",
  "finalizing",
  "complete",
] as const;

export const PHASE_2A_STAGES = [
  "preparing_identity",
  "planning_sources",
  "screening_sources",
  "resolving_company_matches",
  "checking_trade_activity",
  "finalizing",
  "complete",
] as const;

export type TradeResearchStage = (typeof TRADE_RESEARCH_STAGES)[number];
export type Phase2AStage = (typeof PHASE_2A_STAGES)[number];
export type TradeResearchGoal = "screen_trade_activity" | "find_target_product" | "check_india_origin";
export type TradeResearchStatus =
  | "queued" | "running" | "cancel_requested" | "completed" | "partial"
  | "needs_review" | "failed" | "cancelled";
export type TradeResearchOutcome =
  | "trade_activity_only" | "official_importer_program_corroboration"
  | "no_verified_evidence" | "unsupported_coverage" | "needs_review"
  | "partial" | "failed" | "cancelled";

export type ProviderCostClass = "free" | "free_quota" | "manual_free" | "paid" | "unsupported";
export type ProviderRole =
  | "COMPANY_MATCH" | "OFFICIAL_CORROBORATION" | "TRADE_ACTIVITY"
  | "SHIPMENT_DETAIL" | "PRODUCT_SIGNAL" | "ORIGIN_SIGNAL" | "SUPPLIER_SIGNAL";

export interface TradeResearchBatchSnapshot {
  id: string;
  status: TradeResearchStatus;
  requestedGoal: TradeResearchGoal;
  totalJobs: number;
  queuedCount: number;
  runningCount: number;
  completedCount: number;
  partialCount: number;
  needsReviewCount: number;
  failedCount: number;
  cancelledCount: number;
  corroboratedCount: number;
  automaticSpendRupees: 0;
  createdAt: string;
  completedAt?: string;
}

export interface TradeResearchEvidenceDetail {
  source: "FDA FSVP" | "Canadian Importers Database" | "FDA VQIP";
  datasetPeriod: string;
  retrievedAt: string;
  matchedSourceName?: string;
  matchedState?: string;
  candidateName: string;
  candidateState?: string;
  identityDecision: "exact" | "strong" | "ambiguous" | "rejected" | "none";
  matchReason: string;
  coverageExplanation: string;
}

export type TradeResearchEvidenceLevel =
  | "verified"
  | "supporting"
  | "no_verified_match"
  | "needs_review"
  | "not_verified"
  | "not_available"
  | "not_checked";

export interface TradeResearchResultSummary {
  officialProgramEvidence: "verified" | "no_verified_match" | "needs_review" | "not_checked";
  /**
   * Company + product relationship at the grain the source actually
   * supports. FDA FSVP has no product grain so its output stays
   * `not_available`. Canada CID's "Major Importers by HS6, country"
   * legitimately joins company + HS6 in a single row and can set
   * `verified` (exact catalogue mapping) or `supporting` (proxy /
   * composite HS mapping) when the company appears.
   */
  productEvidence:
    | "verified"
    | "supporting"
    | "no_verified_match"
    | "not_available";
  /**
   * India-origin field. FDA FSVP does not surface origin, so its
   * payload stays `"not_verified"`. Canada CID may populate this to
   * `"verified"` or `"supporting"` when the matched company + target
   * HS6 rows in the CID dataset carry India as an origin country —
   * NEVER inferred from a separate market-level report.
   */
  indiaOrigin: "verified" | "supporting" | "not_verified";
  /**
   * Company + origin-country relationship at the grain the source
   * actually supports. Canada CID sets this only from the joined
   * "Major Importers by HS6, country" resource (per-company + HS6 +
   * origin). Product-by-country market aggregates are NEVER promoted
   * to a company-specific claim.
   */
  originEvidence:
    | "verified"
    | "supporting"
    | "no_verified_match"
    | "not_available"
    | "not_verified";
  /**
   * CID directory rows are not shipments; per-company quantity and
   * value are explicitly suppressed by CBSA. This field stays
   * `not_verified` for every current provider.
   */
  shipmentEvidence: "not_verified";
  sourcesChecked: number;
  automaticSpendRupees: 0;
  /**
   * Backwards-compatible singular evidence. For Phase 2A/2B rows
   * (single provider), this carries the primary provider's block.
   * For Phase 2C multi-source rows, this is the FIRST source in
   * `sources[]` — do NOT read as authoritative when multiple
   * providers are present.
   */
  evidence?: TradeResearchEvidenceDetail;
  /**
   * BI4F Phase 2C — per-source evidence array. Each entry is the
   * verbatim per-provider observation. Consumers MUST read this
   * array (not `evidence`) when it has more than one entry.
   */
  sources?: TradeResearchSourceEvidence[];
  /**
   * BI4F Phase 2C — deterministic multi-source aggregate. Never
   * overwrites per-source facts. May carry `"conflicting_source_evidence"`
   * when providers disagree on identity/geography.
   */
  aggregate?: TradeResearchAggregateSummary;
}

export interface TradeResearchSourceEvidence extends TradeResearchEvidenceDetail {
  providerId: "fda-fsvp" | "canada-cid" | "fda-vqip";
  outcome: "completed" | "cache_hit" | "no_match" | "provider_failed" | "not_evaluated";
  companyEvidence:
    | "verified"
    | "supporting"
    | "no_verified_match"
    | "not_available";
  productEvidence:
    | "verified"
    | "supporting"
    | "no_verified_match"
    | "not_available";
  originEvidence:
    | "verified"
    | "supporting"
    | "no_verified_match"
    | "not_available"
    | "not_verified";
  shipmentEvidence: "not_verified";
  attribution: string;
}

export interface TradeResearchAggregateSummary {
  identity:
    | "no_evidence"
    | "single_source_support"
    | "multi_source_support"
    | "verified_identity"
    | "conflicting_evidence"
    | "needs_review";
  reason: string;
  sourcesEvaluated: number;
  sourcesCorroborating: number;
}

export interface TradeResearchJobSnapshot {
  id: string;
  batchId: string;
  candidateId: string;
  productId?: string;
  countryCode: string;
  requestedGoal: TradeResearchGoal;
  status: TradeResearchStatus;
  stage: TradeResearchStage;
  outcome?: TradeResearchOutcome;
  revision: number;
  automaticSpendRupees: 0;
  result: TradeResearchResultSummary;
  createdAt: string;
  completedAt?: string;
}

export function isTerminalTradeResearchStatus(status: TradeResearchStatus): boolean {
  return ["completed", "partial", "needs_review", "failed", "cancelled"].includes(status);
}

export function stageRank(stage: TradeResearchStage): number {
  return TRADE_RESEARCH_STAGES.indexOf(stage);
}
