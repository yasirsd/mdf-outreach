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

