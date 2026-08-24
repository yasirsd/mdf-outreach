import type { SupabaseClient } from "@supabase/supabase-js";

export interface MdfMembership {
  workspaceId: string;
  role: "owner" | "member";
}

export async function getActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<MdfMembership | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, active")
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const role = data.role === "owner" ? "owner" : "member";
  return { workspaceId: data.workspace_id as string, role };
}
