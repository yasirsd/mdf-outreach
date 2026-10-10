import {
  PHASE_2A_STAGES,
  isTerminalTradeResearchStatus,
  stageRank,
  type Phase2AStage,
  type TradeResearchStage,
  type TradeResearchStatus,
} from "./types";

const LEGAL_STATUS_TRANSITIONS: Record<TradeResearchStatus, readonly TradeResearchStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["running", "cancel_requested", "completed", "partial", "needs_review", "failed"],
  cancel_requested: ["cancelled", "partial"],
  completed: [], partial: [], needs_review: [], failed: [], cancelled: [],
};

export function assertTradeResearchTransition(input: {
  fromStatus: TradeResearchStatus;
  toStatus: TradeResearchStatus;
  fromStage: TradeResearchStage;
  toStage: TradeResearchStage;
}): void {
  if (isTerminalTradeResearchStatus(input.fromStatus)) throw new Error("TERMINAL_JOB_IMMUTABLE");
  if (!LEGAL_STATUS_TRANSITIONS[input.fromStatus].includes(input.toStatus)) throw new Error("ILLEGAL_STATUS_TRANSITION");
  if (stageRank(input.toStage) < stageRank(input.fromStage)) throw new Error("STAGE_REGRESSION");
}

export function isJobLeaseStale(input: {
  now: Date;
  leaseExpiresAt?: string | null;
  heartbeatAt?: string | null;
  freshAttemptLeaseExpiresAt?: string | null;
}): boolean {
  if (!input.leaseExpiresAt || !input.heartbeatAt) return false;
  const now = input.now.getTime();
  const expired = Date.parse(input.leaseExpiresAt) < now;
  const heartbeatStale = Date.parse(input.heartbeatAt) < now - 60_000;
  const freshAttempt = Boolean(
    input.freshAttemptLeaseExpiresAt && Date.parse(input.freshAttemptLeaseExpiresAt) >= now,
  );
  return expired && heartbeatStale && !freshAttempt;
}

export function retryDelayMs(attemptNumber: number): number | null {
  if (attemptNumber === 1) return 30_000;
  if (attemptNumber === 2) return 120_000;
  return null;
}

/**
 * TH07 DEFECT 05E — per-eligible-provider retry classification.
 *
 * A historical attempt row can remain `state = failed_retryable` even
 * after attempt 3 has exhausted the budget (`retryDelayMs(3) === null`).
 * Exhaustion is therefore (latest attempt number + retryDelayMs), never
 * the attempt state alone.
 *
 *   retry_pending    — failed_retryable/retry_wait AND retryDelayMs(n) !== null
 *   retry_exhausted  — failed_retryable/retry_wait AND retryDelayMs(n) === null
 *                      (authoritatively attempt 3)
 */
export type EligibleProviderRetryState =
  | "not_started"
  | "evaluated_terminal"
  | "retry_pending"
  | "retry_exhausted"
  | "blocked_or_unsupported";

export function deriveEligibleProviderRetryState(input: {
  eligibility: "eligible" | "ineligible";
  latestAttemptNumber?: number | null;
  latestAttemptState?: string | null;
}): { state: EligibleProviderRetryState; attemptNumber: number; retryAfterMs: number | null } {
  if (input.eligibility === "ineligible") {
    return { state: "blocked_or_unsupported", attemptNumber: 0, retryAfterMs: null };
  }
  const attemptNumber = Number(input.latestAttemptNumber ?? 0);
  const attemptState = input.latestAttemptState ?? null;
  if (!attemptState || attemptNumber < 1) {
    return { state: "not_started", attemptNumber, retryAfterMs: null };
  }
  if (attemptState === "completed" || attemptState === "completed_no_match" || attemptState === "skipped_cached") {
    return { state: "evaluated_terminal", attemptNumber, retryAfterMs: null };
  }
  if (
    attemptState === "failed_terminal"
    || attemptState === "cancelled"
    || attemptState === "skipped_quota"
    || attemptState === "skipped_cost"
    || attemptState === "skipped_terms"
  ) {
    return attemptState === "failed_terminal" || attemptState === "cancelled"
      ? { state: "evaluated_terminal", attemptNumber, retryAfterMs: null }
      : { state: "blocked_or_unsupported", attemptNumber, retryAfterMs: null };
  }
  if (attemptState === "failed_retryable" || attemptState === "retry_wait") {
    const retryAfterMs = retryDelayMs(attemptNumber);
    if (retryAfterMs !== null) {
      return { state: "retry_pending", attemptNumber, retryAfterMs };
    }
    return { state: "retry_exhausted", attemptNumber, retryAfterMs: null };
  }
  return { state: "not_started", attemptNumber, retryAfterMs: null };
}

export function isRetryableProviderFailure(input: { status?: number; code?: string }): boolean {
  if (input.status === 429 || (input.status !== undefined && input.status >= 500)) return true;
  return ["NETWORK_TIMEOUT", "CONNECTION_RESET"].includes(input.code ?? "");
}

export const TRADE_RESEARCH_STAGE_LABELS: Record<Phase2AStage, string> = {
  preparing_identity: "Preparing company identity",
  planning_sources: "Selecting eligible free sources",
  screening_sources: "Checking official trade sources",
  resolving_company_matches: "Matching company records",
  checking_trade_activity: "Reviewing official importer-program evidence",
  finalizing: "Finalizing trade intelligence",
  complete: "Research complete",
};

export function phase2AStageState(current: TradeResearchStage, item: Phase2AStage): "complete" | "active" | "pending" {
  const currentIndex = PHASE_2A_STAGES.indexOf(current as Phase2AStage);
  const itemIndex = PHASE_2A_STAGES.indexOf(item);
  if (current === "complete" || itemIndex < currentIndex) return "complete";
  if (itemIndex === currentIndex) return "active";
  return "pending";
}

