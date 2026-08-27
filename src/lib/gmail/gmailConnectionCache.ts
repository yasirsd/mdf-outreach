import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { serverRepositories } from "@/lib/repositories/server";
import { createClient } from "@/utils/supabase/server";
import { loadGmailConnection, type GmailConnectionRecord } from "./tokens";

/**
 * MDF Outreach — request-scoped cached Gmail connection.
 *
 * The Send page previously loaded the Gmail connection twice (once
 * for the summary card, once inside the Buyer Send bundle). This
 * caches per request while preserving RLS (loadGmailConnection runs
 * through a request-scoped Supabase client with authenticated cookies).
 *
 * Never call this outside a server request context — no argument
 * accepted so the cache key is trivial; the underlying resolution
 * always uses the CURRENT session's workspace.
 */
export const getCachedGmailConnection = cache(
  async (): Promise<GmailConnectionRecord | null> => {
    const { session } = await serverRepositories();
    const supabase = createClient(cookies());
    return loadGmailConnection(supabase, session.membership.workspaceId);
  },
);
