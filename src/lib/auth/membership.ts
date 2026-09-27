import type { SupabaseClient } from "@supabase/supabase-js";

export interface MdfMembership {
  workspaceId: string;
  role: "owner" | "member";
}

export async function hasAnyActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export async function getActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<MdfMembership | null> {
  // `workspaces` is RLS-filtered by mdf.current_workspace_id(). Migration
  // 0028 makes that function resolve only the caller's persisted selection.
  // A missing/invalid selection therefore returns no row and fails closed.
  const { data: selected, error: selectedError } = await supabase
    .from("workspaces")
    .select("id")
    .maybeSingle();

  if (selectedError || !selected?.id) return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, active")
    .eq("user_id", userId)
    .eq("workspace_id", selected.id)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;
  const role = data.role === "owner" ? "owner" : "member";
  return { workspaceId: selected.id as string, role };
}

export async function setCurrentWorkspace(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
): Promise<MdfMembership | null> {
  const { error } = await supabase.rpc("set_current_workspace", {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  return getActiveMembership(supabase, userId);
}
