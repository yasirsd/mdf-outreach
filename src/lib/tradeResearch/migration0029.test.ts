import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/0029_trade_research_context_binding.sql");
const localVerification = read("supabase/verification/0029_trade_research_context_binding_verify.sql");
const prodVerification = read("supabase/verification/0029_trade_research_context_binding_prod_verify.sql");

describe("migration 0029 explicit trade-research context binding", () => {
  it("adds nullable paired context columns without backfilling historical rows", () => {
    expect(migration).toMatch(/add column research_context jsonb/);
    expect(migration).toMatch(/add column context_fingerprint text/);
    expect(migration).toContain("buyer_trade_research_jobs_context_pair_check");
    expect(migration).toContain("jsonb_typeof(research_context) = 'object'");
    expect(migration).toContain("^trctx-v1:[0-9a-f]{64}$");
    expect(migration).not.toMatch(/update public\.buyer_trade_research_jobs[\s\S]{0,300}research_context\s*=/i);
  });

  it("makes context immutable through the existing guard function", () => {
    expect(migration).toContain("create or replace function mdf.__trade_research_job_guard()");
    expect(migration).toContain("new.research_context is distinct from old.research_context");
    expect(migration).toContain("new.context_fingerprint is distinct from old.context_fingerprint");
    expect(migration).toContain("trade research context is immutable");
  });

  it("splits typed and legacy active uniqueness and adds exact-context reads", () => {
    expect(migration).toContain("drop index public.buyer_trade_research_jobs_one_active_scope_idx");
    expect(migration).toContain("buyer_trade_research_jobs_one_active_context_idx");
    expect(migration).toMatch(/workspace_id, context_fingerprint[\s\S]*?context_fingerprint is not null/);
    expect(migration).toContain("buyer_trade_research_jobs_one_active_legacy_scope_idx");
    expect(migration).toMatch(/coalesce\(product_id, ''\)[\s\S]*?context_fingerprint is null/);
    expect(migration).toMatch(/buyer_trade_research_jobs_context_read_idx[\s\S]*?workspace_id,[\s\S]*?candidate_id,[\s\S]*?context_fingerprint,[\s\S]*?created_at desc/);
  });

  it("requires complete typed context in the batch RPC and stores it on INSERT", () => {
    expect(migration).toContain("research context workspace mismatch");
    expect(migration).toContain("research context candidate mismatch");
    expect(migration).toContain("research context product mismatch");
    expect(migration).toContain("research context market mismatch");
    expect(migration).toContain("research context goal mismatch");
    expect(migration).toContain("research context provider-plan version mismatch");
    expect(migration.match(/is distinct from/g)?.length).toBeGreaterThanOrEqual(8);
    expect(migration).toMatch(/insert into public\.buyer_trade_research_jobs\([\s\S]*?research_context,[\s\S]*?context_fingerprint,[\s\S]*?result_summary/);
  });

  it("preserves T02 finalization fencing and makes stored context authoritative", () => {
    expect(migration).toMatch(/select \* into v_job[\s\S]*?lease_owner = p_worker_id[\s\S]*?revision = p_revision[\s\S]*?for update/);
    expect(migration).toContain("message = 'STALE_JOB_REVISION'");
    expect(migration).toContain("message = 'RESULT_CONTEXT_CONFLICT'");
    expect(migration).toContain("message = 'LEGACY_JOB_CONTEXT_FORBIDDEN'");
    expect(migration).toMatch(/jsonb_build_object\([\s\S]*?'context', v_job\.research_context,[\s\S]*?'contextFingerprint', v_job\.context_fingerprint/);
    expect(migration).toMatch(/revision = revision \+ 1/);
  });

  it("keeps mutation RPCs service-role-only", () => {
    for (const signature of [
      "public.create_buyer_trade_research_batch(jsonb)",
      "public.finalize_buyer_trade_research_job_v2(",
    ]) {
      expect(migration).toContain(`revoke all on function ${signature}`);
    }
    expect(migration.match(/from public, anon, authenticated/g)).toHaveLength(2);
    expect(migration.match(/to service_role/g)).toHaveLength(2);
  });

  it("ships rollback-only local verification and SELECT-only production verification", () => {
    expect(localVerification.trimEnd().endsWith("rollback;")).toBe(true);
    expect(localVerification).toContain("context pair constraint missing");
    const activeProd = prodVerification
      .replace(/--[^\n]*/g, "")
      .replace(/'(?:''|[^'])*'/g, "''");
    expect(activeProd.trimStart()).toMatch(/^with\b/i);
    expect(activeProd).not.toMatch(/\b(?:insert|update|delete|merge|truncate|drop|alter|grant|revoke|do|call|set)\b/i);
    expect(prodVerification).toContain("case when passed then 'PASS' else 'FAIL'");
  });
});
