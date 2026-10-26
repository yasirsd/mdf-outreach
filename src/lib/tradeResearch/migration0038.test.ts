import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const M36 = "0036_trade_research_thai_manual_evidence_lookup.sql";
const M37 = "0037_trade_research_supabase_cron.sql";
const M38 = "0038_trade_research_thai_manual_evidence_lock_inline.sql";

function readMigration(name: string): string {
  return readFileSync(path.resolve(MIGRATIONS_DIR, name), "utf8");
}

function statements(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function plpgsqlBody(sql: string, functionName: string): string {
  const header = `create or replace function ${functionName}`;
  const start = sql.toLowerCase().indexOf(header.toLowerCase());
  if (start < 0) throw new Error(`missing ${functionName}`);
  const asIdx = sql.indexOf("as $$", start);
  if (asIdx < 0) throw new Error(`missing as $$ for ${functionName}`);
  const endIdx = sql.indexOf("end $$", asIdx);
  if (endIdx < 0) throw new Error(`missing end $$ for ${functionName}`);
  return sql.slice(asIdx + "as $$".length, endIdx);
}

function sqlHelperBody(sql: string): string {
  const header = "create or replace function mdf.__thai_manual_evidence_lock_key";
  const start = sql.indexOf(header);
  if (start < 0) throw new Error("missing 0036 lock-key helper");
  const asIdx = sql.indexOf("as $$", start);
  const endIdx = sql.indexOf("$$;", asIdx + 5);
  return sql.slice(asIdx + "as $$".length, endIdx);
}

function normalizeSqlExpr(expr: string): string {
  return expr.replace(/\s+/g, " ").trim().replace(/;$/, "");
}

function extractLockKeyExpression(sqlFragment: string): string {
  const match = sqlFragment.match(
    /\('x'\s*\|\|\s*substr\(\s*md5\(p_workspace_id::text\s*\|\|\s*'\|'\s*\|\|\s*p_candidate_id::text\s*\|\|\s*'\|'\s*\|\|\s*p_provider_id\)\s*,\s*1,\s*16\s*\)\)::bit\(64\)::bigint/i,
  );
  if (!match) throw new Error(`lock-key expression not found in:\n${sqlFragment}`);
  return normalizeSqlExpr(match[0]);
}

/** Replica of the 0036 helper: md5 → first 16 hex chars → signed int64. */
function lockKeyReplica(workspaceId: string, candidateId: string, providerId: string): bigint {
  const hex = createHash("md5")
    .update(`${workspaceId}|${candidateId}|${providerId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  const unsigned = BigInt(`0x${hex}`);
  return unsigned >= 1n << 63n ? unsigned - (1n << 64n) : unsigned;
}

const sql36 = readMigration(M36);
const sql38 = readMigration(M38);
const active38 = statements(sql38);
const createBody = plpgsqlBody(sql38, "public.create_thai_manual_evidence");
const supersedeBody = plpgsqlBody(sql38, "public.supersede_thai_manual_evidence");
const helperExpr = extractLockKeyExpression(sqlHelperBody(sql36));
const createExpr = extractLockKeyExpression(createBody);
const supersedeExpr = extractLockKeyExpression(supersedeBody);

describe("TH07 42501 repair — migration 0038 exists after 0037", () => {
  it("adds 0038 after 0037 and does not edit 0034–0037", () => {
    const names = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort();
    expect(names).toContain(M36);
    expect(names).toContain(M37);
    expect(names).toContain(M38);
    expect(names.indexOf(M38)).toBeGreaterThan(names.indexOf(M37));
    expect(M38.startsWith("0038_")).toBe(true);
    expect(sql36).toContain("mdf.__thai_manual_evidence_lock_key");
    expect(readMigration("0037_trade_research_supabase_cron.sql")).toContain("pg_cron");
  });
});

describe("TH07 42501 repair — RPC contract (SECURITY INVOKER, no mdf lookup)", () => {
  it("create_thai_manual_evidence remains SECURITY INVOKER with search_path=''", () => {
    expect(active38).toMatch(
      /create or replace function public\.create_thai_manual_evidence\([\s\S]*?language plpgsql\s+security invoker\s+set search_path = ''/i,
    );
    expect(createBody).toMatch(/pg_advisory_xact_lock/);
  });

  it("supersede_thai_manual_evidence remains SECURITY INVOKER with search_path=''", () => {
    expect(active38).toMatch(
      /create or replace function public\.supersede_thai_manual_evidence\([\s\S]*?language plpgsql\s+security invoker\s+set search_path = ''/i,
    );
    expect(supersedeBody).toMatch(/pg_advisory_xact_lock/);
  });

  it("neither RPC body names the 0036 helper or any other mdf. object", () => {
    for (const body of [createBody, supersedeBody]) {
      expect(body).not.toContain("mdf.__thai_manual_evidence_lock_key");
      expect(body).not.toMatch(/\bmdf\./);
    }
  });

  it("does not switch either RPC to SECURITY DEFINER", () => {
    expect(active38).not.toMatch(/security\s+definer/i);
  });
});

describe("TH07 42501 repair — privileges stay least-privilege", () => {
  it("EXECUTE remains service_role only; public/anon/authenticated revoked", () => {
    expect(active38).toMatch(
      /revoke all on function public\.create_thai_manual_evidence\(uuid, uuid, text, uuid, text, text, jsonb, text, text, text\) from public, anon, authenticated;/,
    );
    expect(active38).toMatch(
      /grant execute on function public\.create_thai_manual_evidence\(uuid, uuid, text, uuid, text, text, jsonb, text, text, text\) to service_role;/,
    );
    expect(active38).toMatch(
      /revoke all on function public\.supersede_thai_manual_evidence\(uuid, uuid, uuid, text, uuid, text, text, jsonb, text, text, text\) from public, anon, authenticated;/,
    );
    expect(active38).toMatch(
      /grant execute on function public\.supersede_thai_manual_evidence\(uuid, uuid, uuid, text, uuid, text, text, jsonb, text, text, text\) to service_role;/,
    );
    expect(active38).not.toMatch(
      /grant\s+execute\s+on function public\.create_thai_manual_evidence[\s\S]{0,200}to\s+(public|anon|authenticated)/i,
    );
    expect(active38).not.toMatch(
      /grant\s+execute\s+on function public\.supersede_thai_manual_evidence[\s\S]{0,200}to\s+(public|anon|authenticated)/i,
    );
  });

  it("does NOT grant USAGE or ALL on schema mdf", () => {
    expect(active38).not.toMatch(/grant\s+usage\s+on\s+schema\s+mdf/i);
    expect(active38).not.toMatch(/grant\s+all\s+on\s+schema\s+mdf/i);
    expect(active38).not.toMatch(/grant\s+[^;]*on\s+schema\s+mdf/i);
  });

  it("does not drop the 0036 helper", () => {
    expect(active38).not.toMatch(/drop\s+function[\s\S]*__thai_manual_evidence_lock_key/i);
  });
});

describe("TH07 42501 repair — lock-key compatibility with 0036 helper", () => {
  it("inlined create/supersede expressions match the 0036 helper expression exactly", () => {
    expect(createExpr).toBe(helperExpr);
    expect(supersedeExpr).toBe(helperExpr);
    expect(helperExpr).toBe(
      "('x' || substr( md5(p_workspace_id::text || '|' || p_candidate_id::text || '|' || p_provider_id), 1, 16 ))::bit(64)::bigint",
    );
  });

  it("replica of the 0036 algorithm is stable across the three Thailand manual providers", () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const candidateId = "22222222-2222-4222-8222-222222222222";
    const providers = ["thai-dbd", "thai-customs-operator", "thai-fda-importer"] as const;
    const keys = providers.map((providerId) => lockKeyReplica(workspaceId, candidateId, providerId));
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(lockKeyReplica(workspaceId, candidateId, "thai-dbd"));
    expect(keys[1]).toBe(lockKeyReplica(workspaceId, candidateId, "thai-customs-operator"));
    expect(keys[2]).toBe(lockKeyReplica(workspaceId, candidateId, "thai-fda-importer"));
    for (const key of keys) {
      expect(key >= -(1n << 63n) && key < 1n << 63n).toBe(true);
    }
  });

  it("0038 executable SQL does not name schema mdf at all", () => {
    expect(active38).not.toMatch(/\bmdf\./);
  });
});
