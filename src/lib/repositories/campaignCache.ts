import "server-only";
import { cache } from "react";
import type { Campaign } from "@/lib/types";
import { serverRepositories } from "./server";

/**
 * MDF Outreach — request-scoped cached campaign getter.
 *
 * Multiple server components in the same request tree (campaign
 * layout.tsx + child page.tsx) previously each awaited
 * `serverRepositories().repos.campaigns.get(id)`, resulting in duplicate
 * Supabase roundtrips per navigation.
 *
 * React 18's `cache()` gives us a per-request memoisation primitive:
 * within one request the underlying function runs at most once per
 * distinct argument. Across requests, each request gets its own fresh
 * cache — no cross-user leakage, RLS still enforced (serverRepositories
 * calls requireMdfSession inside, so the auth check runs; the memo only
 * dedupes the outbound Supabase query).
 *
 * Consumers should call `getCachedCampaign(id)` instead of
 * `repos.campaigns.get(id)` in any server component that a sibling
 * component in the same request tree might ALSO need the campaign for.
 * Layouts + their child pages are the primary case.
 */
export const getCachedCampaign = cache(
  async (id: string): Promise<Campaign | undefined> => {
    const { repos } = await serverRepositories();
    return repos.campaigns.get(id);
  },
);
