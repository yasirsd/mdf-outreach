/**
 * BF3B — durable paid personal-reveal event.
 *
 * Does not store reveal_handle / provider_ref.
 */

export type ContactRevealEventStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "reconciliation_required";

export type ContactRevealProviderOutcome =
  | "revealed"
  | "already_revealed"
  | "not_found"
  | "insufficient_credits"
  | "invalid_response"
  | "provider_error";

export const CONTACT_REVEAL_STALE_MS = 120_000;

export const CONTACT_REVEAL_UNRESOLVED_STATUSES: readonly ContactRevealEventStatus[] = [
  "pending",
  "processing",
  "reconciliation_required",
];

/** Terminal historical states — not a paid lock. A later reveal may insert a new event. */
export const CONTACT_REVEAL_TERMINAL_STATUSES: readonly ContactRevealEventStatus[] = [
  "succeeded",
  "failed",
];

export interface BuyerFinderContactRevealEvent {
  id: string;
  workspaceId: string;
  candidateId: string;
  contactId: string;
  provider: "hunter";
  status: ContactRevealEventStatus;
  providerOutcome?: ContactRevealProviderOutcome;
  creditsCharged?: number | null;
  errorCode?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Unresolved paid lock: pending, processing, or reconciliation_required. */
export function isActiveRevealStatus(status: ContactRevealEventStatus): boolean {
  return (
    status === "pending" || status === "processing" || status === "reconciliation_required"
  );
}

export function isTerminalRevealStatus(status: ContactRevealEventStatus): boolean {
  return status === "succeeded" || status === "failed";
}

export function isRevealEventStale(
  event: Pick<BuyerFinderContactRevealEvent, "startedAt" | "createdAt">,
  nowMs = Date.now(),
  staleMs = CONTACT_REVEAL_STALE_MS,
): boolean {
  const raw = event.startedAt ?? event.createdAt;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  return nowMs - t > staleMs;
}
