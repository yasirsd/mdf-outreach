import type { Campaign, CampaignRecipient } from "@/lib/types";

/**
 * MDF Outreach — F6 campaign progress rollup.
 *
 * ─── SEMANTIC DEFINITIONS (Overview terminology) ──────────────────────
 *
 *   totalRecipients  Number of campaign_recipients rows for the campaign.
 *
 *   delivered        UNIQUE buyer_ids that are BOTH:
 *                      (a) present in the campaign's CURRENT
 *                          campaign_recipients set, AND
 *                      (b) have at least one email_send_events row for
 *                          the campaign with kind='buyer-send' AND
 *                          ok=true (lifetime — not window-bounded).
 *                    The intersection matters: a buyer who was
 *                    delivered historically but has since been REMOVED
 *                    from the recipient list does NOT increase current
 *                    campaign progress. By construction the count also
 *                    can never exceed totalRecipients.
 *
 *   suppressed       Recipients whose buyer is marked "Do not contact"
 *                    AND is NOT already delivered. Purely visual — it
 *                    is NOT the same as full Buyer Send "blocked",
 *                    which additionally checks missing/invalid email,
 *                    template snapshot, subject presence and preflight.
 *                    We deliberately do NOT call this "blocked" on
 *                    Overview to avoid disagreeing with the Send tab.
 *
 *   remaining        totalRecipients − delivered − suppressed.
 *                    Recipients that are not yet delivered and are not
 *                    outright suppressed. This is NOT a claim they are
 *                    "ready" — they may still be blocked by preflight
 *                    conditions the Send tab authoritatively evaluates.
 *
 *   progressPct      delivered / totalRecipients (0 when total=0).
 *
 *   Failed attempts and safety-gate refusals do NOT change any number.
 */

export type CampaignProgressStatus =
  | "healthy"
  | "in_progress"
  | "attention"
  | "delivered"
  | "quiet";

export interface CampaignProgressRow {
  campaign: Campaign;
  totalRecipients: number;
  /** Distinct buyers with at least one successful buyer-send. */
  delivered: number;
  /** Recipients pointing at suppressed buyers AND not delivered. */
  suppressed: number;
  /** totalRecipients − delivered − suppressed. */
  remaining: number;
  /** Timestamp of the newest successful send, or null. */
  lastDeliveryAt: string | null;
  progressPct: number;
  statusTone: CampaignProgressStatus;
}

export interface CampaignProgressInput {
  campaigns: Campaign[];
  recipientsByCampaign: Map<string, CampaignRecipient[]>;
  /**
   * For every campaign the caller cares about, the DISTINCT set of
   * buyer ids that have at least one successful buyer-send event.
   * Must be LIFETIME, not window-bounded.
   */
  successfulBuyerIdsByCampaign: Map<string, Set<string>>;
  /** Newest successful buyer-send timestamp per campaign — or null. */
  lastDeliveryByCampaign: Map<string, string | null>;
  /** Buyers currently suppressed workspace-wide. */
  suppressedBuyerIds: Set<string>;
  /** Cap on rows returned. */
  limit?: number;
}

const DEFAULT_LIMIT = 5;

/**
 * Rank campaigns for Overview display: active first (newer updated_at
 * first — inherited from repository default ordering), then others.
 */
export function computeCampaignProgress(input: CampaignProgressInput): CampaignProgressRow[] {
  const active = input.campaigns.filter((c) => c.status === "active");
  const others = input.campaigns.filter((c) => c.status !== "active");
  const ordered = [...active, ...others];
  const limit = input.limit ?? DEFAULT_LIMIT;
  const rows: CampaignProgressRow[] = [];

  for (const c of ordered) {
    if (rows.length >= limit) break;
    const recipients = input.recipientsByCampaign.get(c.id) ?? [];
    const success = input.successfulBuyerIdsByCampaign.get(c.id) ?? new Set<string>();
    const total = recipients.length;

    let suppressed = 0;
    let delivered = 0;
    let remaining = 0;
    for (const r of recipients) {
      if (success.has(r.buyerId)) {
        delivered += 1;
        continue;
      }
      if (input.suppressedBuyerIds.has(r.buyerId)) {
        suppressed += 1;
        continue;
      }
      remaining += 1;
    }
    const lastDeliveryAt = input.lastDeliveryByCampaign.get(c.id) ?? null;
    const progressPct = total > 0 ? Math.round((delivered / total) * 100) : 0;

    let statusTone: CampaignProgressStatus;
    if (total === 0) statusTone = "quiet";
    else if (delivered === total) statusTone = "delivered";
    else if (suppressed > 0 && remaining === 0) statusTone = "attention";
    else if (delivered === 0) statusTone = "healthy";
    else statusTone = "in_progress";

    rows.push({
      campaign: c,
      totalRecipients: total,
      delivered,
      suppressed,
      remaining,
      lastDeliveryAt,
      progressPct,
      statusTone,
    });
  }

  return rows;
}
