import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimSendNonce, releaseSendNonce } from "./idempotency";

/**
 * Per-buyer claim key used by Buyer Send. Stable across attempts so
 * that a concurrent second send for the SAME (campaign, buyer) is
 * rejected at the database layer BEFORE Gmail is called.
 *
 * On successful Gmail delivery the row is kept — that is what prevents
 * a network-level retry from double-delivering.
 * On pre-Gmail failure the row is released so the operator can retry
 * without reloading the page.
 */
export function buyerSendClaimKey(campaignId: string, buyerId: string): string {
  return `buyer:${campaignId}:${buyerId}`;
}

export async function claimBuyerSend(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  campaignId: string;
  buyerId: string;
  claimedBy: string;
}): Promise<boolean> {
  return claimSendNonce({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    nonce: buyerSendClaimKey(input.campaignId, input.buyerId),
    claimedBy: input.claimedBy,
  });
}

export async function releaseBuyerSend(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  campaignId: string;
  buyerId: string;
}): Promise<void> {
  await releaseSendNonce({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    nonce: buyerSendClaimKey(input.campaignId, input.buyerId),
  });
}
