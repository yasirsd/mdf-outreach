import type { BuyerReadinessRow } from "./buyerSendReadiness";
import type { BuyerSendHistoryRow } from "./buyerSendAudit";

export interface CampaignDeliverySummary {
  totalRecipients: number;
  ready: number;
  blocked: number;
  alreadySent: number;
  /** Distinct buyers with at least one successful buyer-send event. */
  successful: number;
  /**
   * Distinct buyers whose latest ATTEMPT was a failure (and who have
   * NO successful send). A buyer that failed once and later succeeded
   * counts as successful, not failed.
   */
  failed: number;
  /**
   * Recipients who have never been attempted for this campaign at all
   * (no events of any kind).
   */
  neverAttempted: number;
  /** Timestamp of the newest successful send, or null if none. */
  lastDeliveryAt: string | null;
  /**
   * True when every eligible recipient has a successful send:
   *   ready = 0, blocked = 0, alreadySent = totalRecipients > 0.
   */
  campaignDeliveryComplete: boolean;
}

/**
 * Aggregate per-campaign delivery stats from the readiness rows +
 * complete event history for that campaign. Both inputs are read from
 * server-authoritative sources (RLS-scoped) — this module is pure and
 * safe to unit-test.
 */
export function computeDeliverySummary(input: {
  rows: BuyerReadinessRow[];
  history: BuyerSendHistoryRow[];
}): CampaignDeliverySummary {
  const totalRecipients = input.rows.length;
  let ready = 0;
  let blocked = 0;
  let alreadySent = 0;
  for (const r of input.rows) {
    if (r.status === "ready") ready += 1;
    else if (r.status === "blocked") blocked += 1;
    else alreadySent += 1;
  }

  // Distinct successful buyers.
  const successfulBuyerIds = new Set<string>();
  // Latest attempt per buyer.
  const latestAttempt = new Map<
    string,
    { at: string; ok: boolean }
  >();
  let lastDeliveryAt: string | null = null;

  for (const row of input.history) {
    if (!row.buyerId) continue;
    if (row.ok) {
      successfulBuyerIds.add(row.buyerId);
      if (!lastDeliveryAt || row.createdAt > lastDeliveryAt) {
        lastDeliveryAt = row.createdAt;
      }
    }
    const prev = latestAttempt.get(row.buyerId);
    if (!prev || row.createdAt > prev.at) {
      latestAttempt.set(row.buyerId, { at: row.createdAt, ok: row.ok });
    }
  }

  // Failed = buyer whose latest attempt was a failure AND has no
  // successful send at all.
  let failed = 0;
  for (const [bid, la] of latestAttempt) {
    if (!la.ok && !successfulBuyerIds.has(bid)) failed += 1;
  }

  // Never attempted = recipient rows for which we have no event history
  // (regardless of status) — must be counted from the recipient set,
  // not the history.
  const recipientBuyerIds = new Set(input.rows.map((r) => r.buyerId));
  const attemptedIds = new Set(latestAttempt.keys());
  let neverAttempted = 0;
  for (const bid of recipientBuyerIds) {
    if (!attemptedIds.has(bid)) neverAttempted += 1;
  }

  const campaignDeliveryComplete =
    totalRecipients > 0 && ready === 0 && blocked === 0 && alreadySent === totalRecipients;

  return {
    totalRecipients,
    ready,
    blocked,
    alreadySent,
    successful: successfulBuyerIds.size,
    failed,
    neverAttempted,
    lastDeliveryAt,
    campaignDeliveryComplete,
  };
}
