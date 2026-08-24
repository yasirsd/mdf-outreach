import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseRepositoryBundle } from "@/lib/repositories/supabase/repositories";

/**
 * Server-side activity logger. Server actions call this after any state
 * change. Uses the request-scoped repository bundle so writes go into the
 * caller's workspace (RLS enforced).
 */
export async function logActivity(
  repos: SupabaseRepositoryBundle,
  kind: string,
  message: string,
  entity?: { type: string; id: string },
): Promise<void> {
  try {
    await repos.activity.add({
      id: randomUUID(),
      at: new Date().toISOString(),
      kind,
      message,
      entity,
    });
  } catch {
    // Activity logging must never break the primary write.
  }
}
