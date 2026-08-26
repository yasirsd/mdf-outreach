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
  });
  if (error) throw error;
}
