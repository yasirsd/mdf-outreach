import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/0025_buyer_trade_research_engine.sql"), "utf8");
const active = sql.replace(/--[^\n]*/g, "");

describe("BI4F Phase 2A migration 0025", () => {
  it("creates exactly the six bounded Phase 2A tables", () => {
    for (const table of [
      "buyer_trade_research_batches", "buyer_trade_research_jobs", "buyer_trade_research_provider_plans",
      "buyer_trade_research_attempts", "buyer_trade_research_events", "buyer_trade_source_snapshots",
    ]) expect(sql).toContain(`create table public.${table}`);
    expect(sql).not.toContain("buyer_trade_quota_ledger");
    expect(sql).not.toContain("buyer_trade_duplicate_clusters");
    expect(sql).not.toContain("buyer_trade_research_evidence_staging");
  });

  it("enforces zero automatic spend at every persisted layer", () => {
    expect(sql.match(/automatic_spend_rupees numeric\(12,2\) not null default 0 check \(automatic_spend_rupees = 0\)/g)).toHaveLength(5);
    expect(sql).toContain("automatic trade research spend must remain zero");
  });

  it("uses workspace-scoped composite foreign keys and active-scope uniqueness", () => {
    expect(sql).toMatch(/foreign key \(candidate_id, workspace_id\)[\s\S]*?buyer_candidates\(id, workspace_id\)/);
    expect(sql).toMatch(/foreign key \(batch_id, workspace_id\)[\s\S]*?buyer_trade_research_batches\(id, workspace_id\)/);
    expect(sql).toContain("buyer_trade_research_jobs_one_active_scope_idx");
    expect(sql).toMatch(/where status in \('queued','running','cancel_requested'\)/);
  });

  it("rejects wrong-workspace parent linkage at both FK and read-policy boundaries", () => {
    expect(sql).toMatch(/foreign key \(job_id, workspace_id\)[\s\S]*?buyer_trade_research_jobs\(id, workspace_id\)/);
    expect(sql).toMatch(/foreign key \(provider_plan_id, workspace_id\)[\s\S]*?buyer_trade_research_provider_plans\(id, workspace_id\)/);
    expect(sql).toContain("workspace_id = mdf.current_workspace_id()");
  });

  it("grants authenticated members SELECT only and gives anon no access", () => {
    expect(sql).toContain("grant select on public.%I to authenticated");
    expect(sql).toContain("revoke all on public.%I from public, anon, authenticated");
    expect(sql).not.toMatch(/grant select, insert, update, delete on public\.%I to authenticated/);
    expect(sql).toContain("workspace_id = mdf.current_workspace_id()");
    expect(sql).toMatch(/buyer_trade_source_snapshots[\s\S]*?revoke all[\s\S]*?public, anon, authenticated/);
  });

  it("keeps every mutation RPC service-role only", () => {
    for (const fn of ["create_buyer_trade_research_batch", "claim_buyer_trade_research_job", "heartbeat_buyer_trade_research_job", "release_buyer_trade_research_job", "advance_buyer_trade_research_job", "finalize_buyer_trade_research_job", "request_buyer_trade_research_batch_cancel"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*?to service_role`));
    }
  });

  it("uses atomic SKIP LOCKED claims and the full stale lease predicate", () => {
    expect(sql).toContain("for update of j skip locked limit 1");
    expect(sql).toContain("lease_expires_at < p_now");
    expect(sql).toContain("heartbeat_at < p_now - interval '60 seconds'");
    expect(sql).toContain("a.lease_expires_at >= p_now");
  });

  it("makes a newly created job immediately claimable with the expected initial state", () => {
    expect(sql).toMatch(/status text not null default 'queued'/);
    expect(sql).toMatch(/stage text not null default 'preparing_identity'/);
    expect(sql).toMatch(/revision bigint not null default 0/);
    expect(sql).toMatch(/j\.status='queued' and coalesce\(j\.next_attempt_at,p_now\) <= p_now/);
    expect(sql).toContain("b.cancel_requested_at is null");
  });

  it("matches the TypeScript RPC contract and returns the post-claim revision", () => {
    expect(sql).toContain("claim_buyer_trade_research_job(p_worker text, p_now timestamptz default now())");
    expect(sql).toContain("advance_buyer_trade_research_job(p_job_id uuid, p_worker text, p_revision bigint, p_stage text, p_now timestamptz default now())");
    expect(sql).toMatch(/revision=revision\+1 where id=v\.id returning \* into v/);
    expect(sql).toMatch(/where id=p_job_id and lease_owner=p_worker and revision=p_revision and status='running' returning \* into v/);
  });

  it("prevents another lease owner from advancing and permits stale recovery only after the full timeout", () => {
    expect(sql).toContain("lease_owner=p_worker and revision=p_revision");
    expect(sql).toContain("j.lease_expires_at < p_now and j.heartbeat_at < p_now - interval '60 seconds'");
    expect(sql).toContain("not exists (select 1 from public.buyer_trade_research_attempts");
  });

  it("creates each provider plan once before worker execution", () => {
    expect(sql).toContain("unique (job_id, provider_id, role)");
    expect(sql).toMatch(/for plan in select value from jsonb_array_elements\(item->'plans'\) loop[\s\S]*?insert into public\.buyer_trade_research_provider_plans/);
  });

  it("enforces terminal immutability, monotonic stages, and append-only events", () => {
    expect(sql).toContain("terminal trade research jobs are immutable");
    expect(sql).toContain("trade research stage cannot move backward");
    expect(sql).toContain("trade research events are append-only");
  });

  it("creates explicit reruns with supersedes_job_id and never mutates old terminal jobs", () => {
    expect(sql).toContain("supersedes_job_id uuid");
    expect(sql).toContain("terminal trade research jobs are immutable");
    expect(active).not.toMatch(/update public\.buyer_trade_research_jobs[\s\S]{0,300}set[\s\S]{0,100}supersedes_job_id/);
  });

  it("preserves completed jobs when cancellation makes a batch partial", () => {
    expect(sql).toMatch(/cancel_requested_at is not null and x\.open_count = 0 and x\.completed_count \+ x\.partial_count \+ x\.needs_review_count > 0 then 'partial'/);
    expect(sql).toContain("completed_count = x.completed_count");
    expect(sql).toContain("cancelled_count = x.cancelled_count");
  });

  it("does not write Buyer Intelligence or create shipment claims", () => {
    for (const forbidden of ["ingest_buyer_intelligence_source", "ingest_buyer_intelligence_claim", "ingest_buyer_trade_observation", "refresh_buyer_intelligence", "buyer_trade_observations", "importyeti", "bill_of_lading"]) {
      expect(active.toLowerCase()).not.toContain(forbidden);
    }
  });
});
