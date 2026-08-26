import type {
  AssetRecord,
  Buyer,
  Campaign,
  CampaignRecipient,
  EmailTemplate,
  WorkspaceSettings,
} from "@/lib/types";
import { renderEmailHtml, renderEmailText } from "@/lib/email/renderer";
import { buildContext, personalize } from "@/lib/email/personalize";
import { fullPreflight } from "@/lib/gmail/preflight";

export type BuyerReadinessStatus = "ready" | "blocked" | "already-sent";

export interface BuyerReadinessRow {
  buyerId: string;
  status: BuyerReadinessStatus;
  reasons: string[];
}

export interface ReadinessInput {
  campaign: Campaign;
  template: EmailTemplate | null;
  settings: WorkspaceSettings;
  assets: AssetRecord[];
  recipients: CampaignRecipient[];
  buyers: Buyer[];
  /** Set of buyer_ids that already have a successful buyer-send event. */
  alreadySentBuyerIds: Set<string>;
  /** Whether Gmail is connected server-side. Same for every buyer. */
  gmailConnected: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server-side buyer-send readiness classifier.
 *
 * Runs the SAME full preflight the send action will run, so what the
 * operator sees on the review screen is what the server will accept.
 *
 * One row per recipient — buyers with no matching recipient are ignored.
 * Advanced status is NOT a blocker (advanced buyers can still be re-sent
 * a NEW campaign; the "already sent" check is per-campaign, per-buyer).
 */
export function classifyRecipients(input: ReadinessInput): BuyerReadinessRow[] {
  const buyerById = new Map(input.buyers.map((b) => [b.id, b]));
  const assetsBySlot = Object.fromEntries(input.assets.map((a) => [a.slot, a]));

  return input.recipients.map((rec) => {
    const buyer = buyerById.get(rec.buyerId);
    return classifyOne({
      buyer,
      recipient: rec,
      campaign: input.campaign,
      template: input.template,
      settings: input.settings,
      assetsBySlot,
      alreadySentBuyerIds: input.alreadySentBuyerIds,
      gmailConnected: input.gmailConnected,
    });
  });
}

interface ClassifyOneInput {
  buyer: Buyer | undefined;
  recipient: CampaignRecipient;
  campaign: Campaign;
  template: EmailTemplate | null;
  settings: WorkspaceSettings;
  assetsBySlot: Record<string, AssetRecord | undefined>;
  alreadySentBuyerIds: Set<string>;
  gmailConnected: boolean;
}

export function classifyOne(input: ClassifyOneInput): BuyerReadinessRow {
  const buyerId = input.recipient.buyerId;
  const reasons: string[] = [];

  if (!input.buyer) {
    return {
      buyerId,
      status: "blocked",
      reasons: ["Buyer no longer exists in this workspace."],
    };
  }

  if (input.alreadySentBuyerIds.has(buyerId)) {
    return { buyerId, status: "already-sent", reasons: ["Already sent this campaign."] };
  }

  if (input.buyer.suppressed) {
    reasons.push(
      `Do not contact${input.buyer.suppressionReason ? ` (${input.buyer.suppressionReason})` : ""}.`,
    );
  }
  if (!input.buyer.email || !EMAIL_RE.test(input.buyer.email)) {
    reasons.push("Missing or invalid email.");
  }
  if (!input.gmailConnected) {
    reasons.push("Gmail sender not connected.");
  }
  if (!input.template) {
    reasons.push("Campaign has no template snapshot yet.");
  }
  if (!input.campaign.subject?.trim()) {
    reasons.push("Subject is empty.");
  }

  // If we have enough to render, run the SAME full preflight the send
  // action will run. Every blocker becomes a reason.
  if (input.template && input.buyer.email && EMAIL_RE.test(input.buyer.email)) {
    const html = renderEmailHtml({
      template: input.template,
      buyer: input.buyer,
      settings: input.settings,
      assetsBySlot: input.assetsBySlot,
      mode: "send",
    });
    const text = renderEmailText({
      template: input.template,
      buyer: input.buyer,
      settings: input.settings,
      assetsBySlot: input.assetsBySlot,
    });
    const ctx = buildContext(input.buyer, input.campaign.product);
    const subject = personalize(input.campaign.subject ?? "", ctx);
    const preflight = fullPreflight({
      campaign: { ...input.campaign, subject },
      template: input.template,
      html,
      text,
      assetsBySlot: input.assetsBySlot,
      recipient: input.buyer.email,
    });
    for (const b of preflight.blockers) {
      // Recipient-invalid is already handled above; avoid duplication.
      if (/^Recipient email is invalid/i.test(b)) continue;
      // Subject empty already handled above.
      if (/^Subject is empty/i.test(b)) continue;
      reasons.push(b);
    }
  }

  if (reasons.length > 0) return { buyerId, status: "blocked", reasons };
  return { buyerId, status: "ready", reasons: [] };
}

/**
 * Compact rollup for the "PRODUCTION BUYER SEND" summary card.
 */
export function summarizeReadiness(rows: BuyerReadinessRow[]) {
  let ready = 0;
  let blocked = 0;
  let alreadySent = 0;
  for (const r of rows) {
    if (r.status === "ready") ready += 1;
    else if (r.status === "blocked") blocked += 1;
    else alreadySent += 1;
  }
  return { ready, blocked, alreadySent, total: rows.length };
}
