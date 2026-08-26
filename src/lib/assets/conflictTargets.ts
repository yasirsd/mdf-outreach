/**
 * Single source of truth for Supabase `onConflict` targets used by asset
 * upserts. Kept as constants so the repository, the database migration,
 * and the regression tests all reference the same string and cannot
 * drift silently.
 *
 * If you change this value, you MUST also:
 *   1. Update the corresponding unique index in supabase/migrations/,
 *   2. Update the regression test in
 *      src/lib/repositories/supabase/repositories.assets.test.ts.
 */
export const EMAIL_ASSET_CONFLICT_TARGET = "workspace_id,theme_key,slot";
