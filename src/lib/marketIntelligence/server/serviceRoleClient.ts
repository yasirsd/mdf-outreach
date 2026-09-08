import "server-only";

/**
 * MI1C — SERVER-ONLY service-role Supabase client, scoped narrowly to
 * Market Intelligence global writes.
 *
 * This module MUST NEVER:
 *   • be imported by a client component or a `use client` module,
 *   • leak the client or the service-role key outside this file,
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
const SUPABASE_SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";

export class MarketIntelligenceServiceRoleConfigError extends Error {
  constructor(missing: string) {
    super(
      `Market Intelligence service-role client is not configured: ${missing} is missing from the server environment.`,
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
 * configured with the service-role key.
 */
export function getMarketIntelligenceServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env[SUPABASE_URL_ENV];
  const key = process.env[SUPABASE_SERVICE_ROLE_ENV];
  if (!url) throw new MarketIntelligenceServiceRoleConfigError(SUPABASE_URL_ENV);
  if (!key) throw new MarketIntelligenceServiceRoleConfigError(SUPABASE_SERVICE_ROLE_ENV);
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
