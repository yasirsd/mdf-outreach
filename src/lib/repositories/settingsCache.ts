import "server-only";
import { cache } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { serverRepositories } from "./server";

/**
 * MDF Outreach — request-scoped cached workspace settings getter.
 *
 * Every server component / server action that needs settings would
 * previously each call `repos.settings.get()`, resulting in duplicate
 * one-row selects against `workspace_settings` per request.
 *
 * React 18's `cache()` gives us a per-request memoisation primitive:
 * within one request the underlying function runs at most once. Each
 * new request gets a fresh cache — no cross-user leakage. RLS is
 * still enforced because `serverRepositories()` runs
 * `requireMdfSession()` on each call; only the outbound Supabase
 * query is deduped.
 */
export const getCachedSettings = cache(
  async (): Promise<WorkspaceSettings | undefined> => {
    const { repos } = await serverRepositories();
    return repos.settings.get();
  },
);

/**
 * Same request tree, guaranteed-present workspace settings. Throws
 * with a clear message if the workspace was never bootstrapped.
 */
export async function requireCachedSettings(): Promise<WorkspaceSettings> {
  const settings = await getCachedSettings();
  if (!settings) throw new Error("Workspace settings not initialized.");
  return settings;
}
