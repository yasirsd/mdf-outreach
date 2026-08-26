import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptString, encryptString, type EncryptedField } from "./crypto";
import {
  GMAIL_SEND_SCOPE,
  requireGoogleClientId,
  requireGoogleClientSecret,
} from "./config";

export interface GmailConnectionRecord {
  workspaceId: string;
  googleUserEmail: string;
  accessToken: string;
  refreshToken?: string;
  scope: string;
  expiryAt: string;
}

export async function loadGmailConnection(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<GmailConnectionRecord | null> {
  const { data, error } = await supabase
    .from("gmail_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  const decode = (c: string | null, iv: string | null, tag: string | null): string | undefined => {
    if (!c || !iv || !tag) return undefined;
    try {
      return decryptString({ ciphertext: c, iv, tag });
    } catch {
      return undefined;
    }
  };
  const accessToken = decode(data.access_token_ciphertext, data.access_token_iv, data.access_token_tag);
  const refreshToken = decode(
    data.refresh_token_ciphertext,
    data.refresh_token_iv,
    data.refresh_token_tag,
  );
  if (!accessToken) return null;
  return {
    workspaceId,
    googleUserEmail: data.google_user_email,
    accessToken,
    refreshToken,
    scope: data.scope,
    expiryAt: data.expiry_at,
  };
}

export async function saveGmailConnection(
  supabase: SupabaseClient,
  args: {
    workspaceId: string;
    googleUserEmail: string;
    accessToken: string;
    refreshToken?: string;
    scope: string;
    expiryAt: string;
    connectedBy: string;
  },
): Promise<void> {
  const acc = encryptString(args.accessToken);
  const ref = args.refreshToken ? encryptString(args.refreshToken) : null;
  const row = {
    workspace_id: args.workspaceId,
    google_user_email: args.googleUserEmail,
    access_token_ciphertext: acc.ciphertext,
    access_token_iv: acc.iv,
    access_token_tag: acc.tag,
    refresh_token_ciphertext: ref?.ciphertext ?? null,
    refresh_token_iv: ref?.iv ?? null,
    refresh_token_tag: ref?.tag ?? null,
    scope: args.scope,
    expiry_at: args.expiryAt,
    connected_by: args.connectedBy,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("gmail_connections")
    .upsert(row, { onConflict: "workspace_id" });
  if (error) throw error;
}

/** Update just the access token + expiry after a refresh. */
export async function updateAccessToken(
  supabase: SupabaseClient,
  workspaceId: string,
  accessToken: string,
  expiryAt: string,
): Promise<void> {
  const acc = encryptString(accessToken);
  await supabase
    .from("gmail_connections")
    .update({
      access_token_ciphertext: acc.ciphertext,
      access_token_iv: acc.iv,
      access_token_tag: acc.tag,
      expiry_at: expiryAt,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
}

export async function deleteGmailConnection(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  await supabase.from("gmail_connections").delete().eq("workspace_id", workspaceId);
}

/**
 * Return a currently-valid access token, refreshing via the refresh
 * token when the stored access token has expired (with a 60s buffer).
 */
export async function ensureFreshAccessToken(
  supabase: SupabaseClient,
  conn: GmailConnectionRecord,
): Promise<string> {
  const now = Date.now();
  const expiryMs = new Date(conn.expiryAt).getTime();
  if (expiryMs - now > 60_000) return conn.accessToken;
  if (!conn.refreshToken) {
    throw new Error("Gmail connection expired and no refresh token is available. Reconnect Gmail to continue.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
      client_id: requireGoogleClientId(),
      client_secret: requireGoogleClientSecret(),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google refused to refresh the Gmail access token. Reconnect Gmail to continue. (${res.status})${text ? `: ${text}` : ""}`,
    );
  }
  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };
  const nextExpiry = new Date(now + body.expires_in * 1000).toISOString();
  await updateAccessToken(supabase, conn.workspaceId, body.access_token, nextExpiry);
  return body.access_token;
}

export { GMAIL_SEND_SCOPE };
export type { EncryptedField };
