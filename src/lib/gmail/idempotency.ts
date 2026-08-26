import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cross-instance send idempotency backed by Postgres.
 *
 * The `email_send_idempotency` table has a composite primary key on
 * (workspace_id, nonce). We attempt a single INSERT — if it succeeds
 * this instance owns the nonce; if it raises the unique-constraint
 * error a concurrent request already claimed it and this caller MUST
 * NOT proceed to Gmail. The atomicity is provided by Postgres.
 *
 * The in-memory guard that used to live here was insufficient because
 * on Vercel two concurrent requests can hit different function
 * instances and both pass the memory check.
 */
export interface ClaimSendNonceInput {
  supabase: SupabaseClient;
  workspaceId: string;
  nonce: string;
  claimedBy: string;
}

export async function claimSendNonce(input: ClaimSendNonceInput): Promise<boolean> {
  const { supabase, workspaceId, nonce, claimedBy } = input;
  if (!nonce || typeof nonce !== "string") return false;
  if (nonce.length > 128) return false;

  const { error } = await supabase.from("email_send_idempotency").insert({
    workspace_id: workspaceId,
    nonce,
    claimed_by: claimedBy,
  });
  if (!error) return true;

  // Postgres 23505 = unique_violation → someone else already claimed
  // this nonce. That is the ONLY expected "not-first-claim" path;
  // any other error is a real failure the caller should hear about.
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  if (code === "23505" || /duplicate key/i.test(message)) return false;

  throw error;
}

/**
 * Release a claim. Called when we would like a nonce to be re-usable —
 * e.g. after a validation failure BEFORE Gmail was actually called —
 * so the operator doesn't have to reload the page.
 *
 * Never called after a real Gmail send: retaining the row is exactly
 * what prevents duplicate deliveries if a network retry replays the
 * request.
 */
export async function releaseSendNonce(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  nonce: string;
}): Promise<void> {
  await input.supabase
    .from("email_send_idempotency")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("nonce", input.nonce);
}
