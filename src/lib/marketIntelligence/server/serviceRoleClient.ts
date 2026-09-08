import "server-only";

/**
 * MI1C — SERVER-ONLY service-role Supabase client, scoped narrowly to
 * Market Intelligence global writes.
 *
 * "ServiceRole" names the PostgreSQL privilege role used by the RPCs.
 * The preferred and only supported credential is Supabase's modern Secret
 * API Key (`sb_secret_...`) read from `SUPABASE_SECRET_KEY`. MDF never
 * provisioned the planned legacy JWT service-role key, so this boundary
 * deliberately has no `SUPABASE_SERVICE_ROLE_KEY` compatibility fallback.
 *
 * This module MUST NEVER:
 *   • be imported by a client component or a `use client` module,
 *   • leak the client or Secret API Key outside this file,
 *   • be exported as a generic admin repository,
 *   • be reused for anything other than the five MI mutation RPCs
 *     (or the MI1C sync RPC introduced in migration 0023).
 *
 * The `import "server-only"` directive above hard-fails a build if a
 * browser bundle ever pulls this file in. That is the primary
 * enforcement; the tests in `serviceRoleClient.test.ts` prove the
 * key never appears in returned values or logs.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Environment variable name — never exported through NEXT_PUBLIC_. */
const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_SECRET_KEY_ENV = "SUPABASE_SECRET_KEY";
const SUPABASE_SECRET_KEY_PREFIX = "sb_secret_";

export class MarketIntelligenceServiceRoleConfigError extends Error {
  constructor(variableName: string, issue: "missing" | "invalid" = "missing") {
    super(
      `Market Intelligence service-role client is not configured: ${variableName} is ${issue} in the server environment.`,
    );
    this.name = "MarketIntelligenceServiceRoleConfigError";
  }
}

// Module-scoped so a warm server keeps one client. Never exported.
let cached: SupabaseClient | undefined;

/**
 * MI1C server-only accessor. Fails closed on missing configuration.
 * Callers MUST be the MI writer (in this same server folder).
 * Session verification is the caller's responsibility — this function
 * does not check who the operator is, only that the runtime is
 * configured with a Secret API Key that authenticates as the PostgreSQL
 * `service_role`. The key is never accepted from request input or returned.
 */
export function getMarketIntelligenceServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env[SUPABASE_URL_ENV]?.trim();
  const key = process.env[SUPABASE_SECRET_KEY_ENV]?.trim();
  if (!url) throw new MarketIntelligenceServiceRoleConfigError(SUPABASE_URL_ENV);
  if (!key) throw new MarketIntelligenceServiceRoleConfigError(SUPABASE_SECRET_KEY_ENV);
  // Fail closed for publishable, legacy JWT, anonymous, malformed, or any
  // other credential shape. Elevated MI writes accept only modern Secret
  // API Keys; they never fall back to an authenticated/anon browser client.
  if (!key.startsWith(SUPABASE_SECRET_KEY_PREFIX) || key.length === SUPABASE_SECRET_KEY_PREFIX.length) {
    throw new MarketIntelligenceServiceRoleConfigError(SUPABASE_SECRET_KEY_ENV, "invalid");
  }
  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      // No caller-controlled headers. No custom fetch. Nothing that
      // could echo the key back into a response or log.
      headers: { "X-Client-Info": "mdf-outreach-mi-server-writer" },
    },
  });
  return cached;
}

/** Test-only reset hook. Not exported to production callers. */
export function __resetMarketIntelligenceServiceRoleClientForTests(): void {
  cached = undefined;
}
