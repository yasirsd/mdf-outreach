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
import { claimSendNonce, releaseSendNonce } from "@/lib/gmail/idempotency";
import { personalize, buildContext } from "@/lib/email/personalize";

export interface GmailPreflightRequest {
  campaignId: string;
  renderBuyerId?: string;
  recipient: string;
}

export interface GmailPreflightResponse {
  ok: boolean;
  blockers: string[];
  from?: { email: string; name: string };
  subject?: string;
  renderedTextPreview?: string;
}

async function loadCampaignBundle(campaignId: string, renderBuyerId?: string) {
  const { repos } = await serverRepositories();
  const campaign = await repos.campaigns.get(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  const master = campaign.templateId
    ? (await repos.templates.get(campaign.templateId)) ?? null
    : null;
  const template = resolveCampaignTemplate(campaign, master);
  const [assets, buyer] = await Promise.all([
    repos.assets.list(),
    renderBuyerId ? repos.buyers.get(renderBuyerId) : Promise.resolve(undefined),
  ]);
  const assetsBySlot = Object.fromEntries(assets.map((a) => [a.slot, a]));
  return { campaign, template, buyer: buyer ?? null, assetsBySlot, repos };
}

async function isApprovedTestRecipient(recipient: string): Promise<boolean> {
  const client = createClient(cookies());
  const { data } = await client
    .from("email_test_recipients")
    .select("id")
    .ilike("email", recipient)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function gmailPreflightAction(
  input: GmailPreflightRequest,
): Promise<GmailPreflightResponse> {
  const { session } = await serverRepositories();
  const supabase = createClient(cookies());
  const conn = await loadGmailConnection(supabase, session.membership.workspaceId);

  const bundle = await loadCampaignBundle(input.campaignId, input.renderBuyerId);
  const blockers: string[] = [];

  if (!conn) blockers.push("Gmail is not connected. Connect Gmail from Settings → Email.");
  if (!(await isApprovedTestRecipient(input.recipient))) {
    blockers.push("Test recipient is not approved. Add it in Settings → Email first.");
  }

  const html = bundle.template
    ? renderEmailHtml({
        template: bundle.template,
        buyer: bundle.buyer,
        settings: (await getWorkspaceSettingsOrThrow()).settings,
        assetsBySlot: bundle.assetsBySlot,
        mode: "send",
        campaign: bundle.campaign,
      })
    : "";
  const text = bundle.template
    ? renderEmailText({
        template: bundle.template,
        buyer: bundle.buyer,
        settings: (await getWorkspaceSettingsOrThrow()).settings,
        assetsBySlot: bundle.assetsBySlot,
        campaign: bundle.campaign,
      })
    : "";
  const ctx = buildContext(bundle.buyer, bundle.campaign.product);
  const subject = personalize(bundle.campaign.subject ?? "", ctx);

  const inner = fullPreflight({
    campaign: bundle.campaign,
    template: bundle.template,
    html,
    text,
    assetsBySlot: bundle.assetsBySlot,
    recipient: input.recipient,
  });
  for (const b of inner.blockers) blockers.push(b);

  return {
    ok: blockers.length === 0,
    blockers,
    from: conn ? { email: conn.googleUserEmail, name: bundle.campaign.fromName || "" } : undefined,
    subject,
    renderedTextPreview: text.slice(0, 400),
  };
}

async function getWorkspaceSettingsOrThrow() {
  const { repos } = await serverRepositories();
  const settings = await repos.settings.get();
  if (!settings) throw new Error("Workspace settings not initialized.");
  return { settings };
}

export interface GmailTestSendRequest {
  campaignId: string;
  renderBuyerId?: string;
  recipient: string;
  /** Client-generated nonce to guard against duplicate submits. */
  nonce: string;
}

export interface GmailTestSendResult {
  ok: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  deliveredTo?: string;
}

export async function sendGmailTestAction(
  input: GmailTestSendRequest,
): Promise<GmailTestSendResult> {
  const { session, repos } = await serverRepositories();
  const supabase = createClient(cookies());

  if (!input.nonce || typeof input.nonce !== "string") {
    return { ok: false, error: "Missing send nonce." };
  }
  // Atomic DB claim — safe across Vercel instances / concurrent invocations.
  const claimed = await claimSendNonce({
    supabase,
    workspaceId: session.membership.workspaceId,
    nonce: input.nonce,
    claimedBy: session.userId,
  });
  if (!claimed) {
    return {
      ok: false,
      error: "This send was already submitted. Refresh the page to send again.",
    };
  }

  // Helper: release the nonce so the operator can retry immediately
  // AFTER fixing a pre-Gmail blocker. Never called after the actual
  // Gmail send — retaining the row is what prevents duplicate deliveries.
  const releaseAndReturn = async (result: GmailTestSendResult) => {
    await releaseSendNonce({
      supabase,
      workspaceId: session.membership.workspaceId,
      nonce: input.nonce,
    });
    return result;
  };

  const conn = await loadGmailConnection(supabase, session.membership.workspaceId);
  if (!conn) {
    return releaseAndReturn({
      ok: false,
      error: "Gmail is not connected. Reconnect Gmail to continue.",
    });
  }

  // Test-recipient allowlist is enforced SERVER-SIDE. The browser
  // cannot bypass this by editing the request.
  if (!(await isApprovedTestRecipient(input.recipient))) {
    return releaseAndReturn({ ok: false, error: "Test recipient is not approved." });
  }

  const bundle = await loadCampaignBundle(input.campaignId, input.renderBuyerId);
  if (!bundle.template) {
    return releaseAndReturn({
      ok: false,
      error: "This campaign has no template snapshot yet.",
    });
  }
  const settings = (await getWorkspaceSettingsOrThrow()).settings;

  const html = renderEmailHtml({
    template: bundle.template,
    buyer: bundle.buyer,
    settings,
    assetsBySlot: bundle.assetsBySlot,
    mode: "send",
    campaign: bundle.campaign,
  });
  const text = renderEmailText({
    template: bundle.template,
    buyer: bundle.buyer,
    settings,
    assetsBySlot: bundle.assetsBySlot,
    campaign: bundle.campaign,
  });
  const ctx = buildContext(bundle.buyer, bundle.campaign.product);
  const subject = personalize(bundle.campaign.subject ?? "", ctx);

  const preflight = fullPreflight({
    campaign: bundle.campaign,
    template: bundle.template,
    html,
    text,
    assetsBySlot: bundle.assetsBySlot,
    recipient: input.recipient,
  });
  if (!preflight.ok) {
    return releaseAndReturn({
      ok: false,
      error: preflight.blockers.join(" · "),
    });
  }

  const fromEmail = conn.googleUserEmail;
  const fromName =
    bundle.campaign.fromName?.trim() ||
    settings.email.fromName?.trim() ||
    settings.company.companyName ||
    "MDF Exports & Imports";
  const replyTo = bundle.campaign.replyTo?.trim() || settings.email.replyTo?.trim() || undefined;

  let messageId: string | undefined;
  let threadId: string | undefined;
  let errorMessage: string | undefined;
  let ok = false;

  try {
    const accessToken = await ensureFreshAccessToken(supabase, conn);
    const result = await sendGmailMessage(accessToken, {
      fromEmail,
      fromName,
      to: input.recipient,
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
      console.warn("[gmail.send] api-error", { status: e.status, detail: e.detail });
      errorMessage = e.message;
    } else if (e instanceof Error) {
      console.warn("[gmail.send] error", { message: e.message });
      errorMessage = e.message;
    } else {
      errorMessage = "Gmail rejected the message. No buyer was contacted.";
    }
  }

  // Audit — always record, success OR failure. Buyer.status is NEVER
  // modified for a Gmail test send.
  await supabase.from("email_send_events").insert({
    workspace_id: session.membership.workspaceId,
    campaign_id: bundle.campaign.id,
    buyer_id: null, // never the actual campaign buyer for a test
    render_buyer_id: bundle.buyer?.id ?? null,
    kind: "gmail-test",
    recipient_email: input.recipient,
    subject,
    from_name: fromName,
    gmail_message_id: messageId ?? null,
    gmail_thread_id: threadId ?? null,
    ok,
    error: errorMessage ?? null,
    created_by: session.userId,
  });

  await logActivity(
    repos,
    ok ? "email.testSent" : "email.testFailed",
    ok
      ? `Test email delivered to ${input.recipient} (Gmail id ${messageId ?? "?"})`
      : `Test email FAILED to ${input.recipient}: ${errorMessage ?? ""}`,
    { type: "campaign", id: bundle.campaign.id },
  );

  revalidatePath(`/campaigns/${bundle.campaign.id}/send`);
  revalidatePath("/activity");

  return {
    ok,
    messageId,
    threadId,
    error: errorMessage,
    deliveredTo: ok ? input.recipient : undefined,
  };
}
