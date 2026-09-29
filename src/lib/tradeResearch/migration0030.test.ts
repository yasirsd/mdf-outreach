import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/0030_trade_research_provider_checkpoints.sql");
const baseMigration = read("supabase/migrations/0025_buyer_trade_research_engine.sql");
const localVerification = read("supabase/verification/0030_trade_research_provider_checkpoints_verify.sql");
const prodVerification = read("supabase/verification/0030_trade_research_provider_checkpoints_prod_verify.sql");

describe("migration 0030 durable provider checkpoints", () => {
  it("adds one nullable JSON-object checkpoint column without rewriting history", () => {
    expect(migration).toMatch(/alter table public\.buyer_trade_research_attempts\s+add column provider_result jsonb;/i);
    expect(migration).toContain("buyer_trade_research_attempts_provider_result_object_check");
    expect(migration).toContain("provider_result is null or jsonb_typeof(provider_result) = 'object'");
    const schemaPrefix = migration.split("create or replace function")[0] ?? migration;
    expect(schemaPrefix).not.toMatch(/\bupdate\s+public\.buyer_trade_research_attempts/i);
  });

  it.each([
    ["completed", "completed"],
    ["completed_no_match", "no_match"],
    ["skipped_cached", "cached"],
  ])("requires and maps %s to execution status %s", (attemptState, executionStatus) => {
    expect(migration).toContain(`when '${attemptState}' then '${executionStatus}'`);
    expect(migration).toContain("PROVIDER_RESULT_REQUIRED");
  });

  it("validates provider identity, typed shape, execution state, and safe top-level fields", () => {
    expect(migration).toContain("PROVIDER_RESULT_PROVIDER_MISMATCH");
    expect(migration).toContain("PROVIDER_RESULT_EXECUTION_MISMATCH");
    expect(migration).toContain("PROVIDER_RESULT_SHAPE_INVALID");
    expect(migration).toContain("PROVIDER_RESULT_UNSAFE_FIELD");
    expect(migration).toMatch(/p_provider_result\s*#>>\s*'\{execution,status\}'/);
    expect(migration).toMatch(/plan\.job_id\s*=\s*attempt\.job_id/);
    for (const field of ["datasetVersion", "parserVersion", "sourcePeriod", "retrievedAt"]) {
      expect(migration).toContain(`jsonb_typeof(p_provider_result -> '${field}') is distinct from 'string'`);
    }
    expect(migration).not.toMatch(/'context'/);
  });

  it.each([
    "failed_retryable", "failed_terminal", "cancelled", "skipped_quota",
    "skipped_cost", "skipped_terms", "retry_wait",
  ])("rejects provider_result for non-success state %s", (state) => {
    const allowedStates = migration.match(/if p_state not in \(([\s\S]*?)\) then/)?.[1] ?? "";
    expect(allowedStates).toContain(`'${state}'`);
    expect(migration).toMatch(/else\s+if p_provider_result is not null then\s+raise exception using errcode = '22023', message = 'PROVIDER_RESULT_NOT_ALLOWED';\s+end if;\s+end if;/);
  });

  it("rejects a success state carrying an attempt-level safe error code", () => {
    expect(migration).toMatch(/if v_expected_execution_status is not null then\s+if p_safe_error_code is not null then\s+raise exception using errcode = '22023', message = 'SUCCESS_SAFE_ERROR_NOT_ALLOWED';/);
  });

  it("preserves T02 job and attempt fencing without advancing job revision", () => {
    expect(migration).toMatch(/buyer_trade_research_jobs[\s\S]*?lease_owner = p_worker_id[\s\S]*?revision = p_revision[\s\S]*?for update/);
    expect(migration).toMatch(/attempt\.job_id = p_job_id[\s\S]*?attempt\.state = 'running'[\s\S]*?attempt\.lease_owner = p_worker_id/);
    expect(migration).toContain("STALE_JOB_REVISION");
    expect(migration).toContain("ATTEMPT_STATE_CONFLICT");
    expect(migration).not.toMatch(/update public\.buyer_trade_research_jobs/);
    expect(migration).not.toMatch(/revision\s*=\s*revision\s*\+\s*1/);
  });

  it("stores terminal state and checkpoint in the same UPDATE", () => {
    expect(migration).toMatch(/update public\.buyer_trade_research_attempts[\s\S]*?state = p_state,[\s\S]*?provider_result = p_provider_result/);
  });

  it.each([
    ["completed", "completed"],
    ["completed_no_match", "no_match"],
    ["skipped_cached", "cached"],
  ])("makes terminal %s provider_result immutable after %s checkpointing", (state) => {
    const guard = baseMigration.match(/create or replace function mdf\.__trade_research_attempt_guard\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1] ?? "";
    expect(guard).toContain(`'${state}'`);
    expect(guard).toMatch(/if old\.state in \([\s\S]*?\) then\s+raise exception 'terminal trade research attempts are immutable';\s+end if;/);
    expect(baseMigration).toMatch(/create trigger buyer_trade_research_attempts_guard before update on public\.buyer_trade_research_attempts\s+for each row execute function mdf\.__trade_research_attempt_guard\(\);/);
    expect(migration).not.toContain("create or replace function mdf.__trade_research_attempt_guard()");
  });

  it("keeps the v2 mutation RPC service-role-only", () => {
    const signature = "public.finish_buyer_trade_research_attempt_v2(uuid, uuid, text, bigint, text, jsonb, text, integer, integer, integer, timestamptz)";
    expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
    expect(migration).toContain(`grant execute on function ${signature} to service_role;`);
  });

  it("ships rollback-only local verification and one SELECT-only production verification", () => {
    expect(localVerification.trimEnd().endsWith("rollback;")).toBe(true);
    expect(localVerification).toContain("LOCAL / DISPOSABLE DATABASE ONLY");
    const activeProd = prodVerification
      .replace(/--[^\n]*/g, "")
      .replace(/'(?:''|[^'])*'/g, "''");
    expect(activeProd.trimStart()).toMatch(/^with\b/i);
    expect(activeProd).not.toMatch(/\b(?:insert|update|delete|upsert|merge|truncate|drop|alter|create|grant|revoke|do|call|set)\b/i);
    expect(prodVerification).toContain("case when passed then 'PASS' else 'FAIL' end");
    expect(prodVerification).toContain("acl.grantee = 0");
    expect(prodVerification).toContain("has_function_privilege('service_role'");
    expect(prodVerification).toContain("PROVIDER_RESULT_NOT_ALLOWED".toLowerCase());
    expect(prodVerification).toContain("SUCCESS_SAFE_ERROR_NOT_ALLOWED".toLowerCase());
    expect(prodVerification).toContain("trigger_definition ilike '%before update on public.buyer_trade_research_attempts%'");
    expect(prodVerification).toContain("The guard raises solely from OLD terminal state");
  });
});
