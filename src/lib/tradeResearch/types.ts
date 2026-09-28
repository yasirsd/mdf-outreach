export const AUTOMATIC_SPEND_RUPEES = 0 as const;
export const TRADE_RESEARCH_PLANNER_VERSION = "trade-planner-v1" as const;
export const TRADE_RESEARCH_INTERPRETATION_VERSION = "trade-interpretation-v1" as const;

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

/**
 * The complete semantic boundary for one trade-research request.
 *
 * Display labels, timestamps and run identifiers deliberately do not belong
 * here. Callers must persist this exact context before treating a result as
 * reusable for a later request.
 */
export interface ResearchContext {
  workspaceId: string;
  candidateId: string;
  marketCountryCode: string;
  productId: string;
  productForm: string | null;
  researchGoal: TradeResearchGoal;
  providerPlanVersion: string;
  interpretationVersion: string;
}

export type ResearchContextField = keyof ResearchContext;

/** Browser-safe request fields. Workspace and version fields are server-owned. */
export interface TradeResearchRequest {
  candidateId: string;
  marketCountryCode: string;
  productId: string;
  productForm: string | null;
  researchGoal: TradeResearchGoal;
}
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

export const TRADE_RESEARCH_PROVIDER_EXECUTION_STATES = [
  "not_started",
  "completed",
  "no_match",
  "failed_retryable",
  "failed_terminal",
  "unsupported",
  "blocked",
  "cancelled",
  "cached",
] as const;

export type TradeResearchProviderExecutionState =
  (typeof TRADE_RESEARCH_PROVIDER_EXECUTION_STATES)[number];

export interface TradeResearchProviderExecution {
  status: TradeResearchProviderExecutionState;
  /** Stable, non-sensitive code only. Provider response bodies do not belong here. */
  safeErrorCode: string | null;
}

export type TradeResearchMatchDecision =
  | "exact"
  | "strong"
  | "ambiguous"
  | "rejected"
  | "none"
  | "not_evaluated";

export interface TradeResearchEvidenceAssessment {
  state: TradeResearchEvidenceLevel;
  explanation: string;
}

export type TradeResearchCoverageState =
  | "covered"
  | "partially_covered"
  | "not_covered"
  | "not_evaluated";

export interface TradeResearchCoverageAssessment {
  state: TradeResearchCoverageState;
  explanation: string;
}

/** Describes the grain a source actually supports. */
export interface TradeResearchMappingScope {
  marketCountryCode: string;
  productId: string;
  productForm: string | null;
  sourceProductCodes: string[];
  companyGrain: "company_record" | "dataset_only" | "not_available";
  productGrain: "company_product" | "market_product" | "not_available";
  originGrain: "company_product_origin" | "market_product_origin" | "not_available";
  shipmentGrain: "shipment_record" | "not_available";
  programGrain: "company_program" | "not_available";
}

export interface TradeResearchEvidenceConflict {
  dimension: "identity" | "product" | "origin" | "india_origin" | "shipment" | "program" | "coverage";
  description: string;
  sourceRecordIds: string[];
}

/**
 * Evidence emitted by one provider. Dimensions remain independent: no field
 * may be promoted merely because a different dimension is strong.
 */
export interface TradeResearchProviderEvidence {
  matchDecision: TradeResearchMatchDecision;
  companyEvidence: TradeResearchEvidenceAssessment;
  productEvidence: TradeResearchEvidenceAssessment;
  originEvidence: TradeResearchEvidenceAssessment;
  /** India-specific origin relationship from this same provider row/grain. */
  indiaOriginEvidence?: TradeResearchEvidenceAssessment;
  shipmentEvidence: TradeResearchEvidenceAssessment;
  programEvidence: TradeResearchEvidenceAssessment;
  coverage: TradeResearchCoverageAssessment;
  limitations: string[];
  attribution: string;
  mappingScope: TradeResearchMappingScope;
  interpretationVersion: string;
  conflicts: TradeResearchEvidenceConflict[];
}

