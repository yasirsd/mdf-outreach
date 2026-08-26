import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EMAIL_ASSET_CONFLICT_TARGET } from "./conflictTargets";

const REPOSITORIES_TS = readFileSync(
  "src/lib/repositories/supabase/repositories.ts",
  "utf8",
);
const MIGRATION_0007 = readFileSync(
  "supabase/migrations/0007_fix_email_asset_upsert_index.sql",
  "utf8",
);

/**
 * These tests exist because of the 42P10 incident where the repository
 * upsert used `workspace_id,theme_key,slot` but the DB unique index was
 * partial (`WHERE theme_key IS NOT NULL`), which Postgres could not
 * infer against a plain conflict target. The three sources of truth
 * (repository code, DB migration, and constant) must always agree —
 * these tests fail loudly if any drifts.
 */
describe("email-asset upsert conflict target (drift protection)", () => {
  it("is the columns we expect", () => {
    expect(EMAIL_ASSET_CONFLICT_TARGET).toBe("workspace_id,theme_key,slot");
  });

  it("Supabase asset repository consumes the shared constant, not a hard-coded string", () => {
    // The repository imports and uses the constant. We assert BOTH:
    //   - the import exists
    //   - no other file inside the repository still hard-codes the raw
    //     three-column string with theme_key
    expect(REPOSITORIES_TS).toContain('EMAIL_ASSET_CONFLICT_TARGET');
    expect(REPOSITORIES_TS).toContain('from "@/lib/assets/conflictTargets"');
    // No lingering raw literal for the asset conflict target.
    expect(REPOSITORIES_TS).not.toMatch(
      /onConflict\s*:\s*"workspace_id,\s*theme_key,\s*slot"/,
    );
  });

  it("migration 0007 recreates the DB index over exactly those columns as a PLAIN unique index", () => {
    expect(MIGRATION_0007).toMatch(
      /create\s+unique\s+index[^;]*email_assets_workspace_theme_slot_unique_idx[^;]*\(\s*workspace_id\s*,\s*theme_key\s*,\s*slot\s*\)/is,
    );
    // The bug was a partial unique index. Assert the new one is NOT partial.
    // Split "where" filters may appear inside a comment block, so guard the
    // check to the CREATE statement itself.
    const createBlock =
      MIGRATION_0007
        .split(/;\s*/)
        .find((s) => /create\s+unique\s+index/i.test(s)) ?? "";
    expect(createBlock).toMatch(/workspace_id\s*,\s*theme_key\s*,\s*slot/i);
    expect(createBlock).not.toMatch(/\bwhere\b/i);
  });

  it("migration 0007 drops the previous partial index before recreating", () => {
    expect(MIGRATION_0007).toMatch(
      /drop\s+index\s+if\s+exists[^;]*email_assets_workspace_theme_slot_unique_idx/i,
    );
  });

  it("migration 0007 notifies PostgREST so the schema cache reloads", () => {
    expect(MIGRATION_0007).toMatch(/notify\s+pgrst\s*,\s*'reload schema'/i);
  });
});
