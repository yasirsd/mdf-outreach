"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { serverRepositories } from "@/lib/repositories/server";
import { createClient } from "@/utils/supabase/server";
import { logActivity } from "@/lib/activity";
import {
  deleteGmailConnection,
  loadGmailConnection,
} from "@/lib/gmail/tokens";

export interface GmailConnectionSummary {
  connected: boolean;
  email?: string;
  scope?: string;
  expiryAt?: string;
}

/**
 * Public status shape — deliberately excludes any token material.
 * Never return access/refresh tokens to the client.
 */
export async function getGmailConnectionSummaryAction(): Promise<GmailConnectionSummary> {
  const { session } = await serverRepositories();
  const supabase = createClient(cookies());
  const conn = await loadGmailConnection(supabase, session.membership.workspaceId);
  if (!conn) return { connected: false };
  return {
    connected: true,
    email: conn.googleUserEmail,
    scope: conn.scope,
    expiryAt: conn.expiryAt,
  };
}

export async function disconnectGmailAction(): Promise<void> {
  const { session, repos } = await serverRepositories();
  const supabase = createClient(cookies());
  await deleteGmailConnection(supabase, session.membership.workspaceId);
  await logActivity(repos, "gmail.disconnected", "Gmail sender disconnected");
  revalidatePath("/settings");
}

export interface TestRecipient {
  id: string;
  email: string;
  label?: string;
}

export async function listTestRecipientsAction(): Promise<TestRecipient[]> {
  const { repos } = await serverRepositories();
  const supabase = (repos as unknown as { supabase?: never }).supabase; // unused reference guard
  void supabase;
  const client = createClient(cookies());
  const { data, error } = await client
    .from("email_test_recipients")
    .select("id, email, label")
    .order("email");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, email: r.email, label: r.label ?? undefined }));
}

export async function addTestRecipientAction(email: string, label?: string): Promise<TestRecipient> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new Error("Please enter a valid email address.");
  }
  const { session, repos } = await serverRepositories();
  const client = createClient(cookies());
  const { data, error } = await client
    .from("email_test_recipients")
    .insert({
      workspace_id: session.membership.workspaceId,
      email: clean,
      label: label?.trim() || null,
      created_by: session.userId,
    })
    .select("id, email, label")
    .single();
  if (error) {
    if (/duplicate key/i.test(error.message)) {
      throw new Error("That address is already an approved test recipient.");
    }
    throw new Error("Could not add test recipient.");
  }
  await logActivity(repos, "gmail.testRecipient.added", `Added test recipient ${clean}`);
  revalidatePath("/settings");
  return { id: data.id, email: data.email, label: data.label ?? undefined };
}

export async function removeTestRecipientAction(id: string): Promise<void> {
  const { repos } = await serverRepositories();
  const client = createClient(cookies());
  const { error } = await client.from("email_test_recipients").delete().eq("id", id);
  if (error) throw new Error("Could not remove test recipient.");
  await logActivity(repos, "gmail.testRecipient.removed", `Removed test recipient`);
  revalidatePath("/settings");
}