interface TradeResearchProviderResultBase {
  providerId: string;
  datasetId: string;
  /** Publisher/source release. This is not an interpretation version. */
  datasetVersion: string | null;
  /** Parser implementation version. This is not a dataset version. */
  parserVersion: string | null;
  sourceRecordIds: string[];
  sourcePeriod: string | null;
  retrievedAt: string | null;
}

export type TradeResearchEvaluatedProviderResult = TradeResearchProviderResultBase & {
  execution: TradeResearchProviderExecution & {
    status: "completed" | "no_match" | "cached";
  };
  evidence: TradeResearchProviderEvidence;
};

export type TradeResearchUnevaluatedProviderResult = TradeResearchProviderResultBase & {
  execution: TradeResearchProviderExecution & {
    status:
      | "not_started"
      | "failed_retryable"
      | "failed_terminal"
      | "unsupported"
      | "blocked"
      | "cancelled";
  };
  /** Partial evidence may be retained; absence must never be read as no_match. */
  evidence: TradeResearchProviderEvidence | null;
};

/** One durable provider outcome. Execution status and evidence are separate. */
export type TradeResearchProviderResult =
  | TradeResearchEvaluatedProviderResult
  | TradeResearchUnevaluatedProviderResult;

export type TradeResearchAggregateEvidenceState =
  | "verified"
  | "supporting"
  | "needs_review"
  | "no_verified_match"
  | "not_verified"
  | "conflicting"
  | "not_available"
  | "not_evaluated";

export interface TradeResearchAggregateDimensionSummary {
  state: TradeResearchAggregateEvidenceState;
  explanation: string;
  supportingProviderIds: string[];
  conflictingProviderIds: string[];
}

export interface TradeResearchAggregateConflict {
  dimension: "identity" | "product" | "origin" | "india_origin" | "shipment" | "program" | "coverage";
  providerIds: string[];
  description: string;
}

export interface TradeResearchAggregateCoverageCounts {
  planned: number;
  evaluated: number;
  cached: number;
  failed: number;
  unsupported: number;
  blocked: number;
  notStarted: number;
  cancelled: number;
}

export interface TradeResearchSourceFamilySummary {
  familyId: string;
  providerIds: string[];
}

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
   * `"verified"` or `"supporting"` only after company identity is accepted
   * or ambiguous, respectively, and the same matched company + target HS6
   * rows carry India as an origin country. Rejected/none identity always
   * remains `"not_verified"`; origin is never inferred from a separate
   * market-level report.
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
  /** T08 explicit provider accounting. Present on newly finalized typed results. */
  sourcesPlanned?: number;
  sourcesAttempted?: number;
  sourcesEvaluated?: number;
  sourcesSucceeded?: number;
  sourcesFailed?: number;
  sourcesCached?: number;
  automaticSpendRupees: 0;
  /** T06 context. Missing means legacy/unknown and is never inferred on read. */
  context?: ResearchContext;
  /** SHA-256 fingerprint of the canonical context input. */
  contextFingerprint?: string;
  /** T06 provider contract. Present values take precedence in typed readers. */
  providerResults?: TradeResearchProviderResult[];
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

/**
 * Draft aggregate contract for the later aggregation task. T06 defines its
 * shape only; current Phase 2C aggregation continues to write the compatible
 * TradeResearchAggregateSummary subset.
 */
export interface TradeResearchAggregateResult extends TradeResearchAggregateSummary {
  identitySummary: TradeResearchAggregateDimensionSummary;
  productSummary: TradeResearchAggregateDimensionSummary;
  originSummary: TradeResearchAggregateDimensionSummary;
  indiaOriginSummary: TradeResearchAggregateDimensionSummary;
  shipmentSummary: TradeResearchAggregateDimensionSummary;
  programSummary: TradeResearchAggregateDimensionSummary;
  coverageSummary: TradeResearchAggregateDimensionSummary;
  coverageCounts: TradeResearchAggregateCoverageCounts;
  sourceFamilies: TradeResearchSourceFamilySummary[];
  conflicts: TradeResearchAggregateConflict[];
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
  /** Present only for T07+ typed jobs. Historical jobs remain contextless. */
  context?: ResearchContext;
  contextFingerprint?: string;
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
