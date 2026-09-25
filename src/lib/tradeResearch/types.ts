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
  source: "FDA FSVP";
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

export interface TradeResearchResultSummary {
  officialProgramEvidence: "verified" | "no_verified_match" | "needs_review" | "not_checked";
  productEvidence: "not_available";
  indiaOrigin: "not_verified";
  shipmentEvidence: "not_verified";
  sourcesChecked: number;
  automaticSpendRupees: 0;
  evidence?: TradeResearchEvidenceDetail;
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
