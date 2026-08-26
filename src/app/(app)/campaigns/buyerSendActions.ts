"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { serverRepositories } from "@/lib/repositories/server";
import { createClient } from "@/utils/supabase/server";
import { logActivity } from "@/lib/activity";
import { renderEmailHtml, renderEmailText } from "@/lib/email/renderer";
import { resolveCampaignTemplate } from "@/lib/email/resolveCampaignTemplate";
import { fullPreflight } from "@/lib/gmail/preflight";
import { ensureFreshAccessToken, loadGmailConnection } from "@/lib/gmail/tokens";
import { GmailApiError, sendGmailMessage } from "@/lib/gmail/sendClient";
import { claimSendNonce } from "@/lib/gmail/idempotency";
import { buildContext, personalize } from "@/lib/email/personalize";
import {
  BUYER_SEND_BATCH_MAX,
  isBuyerSendEnabled,
} from "@/lib/gmail/buyerSendConfig";
import {
  claimBuyerSend,
  releaseBuyerSend,
} from "@/lib/gmail/buyerSendClaim";
import {
  fetchAlreadySentBuyerIds,
  recordBuyerSendEvent,
} from "@/lib/gmail/buyerSendAudit";
import {
  classifyRecipients,
  summarizeReadiness,
  type BuyerReadinessRow,
} from "@/lib/gmail/buyerSendReadiness";
import { buyerPatchAfterSuccessfulSend } from "@/lib/buyerStatus";
import type { Buyer, Campaign, EmailTemplate } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * Readiness — what the review screen and the Buyer Send rail render.
 * ------------------------------------------------------------------------- */

export interface BuyerSendPageData {
  campaign: Campaign;
  template: EmailTemplate | null;
  gmailConnected: boolean;
  gmailSenderEmail: string | null;
  rows: BuyerReadinessRow[];
  summary: ReturnType<typeof summarizeReadiness>;
  batchMax: number;
  buyerSendEnabled: boolean;
  buyersById: Record<string, Buyer>;
}

