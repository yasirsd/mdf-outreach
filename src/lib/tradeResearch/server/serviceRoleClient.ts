import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SECRET_ENV = "SUPABASE_SECRET_KEY";
let cached: SupabaseClient | undefined;

export class TradeResearchServiceRoleConfigError extends Error {
  constructor(variable: string) {
    super(`Trade research server writer is not configured: ${variable}.`);
    this.name = "TradeResearchServiceRoleConfigError";
  }
}

export function getTradeResearchServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env[URL_ENV]?.trim();
  const key = process.env[SECRET_ENV]?.trim();
  if (!url) throw new TradeResearchServiceRoleConfigError(URL_ENV);
  if (!key?.startsWith("sb_secret_") || key.length === "sb_secret_".length) {
    throw new TradeResearchServiceRoleConfigError(SECRET_ENV);
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "mdf-outreach-trade-research-worker" } },
  });
  return cached;
}

export function __resetTradeResearchServiceRoleClientForTests(): void { cached = undefined; }

