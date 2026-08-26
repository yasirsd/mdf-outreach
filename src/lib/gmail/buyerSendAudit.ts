import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the set of buyer_ids in `candidateIds` that already have a
 * successful buyer-send event for `campaignId`. RLS restricts the query
 * to the caller's workspace automatically.
 */
export async function fetchAlreadySentBuyerIds(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  campaignId: string;
  candidateBuyerIds: string[];
}): Promise<Set<string>> {
  if (input.candidateBuyerIds.length === 0) return new Set();
  const { data, error } = await input.supabase
    .from("email_send_events")
    .select("buyer_id")
    .eq("workspace_id", input.workspaceId)
    .eq("campaign_id", input.campaignId)
    .eq("kind", "buyer-send")
    .eq("ok", true)
    .in("buyer_id", input.candidateBuyerIds);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    if (row.buyer_id) set.add(row.buyer_id as string);
  }
  return set;
}

export interface BuyerSendEventInsert {
  workspaceId: string;
  campaignId: string;
  buyerId: string;
  recipientEmail: string;
  subject: string;
  fromName: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  ok: boolean;
  error?: string;
  createdBy: string;
  /** Immutable audit metadata (migration 0012). */
  templateId?: string | null;
  templateVariant?: "signature" | "direct" | null;
  templateVersion?: number | null;
}

/**
 * Insert one buyer-send audit event. Throws on 23505 unique violation
 * (partial unique index) — that means another concurrent request already
 * recorded a successful send for this (workspace, campaign, buyer).
 */
export async function recordBuyerSendEvent(
  supabase: SupabaseClient,
  input: BuyerSendEventInsert,
): Promise<void> {
  const { error } = await supabase.from("email_send_events").insert({
    workspace_id: input.workspaceId,
    campaign_id: input.campaignId,
    buyer_id: input.buyerId,
    render_buyer_id: input.buyerId,
    kind: "buyer-send",
    recipient_email: input.recipientEmail,
    subject: input.subject,
    from_name: input.fromName,
    gmail_message_id: input.gmailMessageId ?? null,
    gmail_thread_id: input.gmailThreadId ?? null,
    ok: input.ok,
    error: input.error ?? null,
    created_by: input.createdBy,
    template_id: input.templateId ?? null,
    template_variant: input.templateVariant ?? null,
    template_version: input.templateVersion ?? null,
  });
  if (error) throw error;
}

/* ---------------------------------------------------------------------------
 * Read helpers used by history panels and delivery-summary aggregations.
 * ------------------------------------------------------------------------- */

export interface BuyerSendHistoryRow {
  id: string;
  createdAt: string;
  campaignId: string | null;
  buyerId: string | null;
  recipientEmail: string;
  subject: string;
  ok: boolean;
  error: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  templateId: string | null;
  templateVariant: "signature" | "direct" | null;
  templateVersion: number | null;
}

/**
 * All buyer-send events for a campaign, newest first. RLS enforces
 * workspace isolation automatically. Non-buyer-send kinds (simulation,
 * gmail-test) are excluded.
 */
export async function fetchSendHistoryForCampaign(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  campaignId: string;
  limit?: number;
}): Promise<BuyerSendHistoryRow[]> {
  const { data, error } = await input.supabase
    .from("email_send_events")
    .select(
      "id, created_at, campaign_id, buyer_id, recipient_email, subject, ok, error, gmail_message_id, gmail_thread_id, template_id, template_variant, template_version",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("campaign_id", input.campaignId)
    .eq("kind", "buyer-send")
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 200);
  if (error) throw error;
  return (data ?? []).map(mapHistoryRow);
}

/**
 * All buyer-send events for a specific buyer across every campaign.
 * Newest first.
 */
export async function fetchSendHistoryForBuyer(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  buyerId: string;
  limit?: number;
}): Promise<BuyerSendHistoryRow[]> {
  const { data, error } = await input.supabase
    .from("email_send_events")
    .select(
      "id, created_at, campaign_id, buyer_id, recipient_email, subject, ok, error, gmail_message_id, gmail_thread_id, template_id, template_variant, template_version",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("buyer_id", input.buyerId)
    .eq("kind", "buyer-send")
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 100);
  if (error) throw error;
  return (data ?? []).map(mapHistoryRow);
}

/**
 * Most-recent SUCCESSFUL buyer-send per buyer across all campaigns.
 * Used by the recipient-review "Previous contact" column.
 */
export async function fetchLastSuccessfulSendPerBuyer(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  candidateBuyerIds: string[];
}): Promise<Map<string, { at: string; campaignId: string | null }>> {
  const out = new Map<string, { at: string; campaignId: string | null }>();
  if (input.candidateBuyerIds.length === 0) return out;
  const { data, error } = await input.supabase
    .from("email_send_events")
    .select("buyer_id, campaign_id, created_at")
    .eq("workspace_id", input.workspaceId)
    .eq("kind", "buyer-send")
    .eq("ok", true)
    .in("buyer_id", input.candidateBuyerIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    const bid = row.buyer_id as string;
    if (!out.has(bid)) {
      out.set(bid, { at: row.created_at as string, campaignId: (row.campaign_id as string) ?? null });
    }
  }
  return out;
}

function mapHistoryRow(r: Record<string, unknown>): BuyerSendHistoryRow {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    campaignId: (r.campaign_id as string) ?? null,
    buyerId: (r.buyer_id as string) ?? null,
    recipientEmail: r.recipient_email as string,
    subject: r.subject as string,
    ok: r.ok as boolean,
    error: (r.error as string) ?? null,
    gmailMessageId: (r.gmail_message_id as string) ?? null,
    gmailThreadId: (r.gmail_thread_id as string) ?? null,
    templateId: (r.template_id as string) ?? null,
    templateVariant: (r.template_variant as "signature" | "direct") ?? null,
    templateVersion: (r.template_version as number) ?? null,
  };
}