export async function getBuyerSendPageDataAction(
  campaignId: string,
): Promise<BuyerSendPageData> {
  const { session, repos } = await serverRepositories();
  const supabase = createClient(cookies());

  const campaign = await repos.campaigns.get(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const master = campaign.templateId
    ? (await repos.templates.get(campaign.templateId)) ?? null
    : null;
  const template = resolveCampaignTemplate(campaign, master);

  const [recipients, buyers, assets, settings, conn] = await Promise.all([
    repos.recipients.listByCampaign(campaignId),
    repos.buyers.list(),
    repos.assets.list(),
    repos.settings.get(),
    loadGmailConnection(supabase, session.membership.workspaceId),
  ]);
  if (!settings) throw new Error("Workspace settings not initialized.");

  const candidateBuyerIds = recipients.map((r) => r.buyerId);
  const alreadySentBuyerIds = await fetchAlreadySentBuyerIds({
    supabase,
    workspaceId: session.membership.workspaceId,
    campaignId,
    candidateBuyerIds,
  });

  const rows = classifyRecipients({
    campaign,
    template,
    settings,
    assets,
    recipients,
    buyers,
    alreadySentBuyerIds,
    gmailConnected: !!conn,
  });

  const buyersById: Record<string, Buyer> = {};
  for (const b of buyers) buyersById[b.id] = b;

  return {
    campaign,
    template,
    gmailConnected: !!conn,
    gmailSenderEmail: conn?.googleUserEmail ?? null,
    rows,
    summary: summarizeReadiness(rows),
    batchMax: BUYER_SEND_BATCH_MAX,
    buyerSendEnabled: isBuyerSendEnabled(),
    buyersById,
  };
}

/* ---------------------------------------------------------------------------
 * Send — the authoritative production Buyer Send workflow.
 * ------------------------------------------------------------------------- */

export interface SendBuyersInput {
  campaignId: string;
  buyerIds: string[];
  /** Batch-level nonce — one per Confirm click. */
  batchNonce: string;
}

export type PerBuyerOutcome =
  | { buyerId: string; ok: true; messageId: string; threadId: string; deliveredTo: string }
  | { buyerId: string; ok: false; skipped?: "already-sent" | "blocked" | "claim-taken"; error?: string };

export interface SendBuyersResult {
  ok: boolean;
  error?: string;
  outcomes: PerBuyerOutcome[];
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Production Buyer Send. Sends ONE Gmail message per buyer, sequentially,
 * behind the BUYER_SEND_ENABLED server gate.
 *
 * The client only ever supplies (campaignId, buyerIds, batchNonce). Every
 * security-sensitive value — workspace, sender identity, recipient email,
 * suppression status, already-sent status, template snapshot, subject —
 * is re-resolved from the database inside this action.
 */
export async function sendBuyersAction(
  input: SendBuyersInput,
): Promise<SendBuyersResult> {
  const { session, repos } = await serverRepositories();
  const supabase = createClient(cookies());
  const workspaceId = session.membership.workspaceId;

  // --- Shape validation --------------------------------------------------
  if (!input.batchNonce || typeof input.batchNonce !== "string") {
    return emptyResult({ error: "Missing batch nonce." });
  }
  if (!Array.isArray(input.buyerIds) || input.buyerIds.length === 0) {
    return emptyResult({ error: "No buyers selected." });
  }
  const uniqueBuyerIds = Array.from(new Set(input.buyerIds.map(String)));
  if (uniqueBuyerIds.length > BUYER_SEND_BATCH_MAX) {
    return emptyResult({
      error: `Batch exceeds the ${BUYER_SEND_BATCH_MAX}-buyer safety limit for production Buyer Send.`,
    });
  }

  // --- Batch-level idempotency (guards refresh / double-submit) ----------
  const batchClaimed = await claimSendNonce({
    supabase,
    workspaceId,
    nonce: `batch:${input.batchNonce}`,
    claimedBy: session.userId,
  });
  if (!batchClaimed) {
    return emptyResult({
      error: "This send was already submitted. Refresh the page and re-review recipients.",
    });
  }

  // --- Resolve campaign + template + settings + connection ---------------
  const campaign = await repos.campaigns.get(input.campaignId);
  if (!campaign) return emptyResult({ error: "Campaign not found in this workspace." });
  const master = campaign.templateId
    ? (await repos.templates.get(campaign.templateId)) ?? null
    : null;
  const template = resolveCampaignTemplate(campaign, master);
  if (!template) {
    return emptyResult({ error: "This campaign has no template snapshot yet." });
  }

  const [settings, conn, assets, recipients] = await Promise.all([
    repos.settings.get(),
    loadGmailConnection(supabase, workspaceId),
    repos.assets.list(),
    repos.recipients.listByCampaign(input.campaignId),
  ]);
  if (!settings) return emptyResult({ error: "Workspace settings not initialized." });
  if (!conn) return emptyResult({ error: "Gmail is not connected. Reconnect Gmail to continue." });

  const assetsBySlot = Object.fromEntries(assets.map((a) => [a.slot, a]));
  const recipientByBuyerId = new Map(recipients.map((r) => [r.buyerId, r]));

  const alreadySentBuyerIds = await fetchAlreadySentBuyerIds({
    supabase,
    workspaceId,
    campaignId: input.campaignId,
    candidateBuyerIds: uniqueBuyerIds,
  });

  const fromEmail = conn.googleUserEmail;
  const fromName =
    campaign.fromName?.trim() ||
    settings.email.fromName?.trim() ||
    settings.company.companyName ||
    "MDF Exports & Imports";
  const replyTo = campaign.replyTo?.trim() || settings.email.replyTo?.trim() || undefined;

  const outcomes: PerBuyerOutcome[] = [];

  // Sequential loop — first version deliberately does not concurrency-batch.
  for (const buyerId of uniqueBuyerIds) {
    const recipient = recipientByBuyerId.get(buyerId);
    if (!recipient) {
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "blocked",
        error: "Buyer is not part of this campaign.",
      });
      continue;
    }

    const buyer = await repos.buyers.get(buyerId);
    if (!buyer) {
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "blocked",
        error: "Buyer no longer exists in this workspace.",
      });
      continue;
    }

    // Belt-and-suspenders: recheck DB for already-sent (a concurrent send
    // in another tab may have completed between the review screen load
    // and now). fetchAlreadySentBuyerIds already covered the initial view,
    // but we do not trust it as authoritative — the partial-unique index
    // is the DB-side authority; this pre-check just gives a nicer message.
    if (alreadySentBuyerIds.has(buyerId)) {
      outcomes.push({ buyerId, ok: false, skipped: "already-sent" });
      continue;
    }

    if (buyer.suppressed) {
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "blocked",
        error: `Do not contact${buyer.suppressionReason ? ` (${buyer.suppressionReason})` : ""}.`,
      });
      continue;
    }

    const buyerEmail = (buyer.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "blocked",
        error: "Buyer has no valid email on file.",
      });
      continue;
    }

    // Per-buyer claim — prevents two concurrent send loops from both
    // reaching Gmail for the same buyer.
    const claimed = await claimBuyerSend({
      supabase,
      workspaceId,
      campaignId: input.campaignId,
      buyerId,
      claimedBy: session.userId,
    });
    if (!claimed) {
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "claim-taken",
        error: "Another send for this buyer is already in flight.",
      });
      continue;
    }

    // Personalize + render in SEND mode (Base64 forbidden).
    const html = renderEmailHtml({
      template,
      buyer,
      settings,
      assetsBySlot,
      mode: "send",
    });
    const text = renderEmailText({
      template,
      buyer,
      settings,
      assetsBySlot,
    });
    const ctx = buildContext(buyer, campaign.product);
    const subject = personalize(campaign.subject ?? "", ctx);

    // Full preflight on the exact HTML we would hand to Gmail.
    const preflight = fullPreflight({
      campaign: { ...campaign, subject },
      template,
      html,
      text,
      assetsBySlot,
      recipient: buyerEmail,
    });
    if (!preflight.ok) {
      // Release the per-buyer claim so a corrected retry can proceed.
      await releaseBuyerSend({
        supabase,
        workspaceId,
        campaignId: input.campaignId,
        buyerId,
      });
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "blocked",
        error: preflight.blockers.join(" · "),
      });
      continue;
    }

    // BUYER_SEND_ENABLED gate — enforced RIGHT before the Gmail call so
    // the entire preflight/claim path is still exercised during QA.
    if (!isBuyerSendEnabled()) {
      await releaseBuyerSend({
        supabase,
        workspaceId,
        campaignId: input.campaignId,
        buyerId,
      });
      // Audit the refusal so operators see a paper trail even when the
      // gate blocks delivery.
      await recordBuyerSendEvent(supabase, {
        workspaceId,
        campaignId: input.campaignId,
        buyerId,
        recipientEmail: buyerEmail,
        subject,
        fromName,
        ok: false,
        error: "BUYER_SEND_ENABLED is false — production Buyer Send is not enabled on this server.",
        createdBy: session.userId,
      }).catch(() => {
        // Even if the audit insert failed, we still refused the send.
      });
      outcomes.push({
        buyerId,
        ok: false,
        skipped: "blocked",
        error:
          "Production Buyer Send is not enabled on this server. Set BUYER_SEND_ENABLED=true after QA.",
      });
      continue;
    }

    // --- Actually call Gmail --------------------------------------------
    let messageId: string | undefined;
    let threadId: string | undefined;
    let errorMessage: string | undefined;
    let ok = false;
    try {
      const accessToken = await ensureFreshAccessToken(supabase, conn);
      const result = await sendGmailMessage(accessToken, {
        fromEmail,
        fromName,
        to: buyerEmail,
        replyTo,
        subject,
        html,
        text,
      });
      messageId = result.messageId;
      threadId = result.threadId;
      ok = true;
    } catch (e) {
      if (e instanceof GmailApiError) {
        console.warn("[buyer-send] gmail-api-error", { status: e.status });
        errorMessage = e.message;
      } else if (e instanceof Error) {
        console.warn("[buyer-send] error", { message: e.message });
        errorMessage = e.message;
      } else {
        errorMessage = "Gmail rejected the message. Buyer was not contacted.";
      }
    }

    // Always insert an audit row. The partial unique index enforces at DB
    // level that only ONE ok=true row can exist per (workspace, campaign,
    // buyer).
    try {
      await recordBuyerSendEvent(supabase, {
        workspaceId,
        campaignId: input.campaignId,
        buyerId,
        recipientEmail: buyerEmail,
        subject,
        fromName,
        gmailMessageId: messageId,
        gmailThreadId: threadId,
        ok,
        error: errorMessage,
        createdBy: session.userId,
      });
    } catch (e) {
      // Only realistic path: 23505 because a concurrent request also
      // recorded a successful send. Treat conservatively — this send
      // may have succeeded at Gmail; do NOT mark as ok if we cannot
      // audit, but also DO NOT release the per-buyer claim (retaining
      // it prevents any further attempts). Surface as a failure to the
      // operator.
      const msg = e instanceof Error ? e.message : "audit insert failed";
      outcomes.push({
        buyerId,
        ok: false,
        error: `Audit conflict — this buyer may have been sent by another operator. (${msg})`,
      });
      continue;
    }

    if (!ok) {
      // Pre-Gmail claim released so operator can retry; the audit row
      // remains as a failure record.
      await releaseBuyerSend({
        supabase,
        workspaceId,
        campaignId: input.campaignId,
        buyerId,
      });
      outcomes.push({ buyerId, ok: false, error: errorMessage });
      continue;
    }

    // --- After a real Gmail success -------------------------------------
    // Update buyer status only when the transition is safe. Set
    // last_contacted_at unconditionally.
    const successAt = new Date().toISOString();
    const buyerPatch = buyerPatchAfterSuccessfulSend(buyer, successAt);
    if (buyerPatch) {
      try {
        await repos.buyers.update(buyerId, buyerPatch);
      } catch (e) {
        console.warn("[buyer-send] buyer patch failed after successful send", {
          buyerId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    // Mark the campaign recipient contacted.
    try {
      await repos.recipients.update(recipient.id, {
        status: "contacted",
        simulatedSentAt: successAt,
      });
    } catch (e) {
      console.warn("[buyer-send] recipient patch failed after successful send", {
        recipientId: recipient.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    await logActivity(
      repos,
      "buyerSend.sent",
      `Email sent · ${buyer.company || buyerEmail} (Gmail id ${messageId})`,
      { type: "buyer", id: buyerId },
    );

    outcomes.push({
      buyerId,
      ok: true,
      messageId: messageId!,
      threadId: threadId!,
      deliveredTo: buyerEmail,
    });
  }

  // Per-buyer failures also generate activity entries so operators can
  // audit each attempt independently.
  for (const o of outcomes) {
    if (o.ok) continue;
    if (o.skipped === "already-sent") continue;
    await logActivity(
      repos,
      "buyerSend.failed",
      `Email NOT sent · buyer ${o.buyerId}: ${o.error ?? "unknown"}`,
      { type: "buyer", id: o.buyerId },
    );
  }

  revalidatePath(`/campaigns/${input.campaignId}/send`);
  revalidatePath(`/campaigns/${input.campaignId}`);
  revalidatePath("/activity");
  revalidatePath("/buyers");

  const sent = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok && !o.skipped).length;
  const skipped = outcomes.filter((o) => !o.ok && o.skipped).length;

  return { ok: sent > 0 || outcomes.length === 0, outcomes, sent, failed, skipped };
}

function emptyResult(partial: {
  error?: string;
}): SendBuyersResult {
  return { ok: false, error: partial.error, outcomes: [], sent: 0, failed: 0, skipped: 0 };
}
