import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { historicalMigrationSha256 } from "@/test/historicalMigrationHash";
import { serializeProductTradeMappingsSnapshot } from "./product";
import { toSyncRpcPayload } from "./server/writer";

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.resolve(ROOT, relative), "utf8");

const M22 = read("supabase/migrations/0022_market_intelligence_foundation.sql");
const M23 = read("supabase/migrations/0023_market_product_mapping_sync.sql");
const M24 = read("supabase/migrations/0024_market_product_mapping_sync_idempotency_fix.sql");
const PRE24 = read("supabase/tests/preflight_0024_market_product_mapping_sync_idempotency_fix.sql");
const VER24 = read("supabase/tests/verify_0024_market_product_mapping_sync_idempotency_fix.sql");
const REG24 = read("supabase/tests/regression_0024_market_product_mapping_sync_idempotency.sql");

const APPLIED_0022_SHA256 = "EB6BA7077C957664F64F3B8595AB26DFB30953416508A9FB7BBB8CB0147357E3";
const APPLIED_0023_SHA256 = "EEC6892B0C69F8C28B070FD8AEF4CD699961EAF159D94CB2A62A43E70B95BDDA";

function syncBody(sql: string): string {
  return sql.match(
    /create or replace function public\.sync_product_trade_mappings[\s\S]*?end;\s*\$\$;/,
  )?.[0] ?? "";
}

describe("MI1C.2 migration 0024 — idempotent material equality", () => {
  it("does not modify the applied 0022 or 0023 migration snapshots", () => {
    expect(historicalMigrationSha256(M22)).toBe(APPLIED_0022_SHA256);
    expect(historicalMigrationSha256(M23)).toBe(APPLIED_0023_SHA256);
  });

  it("proves the exact bug: fixed-scale numeric text differs while numeric value is equal", () => {
    const payload = toSyncRpcPayload(
      serializeProductTradeMappingsSnapshot({
        now: () => new Date("2026-09-20T00:00:00.000Z"),
      }),
    );
    const wireValues = payload.mappings.map((row) => String(row.weight));
    const persistedValues = wireValues.map((weight) => Number(weight).toFixed(3));

    expect(wireValues).toEqual(["0.6", "1", "0.5", "1", "0.3"]);
    expect(persistedValues).toEqual(["0.600", "1.000", "0.500", "1.000", "0.300"]);
    expect(wireValues.every((wire, index) => wire !== persistedValues[index])).toBe(true);
    expect(wireValues.every((wire, index) => Number(wire) === Number(persistedValues[index]))).toBe(true);
    expect(M23).toMatch(
      /coalesce\(v_existing\.weight::text, ''\)\s*=\s*coalesce\(v_row->>'weight', ''\)/,
    );
  });

  it("replaces only the RPC and compares optional weight as a NULL-safe numeric", () => {
    const body = syncBody(M24);
    expect(body).not.toBe("");
    expect(body).toMatch(
      /v_existing\.weight\s+is not distinct from\s+nullif\(v_row->>'weight', ''\)::numeric/,
    );
    expect(body).not.toMatch(/v_existing\.weight::text/);
    expect(M24).not.toMatch(/\balter\s+table\b/i);
    expect(M24).not.toMatch(/\bcreate\s+table\b/i);
    expect(M24).not.toMatch(/\bdrop\s+(table|function|index|policy)\b/i);
  });

  it("retains the complete material-field contract and excludes bookkeeping timestamps", () => {
    const body = syncBody(M24);
    for (const field of [
      "mapping_kind",
      "mapping_confidence",
      "fit_eligibility",
      "trade_label",
      "scope_description",
      "included_products_note",
      "weight",
      "hs_level",
      "registry_version",
    ]) {
      expect(body).toContain(field);
    }

    const equalityBranch = body.match(/if v_existing\.mapping_kind[\s\S]*?then/)?.[0] ?? "";
    expect(equalityBranch).not.toMatch(/generatedAt|last_synced_at|updated_at|created_at/);
    expect(equalityBranch).toMatch(/coalesce\(v_existing\.registry_version, ''\) = v_registry_version/);
    expect(body).toMatch(/set last_synced_at = v_now\s+where id = v_existing\.id/);
  });

  it("preserves service-role-only execution and the fixed definer search path", () => {
    expect(M24).toMatch(/security definer/);
    expect(M24).toMatch(/set search_path\s*=\s*public,\s*mdf,\s*pg_temp/);
    expect(M24).toMatch(
      /revoke all on function public\.sync_product_trade_mappings\(jsonb\) from public, anon, authenticated/,
    );
    expect(M24).toMatch(
      /grant execute on function public\.sync_product_trade_mappings\(jsonb\) to service_role/,
    );
    expect(M24).not.toMatch(/grant execute[\s\S]{0,100}to authenticated/);
  });

  it("retains full-snapshot deactivate/reactivate semantics without physical DELETE", () => {
    const body = syncBody(M24);
    expect(body).toMatch(/set is_active = false/);
    expect(body).toMatch(/set is_active\s*= true/);
    expect(body).toMatch(/v_reactivated := v_reactivated \+ 1/);
    expect(body).not.toMatch(/delete\s+from\s+public\.product_trade_mappings/i);
  });

  it("ships a rollback-only SQL regression covering create/replay/update/deactivate/reactivate", () => {
    expect(REG24).toMatch(/LOCAL \/ DISPOSABLE DATABASE ONLY/i);
    expect(REG24).toMatch(/begin;/i);
    expect(REG24).toMatch(/rollback;/i);
    expect(REG24).not.toMatch(/commit;/i);
    expect(REG24).not.toMatch(/delete\s+from/i);

    for (const assertion of [
      /'created'\)::int <> 5/,
      /identical replay classification failed/,
      /'unchanged'\)::int <> 5/,
      /single material update classification failed/,
      /'updated'\)::int <> 1/,
      /deactivation classification failed/,
      /'deactivated'\)::int <> 1/,
      /reactivation classification failed/,
      /'reactivated'\)::int <> 1/,
    ]) {
      expect(REG24).toMatch(assertion);
    }
    expect(REG24).toMatch(/v_count <> 5 or v_active_count <> 4/);
    expect(REG24).toMatch(/v_count <> 5 or v_active_count <> 5/);
  });

  it("provides read-only preflight and post-apply verification", () => {
    for (const sql of [PRE24, VER24]) {
      expect(sql).toMatch(/READ-ONLY/i);
      expect(sql).not.toMatch(/^\s*(insert|update|delete|create|alter|drop|grant|revoke)\b/im);
      expect(sql).not.toMatch(/\bselect\s+public\.sync_product_trade_mappings\s*\(/i);
    }
    expect(PRE24).toContain("0023_text_weight_bug_present");
    expect(VER24).toContain("weight_uses_null_safe_numeric_equality");
    expect(VER24).toContain("text_weight_comparator_removed");
  });

  it("does not touch Buyer, BACI, or unrelated Market Intelligence surfaces", () => {
    for (const forbidden of [
      "buyer_candidates",
      "buyers",
      "buyer_finder_candidate_conversions",
      "baci",
      "market_trade_observations",
      "market_product_scores",
      "SUPABASE_SECRET_KEY",
    ]) {
      expect(M24).not.toMatch(new RegExp(forbidden, "i"));
    }
  });
});
