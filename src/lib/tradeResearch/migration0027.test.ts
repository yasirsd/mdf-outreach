import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0027_trade_research_revision_fencing.sql"),
  "utf8",
);
const verification = readFileSync(
  path.resolve(process.cwd(), "supabase/verification/0027_trade_research_revision_fencing_verify.sql"),
  "utf8",
);

describe("migration 0027 revision fencing contract", () => {
  it.each([
    "finalize_buyer_trade_research_job_v2",
    "finish_buyer_trade_research_attempt",
    "reconcile_buyer_trade_research_attempt",
  ])("defines %s as an additive RPC", (name) => {
    expect(migration).toContain(`create or replace function public.${name}`);
  });

  it("finalization fences by id, worker, revision, and nonterminal status before incrementing", () => {
    expect(migration).toMatch(/where id = p_job_id[\s\S]*lease_owner = p_worker_id[\s\S]*revision = p_revision[\s\S]*status in \('running', 'cancel_requested'\)/);
    expect(migration).toMatch(/revision = revision \+ 1/);
    expect(migration).toContain("message = 'STALE_JOB_REVISION'");
  });

  it("attempt mutations lock and validate the parent without incrementing its revision", () => {
    const finishBody = migration.slice(
      migration.indexOf("create or replace function public.finish_buyer_trade_research_attempt"),
      migration.indexOf("create or replace function public.reconcile_buyer_trade_research_attempt"),
    );
    expect(finishBody).toContain("from public.buyer_trade_research_jobs");
    expect(finishBody).toContain("for update");
    expect(finishBody).toContain("revision = p_revision");
    expect(finishBody).not.toContain("revision = revision + 1");
  });

  it("keeps every new mutation RPC service-role-only", () => {
    expect(migration.match(/revoke all on function/g)).toHaveLength(3);
    expect(migration.match(/from public, anon, authenticated/g)).toHaveLength(3);
    expect(migration.match(/grant execute on function/g)).toHaveLength(3);
    expect(migration.match(/to service_role/g)).toHaveLength(3);
  });

  it("does not alter RLS, Buyer rows, or Buyer Intelligence storage", () => {
    expect(migration).not.toMatch(/disable row level security/i);
    expect(migration).not.toMatch(/\b(?:insert into|update|delete from) public\.buyer_candidates\b/i);
    expect(migration).not.toMatch(/\b(?:insert into|update|delete from) public\.buyer_intelligence/i);
  });

  it("ships rollback-only verification for CAS, grants, RLS, and zero spend", () => {
    expect(verification.trimEnd().endsWith("rollback;")).toBe(true);
    expect(verification).toContain("has_function_privilege('service_role'");
    expect(verification).toContain("relrowsecurity");
    expect(verification).toContain("stale finalization unexpectedly succeeded");
    expect(verification).toContain("attempt completion unexpectedly advanced job revision");
    expect(verification).toContain("automatic-spend invariant failed");
  });
});
