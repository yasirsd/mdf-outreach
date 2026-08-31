/**
 * BF3C — durable free-enrichment job (current-state row per capability).
 * Never stores emails, reveal handles, or paid-provider payloads.
 */

export const FREE_ENRICHMENT_CAPABILITIES = [
  "public_company_contacts",
  "decision_makers",
] as const;

export type FreeEnrichmentCapability = (typeof FREE_ENRICHMENT_CAPABILITIES)[number];

export const FREE_ENRICHMENT_JOB_STATUSES = [
  "queued",
  "processing",
  "retry_wait",
  "succeeded",
  "no_result",
  "failed",
  "cancelled",
] as const;

export type FreeEnrichmentJobStatus = (typeof FREE_ENRICHMENT_JOB_STATUSES)[number];

export const FREE_ENRICHMENT_TERMINAL_STATUSES: readonly FreeEnrichmentJobStatus[] = [
  "succeeded",
  "no_result",
  "failed",
  "cancelled",
];

export const FREE_ENRICHMENT_CLAIMABLE_STATUSES: readonly FreeEnrichmentJobStatus[] = [
  "queued",
  "retry_wait",
];

export interface FreeEnrichmentJob {
  id: string;
  workspaceId: string;
  candidateId: string;
  capability: FreeEnrichmentCapability;
  status: FreeEnrichmentJobStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  providerOutcome?: string;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export const FREE_ENRICHMENT_MAX_ATTEMPTS = 3;
/** After attempt 1 fails retryable: 30s. After attempt 2: 2 minutes. */
export const FREE_ENRICHMENT_BACKOFF_MS = [30_000, 120_000] as const;
/**
 * attempt_count caps one execution cycle (auto drain or a claimed
 * operator run) at 3 tries. An explicit operator refresh of a terminal
 * row starts a new cycle (attempt_count reset to 0, then claim → 1).
 * Retry now on retry_wait keeps the current cycle's count.
 */
export const FREE_ENRICHMENT_STALE_PROCESSING_MS = 90_000;
export const FREE_ENRICHMENT_CONCURRENCY = {
  public_company_contacts: 1,
  decision_makers: 1,
} as const;

export function isFreeEnrichmentCapability(value: string): value is FreeEnrichmentCapability {
  return (FREE_ENRICHMENT_CAPABILITIES as readonly string[]).includes(value);
}

export function isFreeEnrichmentJobStatus(value: string): value is FreeEnrichmentJobStatus {
  return (FREE_ENRICHMENT_JOB_STATUSES as readonly string[]).includes(value);
}

export function isTerminalFreeEnrichmentStatus(status: FreeEnrichmentJobStatus): boolean {
  return (FREE_ENRICHMENT_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function backoffMsAfterAttempt(attemptCount: number): number | undefined {
  if (attemptCount >= FREE_ENRICHMENT_MAX_ATTEMPTS) return undefined;
  return FREE_ENRICHMENT_BACKOFF_MS[Math.max(0, attemptCount - 1)] ?? FREE_ENRICHMENT_BACKOFF_MS[1];
}
