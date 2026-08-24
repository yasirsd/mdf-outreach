import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { requireMdfSession, type MdfSession } from "@/lib/auth/require";
import {
  createSupabaseRepositories,
  type SupabaseRepositoryBundle,
} from "./supabase/repositories";

/**
 * Server-only factory. Every server component / server action / route
 * handler that touches business data calls this. It:
 *   1. Verifies auth + app-session + MDF workspace membership.
 *   2. Returns a request-scoped Supabase client + repository bundle
 *      pinned to the caller's workspace_id.
 *
 * Never trust workspace_id supplied by the browser — it comes from the
 * server-authorized membership resolution here.
 */
export async function serverRepositories(): Promise<{
  session: MdfSession;
  repos: SupabaseRepositoryBundle;
}> {
  const session = await requireMdfSession();
  const supabase = createClient(cookies());
  const repos = createSupabaseRepositories(supabase, session.membership.workspaceId);
  return { session, repos };
}
