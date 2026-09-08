import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MI1C — migration 0023 static guardrails.
 *
 * 0023 adds only additive lifecycle columns + the SECURITY DEFINER
 * `sync_product_trade_mappings` RPC. It must never touch 0022, never
 * seed rows, and never widen any grant beyond service_role.
 */

const HERE = process.cwd();
const M22 = readFileSync(
  path.resolve(HERE, "supabase/migrations/0022_market_intelligence_foundation.sql"),
  "utf8",
);
const M23 = readFileSync(
  path.resolve(HERE, "supabase/migrations/0023_market_product_mapping_sync.sql"),
  "utf8",
);
const PRE23 = readFileSync(
  path.resolve(HERE, "supabase/tests/preflight_0023_market_product_mapping_sync.sql"),
  "utf8",
);
const VER23 = readFileSync(
  path.resolve(HERE, "supabase/tests/verify_0023_market_product_mapping_sync.sql"),
  "utf8",
);

describe("MI1C migration 0023 — additive lifecycle + sync RPC", () => {
  it("declares 'Does NOT apply itself' and never modifies migration 0022", () => {
    expect(M23).toMatch(/Does NOT apply itself/i);
    // 0022 remains recognisable and unmodified in this workspace.
    expect(M22).toMatch(/MI1B: Market Intelligence database foundation/);
    // 0023 body never references editing 0022 explicitly.
    expect(M23).not.toMatch(/0022_market_intelligence_foundation\.sql/);
  });

  it("wraps changes in a single BEGIN/COMMIT transaction", () => {
    const beginIdx = M23.indexOf("begin;");
    const firstAlter = M23.indexOf("alter table public.product_trade_mappings");
    const notifyIdx = M23.lastIndexOf("notify pgrst");
    const commitIdx = M23.lastIndexOf("commit;");
    expect(beginIdx).toBeGreaterThan(0);
    expect(beginIdx).toBeLessThan(firstAlter);
    expect(notifyIdx).toBeLessThan(commitIdx);
    expect(M23).not.toMatch(/create\s+index\s+concurrently/i);
  });

  it("adds the three lifecycle columns idempotently and constrains registry_version", () => {
    expect(M23).toMatch(/add column if not exists is_active\s+boolean not null default true/);
    expect(M23).toMatch(/add column if not exists last_synced_at\s+timestamptz/);
    expect(M23).toMatch(/add column if not exists registry_version\s+text/);
    expect(M23).toMatch(
      /add constraint product_trade_mappings_registry_version_not_blank[\s\S]{0,200}not valid/,
    );
    // Active-mapping lookup index.
    expect(M23).toContain("product_trade_mappings_active_idx");
    expect(M23).toMatch(/where is_active = true/);
  });

  it("defines the sync RPC as SECURITY DEFINER, fixed search_path, service_role only", () => {
    expect(M23).toContain("create or replace function public.sync_product_trade_mappings(p_input jsonb)");
    expect(M23).toMatch(/security definer/);
    expect(M23).toMatch(/set search_path\s*=\s*public,\s*mdf,\s*pg_temp/);
    expect(M23).toMatch(
      /revoke all on function public\.sync_product_trade_mappings\(jsonb\)[\s\S]{0,80}from public, anon, authenticated/,
    );
    expect(M23).toMatch(
      /grant execute on function public\.sync_product_trade_mappings\(jsonb\)[\s\S]{0,80}to service_role/,
    );
    expect(M23).not.toMatch(
      /grant execute on function public\.sync_product_trade_mappings\(jsonb\)[\s\S]{0,80}to authenticated/,
    );
  });

  it("uses a GLOBAL sync advisory lock — no workspace reference in the lock", () => {
    const body =
      M23.match(/create or replace function public\.sync_product_trade_mappings[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).not.toMatch(/workspace/i);
    expect(body).toMatch(/'mi-product-trade-mapping-sync'/);
  });

  it("requires registryVersion and rejects duplicate identities inside the snapshot", () => {
    const body =
      M23.match(/create or replace function public\.sync_product_trade_mappings[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).toMatch(/registryVersion is required/);
    expect(body).toMatch(/duplicate mapping identity in snapshot/);
  });

  it("history-safe: no physical DELETE; deactivates via is_active=false", () => {
    const body =
      M23.match(/create or replace function public\.sync_product_trade_mappings[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    expect(body).not.toMatch(/delete\s+from\s+public\.product_trade_mappings/i);
    expect(body).toMatch(/set is_active = false/);
    // Reactivation path present.
    expect(body).toMatch(/v_reactivated := v_reactivated \+ 1/);
    // Unchanged branch touches only last_synced_at.
    expect(body).toMatch(/set last_synced_at = v_now\s+where id = v_existing\.id/);
  });

  it("returns useful counts", () => {
    const body =
      M23.match(/create or replace function public\.sync_product_trade_mappings[\s\S]*?end;\s*\$\$;/)?.[0] ?? "";
    for (const key of ["created", "updated", "reactivated", "deactivated", "unchanged", "registryVersion"]) {
      expect(body).toContain(`'${key}'`);
    }
  });

  it("internal per-row validator exists, mirrors the TS bands, and is ungranted", () => {
    expect(M23).toContain("create or replace function mdf.__validate_product_trade_mapping_row");
    expect(M23).toMatch(
      /revoke all on function mdf\.__validate_product_trade_mapping_row\(jsonb\)[\s\S]{0,120}from public, anon, authenticated/,
    );
    // Confidence bands mirror TS validator.
    expect(M23).toMatch(/v_kind = 'exact'[\s\S]{0,120}v_conf < 0\.85[\s\S]{0,80}v_elig <> 'exact'/);
    expect(M23).toMatch(/v_kind = 'proxy'[\s\S]{0,120}v_conf <= 0\.40[\s\S]{0,80}v_conf > 0\.85[\s\S]{0,80}v_elig <> 'proxy_allowed'/);
    expect(M23).toMatch(/v_kind = 'composite'[\s\S]{0,120}v_conf > 0\.40[\s\S]{0,80}v_elig <> 'insufficient_specificity'/);
  });

  it("does NOT seed rows into any table", () => {
    const outsideFunctions = M23.replace(/as\s*\$\$[\s\S]*?\$\$;/g, "");
    expect(outsideFunctions).not.toMatch(/insert into public\.product_trade_mappings/i);
    expect(outsideFunctions).not.toMatch(/insert into public\.market_/i);
  });

  it("does not touch Buyer / BI tables or widen any existing grant", () => {
    for (const table of [
      "buyer_candidates",
      "buyers",
      "buyer_finder_candidate_conversions",
      "buyer_intelligence_sources",
      "buyer_intelligence_claims",
      "buyer_trade_observations",
      "buyer_trade_metrics",
      "buyer_intelligence_assessments",
    ]) {
      expect(M23).not.toMatch(new RegExp(`alter table public\\.${table}\\b`, "i"));
      expect(M23).not.toMatch(new RegExp(`insert into public\\.${table}\\b`, "i"));
      expect(M23).not.toMatch(new RegExp(`update public\\.${table}\\b`, "i"));
    }
    // 0023 does not re-issue any grant on the 0022 mutation RPCs.
    for (const rpc of [
      "ingest_market_intelligence_source",
      "ingest_market_trade_observation",
      "record_market_fetch_result",
      "refresh_market_intelligence",
      "verify_market_intelligence_source",
    ]) {
      expect(M23).not.toMatch(new RegExp(`grant execute on function public\\.${rpc}\\b`, "i"));
      expect(M23).not.toMatch(new RegExp(`revoke all on function public\\.${rpc}\\b`, "i"));
    }
  });
});

describe("MI1C 0023 preflight + verify companions", () => {
  it("preflight is read-only and asserts every collision + boundary check", () => {
    expect(PRE23).toMatch(/READ-ONLY/i);
    expect(PRE23).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(PRE23).not.toMatch(/\bupdate\s+public\./i);
    expect(PRE23).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(PRE23).not.toMatch(/\bcreate\s+(table|function|policy|index)\b/i);
    expect(PRE23).not.toMatch(/\balter\s+table\b/i);
    expect(PRE23).not.toMatch(/\bdrop\s+(table|function|policy|index)\b/i);
    expect(PRE23).not.toMatch(/\brevoke\b|\bgrant\b/i);
    for (const col of ["is_active", "last_synced_at", "registry_version"]) {
      expect(PRE23).toContain(col);
    }
    expect(PRE23).toContain("sync_product_trade_mappings");
    expect(PRE23).toContain("mi_mutation_authenticated_denied");
    expect(PRE23).toContain("mi_mutation_service_role_grant");
  });

  it("verify is read-only and covers every post-apply invariant", () => {
    expect(VER23).toMatch(/READ-ONLY/i);
    expect(VER23).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(VER23).not.toMatch(/\bupdate\s+public\./i);
    expect(VER23).not.toMatch(/\bdelete\s+from\s+public\./i);
    expect(VER23).not.toMatch(/\bcreate\s+(table|function|policy|index)\b/i);
    expect(VER23).not.toMatch(/\balter\s+table\b/i);
    expect(VER23).not.toMatch(/\bdrop\s+(table|function|policy|index)\b/i);
    // grant / revoke may appear inside diagnostic labels (e.g.
    // "service_role missing EXECUTE", "sync_rpc_service_role_grant");
    // only forbid actual DDL statements.
    expect(VER23).not.toMatch(/^\s*revoke\b/im);
    expect(VER23).not.toMatch(/^\s*grant\b/im);
    for (const check of [
      "lifecycle_column_present",
      "sync_rpc_definer",
      "sync_rpc_search_path",
      "sync_rpc_service_role_grant",
      "sync_rpc_authenticated_denied",
      "sync_rpc_anon_denied",
      "0022_mutation_authenticated_denied",
      "0022_mutation_service_role_present",
      "product_trade_mappings_not_seeded",
    ]) {
      expect(VER23).toContain(check);
    }
  });
});
