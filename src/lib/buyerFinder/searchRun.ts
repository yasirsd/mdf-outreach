import type { BuyerTypeOption, ContactPriorityId } from "./types";
import type { ProviderNeutralOutcome } from "./providers/descriptors";

/**
 * BF2.2A — first-live-search processing cap. Server-authoritative.
 * The browser cannot raise this. One Find Buyers click = one bounded run.
 */
export const BUYER_FINDER_PROCESS_CAP = 20;

/**
 * Resolve the per-run process cap. A requested value may lower the cap
 * (tests) but never raise it above BUYER_FINDER_PROCESS_CAP.
 */
export function resolveBuyerFinderProcessCap(requested?: number): number {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) {
    return BUYER_FINDER_PROCESS_CAP;
  }
  return Math.min(BUYER_FINDER_PROCESS_CAP, Math.floor(requested));
}

/**
 * BF2.1 — Buyer Finder Search Run model + state contract.
 *
 * Persisted per migration 0013. A single run captures the operator's
 * inputs, provider identity, progress counters, cost class, and terminal
 * status. The DB enforces non-negative counters + processed ≤ usable.
 *
 * Count semantics with the BF2.2A process cap:
 *   discoveredCount — company rows returned by the provider (uncapped).
 *   usableCount — valid records that enter candidate processing (≤ 20).
 *   processedCount — usable records whose processing attempt finished.
 */

export type SearchRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export type SearchRunStage =
  | "preparing"
  | "discovering"
  | "processing_candidates"
  | "finalizing"
  | "complete";

export type SearchRunCostClass = "free" | "paid";

/** Set of statuses that indicate the run has ended. */
export const TERMINAL_STATUSES: readonly SearchRunStatus[] = [
  "completed",
  "partial",
  "failed",
];

export function isTerminal(status: SearchRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Valid stage transitions. `stage` only ever moves forward and the last
 * value is `complete`. Attempting to move to an earlier stage is a bug.
 */
const STAGE_ORDER: SearchRunStage[] = [
  "preparing",
  "discovering",
  "processing_candidates",
  "finalizing",
  "complete",
];

export function stageIndex(stage: SearchRunStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function canTransitionStage(from: SearchRunStage, to: SearchRunStage): boolean {
  return stageIndex(to) >= stageIndex(from);
}

export interface BuyerFinderSearchRun {
  id: string;
  workspaceId: string;

  country: string;
  businessProductId: string;
  desiredBuyerTypes: BuyerTypeOption[];
  contactPriorities: ContactPriorityId[];

  provider: "hunter";
  providerStatus?: ProviderNeutralOutcome | null;

  status: SearchRunStatus;
  stage: SearchRunStage;

  /**
   * discoveredCount — company rows returned by the company provider
   *   before local validation.
   * usableCount — normalized/valid records that enter candidate processing.
   *   Not "unique" and not "qualified".
   * processedCount — usable records whose processing attempt has finished.
   */
  discoveredCount: number;
  usableCount: number;
  processedCount: number;
  createdCount: number;
  enrichedExistingCount: number;
  duplicateCount: number;
  productMatchesAdded: number;
  failureCount: number;

  creditsUsed: number;
  costClass: SearchRunCostClass;

  errorCode?: string | null;
  errorMessage?: string | null;

  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Patch shape used by the progress reporter. Every field is optional so
 * the reporter can update only what has actually changed.
 */
export interface SearchRunPatch {
  status?: SearchRunStatus;
  stage?: SearchRunStage;
  providerStatus?: ProviderNeutralOutcome | null;
  discoveredCount?: number;
  usableCount?: number;
  processedCount?: number;
  createdCount?: number;
  enrichedExistingCount?: number;
  duplicateCount?: number;
  productMatchesAdded?: number;
  failureCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Snapshot exposed to the client. Never includes an API key, raw
 * provider payload, workspaceId, or Supabase internals.
 *
 * Count semantics (BF2.2):
 *   discoveredCount — company rows returned by the company provider
 *     before local validation.
 *   usableCount — normalized/valid provider company records that enter
 *     the candidate-processing loop. NOT "unique" (dedupe happens
 *     inside the loop) and NOT "qualified" (no qualification threshold).
 *   processedCount — usable records whose candidate-processing attempt
 *     has completed (success or candidate-level failure).
 */
export interface SafeSearchRunSnapshot {
  id: string;
  status: SearchRunStatus;
  stage: SearchRunStage;
  provider: BuyerFinderSearchRun["provider"];
  providerStatus?: ProviderNeutralOutcome | null;
  country: string;
  businessProductId: string;
  discoveredCount: number;
  usableCount: number;
  processedCount: number;
  createdCount: number;
  enrichedExistingCount: number;
  duplicateCount: number;
  productMatchesAdded: number;
  failureCount: number;
  creditsUsed: number;
  costClass: SearchRunCostClass;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Persisted on a stale run that the operator (or UI) finalizes. */
export const INTERRUPTED_ERROR_CODE = "interrupted";

/**
 * BF2.1 — a run row is "stale" if it has been in a non-terminal state
 * for longer than STALE_THRESHOLD_MS with no `updatedAt` progress.
 * The UI shows an intentional "Search interrupted" state; ingestion is
 * never automatically restarted.
 */
export const STALE_THRESHOLD_MS = 90_000;

export function isRunStale(
  run: Pick<BuyerFinderSearchRun, "status" | "updatedAt">,
  now: Date = new Date(),
): boolean {
  if (isTerminal(run.status)) return false;
  const updated = new Date(run.updatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated > STALE_THRESHOLD_MS;
}

export function toSnapshot(run: BuyerFinderSearchRun): SafeSearchRunSnapshot {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    provider: run.provider,
    providerStatus: run.providerStatus ?? null,
    country: run.country,
    businessProductId: run.businessProductId,
    discoveredCount: run.discoveredCount,
    usableCount: run.usableCount,
    processedCount: run.processedCount,
    createdCount: run.createdCount,
    enrichedExistingCount: run.enrichedExistingCount,
    duplicateCount: run.duplicateCount,
    productMatchesAdded: run.productMatchesAdded,
    failureCount: run.failureCount,
    creditsUsed: run.creditsUsed,
    costClass: run.costClass,
    errorCode: run.errorCode ?? null,
    errorMessage: run.errorMessage ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
