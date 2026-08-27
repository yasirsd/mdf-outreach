import type { Buyer, Campaign, CampaignRecipient } from "@/lib/types";
import { followUpDateKey } from "@/lib/dates/followUp";
import { workspaceTodayKey } from "./timezone";

/**
 * MDF Outreach — F6 "Needs attention" rules.
 *
 * Every item is deterministically derivable from existing data. Nothing
 * speculative, nothing invented. The rules run on the same buyer /
 * campaign / recipient snapshots the rest of the dashboard uses so the
 * counts are internally consistent.
 *
 * Order of rules controls display order. Each rule reports:
 *   • severity → visual tone (warning / danger / info)
 *   • title    → single sentence, count-aware
 *   • detail   → optional secondary line
 *   • action   → { label, href } for the CTA
 *
 * The one runtime signal we accept from outside the buyer/campaign
 * dataset is `gmailConnected: boolean` (from the F3 gmail-connection
 * cache) — that is authoritative and cannot be reconstructed from the
 * data snapshots.
 */

export type AttentionSeverity = "danger" | "warning" | "info";
export type AttentionKind =
  | "follow_ups_overdue"
  | "follow_ups_today"
  | "campaign_blocked_recipients"
  | "campaign_missing_template"
  | "campaign_missing_subject"
  | "gmail_disconnected";

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  detail?: string;
  href: string;
  actionLabel: string;
  count: number;
}

export interface NeedsAttentionInput {
  buyers: Buyer[];
  campaigns: Campaign[];
  /**
   * Per-campaign recipient rows for EVERY active campaign — no cap.
   * The loader is responsible for evaluating attention across the
   * complete set of active campaigns so an unevaluated 13th active
   * campaign can never produce a false "All clear".
   */
  activeRecipientsByCampaign: Map<string, CampaignRecipient[]>;
  /** Buyers indexed by id — used for suppression lookup. */
  suppressedBuyerIds: Set<string>;
  gmailConnected: boolean;
  now?: Date;
  /**
   * Optional TZ override for the follow-up "today" comparison. When
   * omitted, the workspace timezone is used.
   */
  timezone?: string;
}

export function computeNeedsAttention(input: NeedsAttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const now = input.now ?? new Date();
  const today = workspaceTodayKey(now, input.timezone);

  // 1) Gmail disconnected — the highest-priority actionable signal.
  if (!input.gmailConnected) {
    items.push({
      key: "gmail-disconnected",
      kind: "gmail_disconnected",
      severity: "danger",
      title: "Gmail sender is not connected",
      detail: "Buyer send is blocked until Gmail is reconnected.",
      href: "/settings",
      actionLabel: "Open settings",
      count: 1,
    });
  }

  // 2) Follow-ups overdue — compare stored YYYY-MM-DD prefix against
  //    the workspace "today" key, not the server's local calendar day.
  const overdue = input.buyers.filter((b) => {
    const key = followUpDateKey(b.nextFollowUpAt);
    return !!key && key < today;
  }).length;
  if (overdue > 0) {
    items.push({
      key: "follow-ups-overdue",
      kind: "follow_ups_overdue",
      severity: "warning",
      title: `${overdue} overdue follow-up${overdue === 1 ? "" : "s"}`,
      detail: "Buyers whose scheduled follow-up date has passed.",
      href: "/buyers",
      actionLabel: "Review buyers",
      count: overdue,
    });
  }

  // 3) Follow-ups due today.
  const dueToday = input.buyers.filter((b) => followUpDateKey(b.nextFollowUpAt) === today).length;
  if (dueToday > 0) {
    items.push({
      key: "follow-ups-today",
      kind: "follow_ups_today",
      severity: "info",
      title: `${dueToday} follow-up${dueToday === 1 ? "" : "s"} due today`,
      href: "/buyers",
      actionLabel: "Review buyers",
      count: dueToday,
    });
  }

  // 4) Active campaigns missing template.
  const missingTemplate = input.campaigns.filter(
    (c) => c.status === "active" && (!c.templateId || c.templateId.trim() === ""),
  );
  for (const c of missingTemplate) {
    items.push({
      key: `campaign-missing-template-${c.id}`,
      kind: "campaign_missing_template",
      severity: "warning",
      title: `Campaign "${c.name}" has no template`,
      detail: "Set a template snapshot before starting outreach.",
      href: `/campaigns/${c.id}/email`,
      actionLabel: "Fix campaign",
      count: 1,
    });
  }

  // 5) Active campaigns with empty subject.
  const missingSubject = input.campaigns.filter(
    (c) => c.status === "active" && !c.subject?.trim(),
  );
  for (const c of missingSubject) {
    items.push({
      key: `campaign-missing-subject-${c.id}`,
      kind: "campaign_missing_subject",
      severity: "warning",
      title: `Campaign "${c.name}" has no subject`,
      href: `/campaigns/${c.id}/email`,
      actionLabel: "Fix campaign",
      count: 1,
    });
  }

  // 6) Blocked recipients — recipients pointing at suppressed buyers,
  //    per active campaign.
  for (const c of input.campaigns) {
    if (c.status !== "active") continue;
    const recs = input.activeRecipientsByCampaign.get(c.id) ?? [];
    if (recs.length === 0) continue;
    let blocked = 0;
    for (const r of recs) {
      if (input.suppressedBuyerIds.has(r.buyerId)) blocked += 1;
    }
    if (blocked > 0) {
      items.push({
        key: `campaign-suppressed-${c.id}`,
        // The internal kind name is kept for backwards compatibility of
        // tests / analytics; the user-facing copy speaks only of
        // suppression because that is the ONLY condition this rule
        // evaluates. Full Buyer Send "blocked" also considers missing
        // email, template snapshot, subject, assets, and preflight —
        // Overview does not.
        kind: "campaign_blocked_recipients",
        severity: "warning",
        title: `${blocked} suppressed recipient${blocked === 1 ? "" : "s"} in “${c.name}”`,
        detail: "These recipients are marked Do not contact and will be skipped by Buyer Send.",
        href: `/campaigns/${c.id}/send`,
        actionLabel: "Open campaign",
        count: blocked,
      });
    }
  }

  return items;
}
