import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { TradeResearchWriter } from "./repository";

/**
 * Repository-level tests for
 * `TradeResearchWriter.listTerminalJobsMissingCertification`.
 *
 * Since migration 0032, the method delegates to the
 * `select_terminal_research_jobs_missing_certification` RPC — a
 * Postgres NOT EXISTS anti-join with `ORDER BY completed_at DESC, id
 * DESC`. These tests simulate the RPC against an in-memory table to
 * catch starvation and workspace-isolation regressions.
 *
 * The mock replicates the RPC's semantic contract:
 *   1. filter terminal jobs whose `(id, workspace_id)` is NOT present
 *      in the certifications table,
 *   2. order by `completed_at DESC, id DESC` (total, deterministic),
 *   3. LIMIT to `p_limit`.
 */

type Row = Record<string, unknown>;

interface Job extends Row {
  id: string;
  workspace_id: string;
  status: string;
  completed_at: string | null;
}

interface Cert extends Row {
  job_id: string;
  workspace_id: string;
}

const TERMINAL_STATUSES = new Set(["completed", "partial", "needs_review", "failed", "cancelled"]);

function buildClient(jobs: Job[], certs: Cert[]): { client: SupabaseClient; rpcCalls: number } {
  const state = { rpcCalls: 0 };
  const rpc = async (name: string, args: { p_limit?: number }) => {
    if (name !== "select_terminal_research_jobs_missing_certification") {
      throw new Error(`unexpected rpc ${name}`);
    }
    state.rpcCalls += 1;
    const rawLimit = args?.p_limit ?? 5;
    const limit = Math.max(1, Math.min(50, rawLimit));
    const certifiedPairs = new Set(certs.map((c) => `${c.job_id}:${c.workspace_id}`));
    const eligible = jobs
      .filter((j) => TERMINAL_STATUSES.has(j.status))
      .filter((j) => j.completed_at !== null)
      .filter((j) => !certifiedPairs.has(`${j.id}:${j.workspace_id}`));
    eligible.sort((a, b) => {
      const cmp = (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id.localeCompare(a.id);
    });
    return { data: eligible.slice(0, limit), error: null };
  };
  const client = { rpc } as unknown as SupabaseClient;
  return { client, get rpcCalls() { return state.rpcCalls; } } as unknown as { client: SupabaseClient; rpcCalls: number };
}

function job(id: string, completedAt: string, workspaceId = "wsA", status = "completed"): Job {
  return {
    id,
    batch_id: "b",
    workspace_id: workspaceId,
    candidate_id: "cand",
    product_id: "guntur-dry-red-chilli",
    country_code: "US",
    requested_goal: "screen_trade_activity",
    status,
    stage: "complete",
    revision: 1,
    outcome: "no_verified_evidence",
    research_context: null,
    context_fingerprint: null,
    result_summary: { automaticSpendRupees: 0 },
    completed_at: completedAt,
  };
}

describe("T12 reliability — starvation-free reconciliation reader (RPC-backed)", () => {
  it("STARVATION FIX: newest 5 certified + older uncertified → older IS discovered", async () => {
    const jobs: Job[] = [
      job("newest-1", "2026-09-29T05:00:00Z"),
      job("newest-2", "2026-09-29T04:00:00Z"),
      job("newest-3", "2026-09-29T03:00:00Z"),
      job("newest-4", "2026-09-29T02:00:00Z"),
      job("newest-5", "2026-09-29T01:00:00Z"),
      job("older-6",  "2026-09-28T12:00:00Z"),
    ];
    const certs: Cert[] = [
      { job_id: "newest-1", workspace_id: "wsA" },
      { job_id: "newest-2", workspace_id: "wsA" },
      { job_id: "newest-3", workspace_id: "wsA" },
      { job_id: "newest-4", workspace_id: "wsA" },
      { job_id: "newest-5", workspace_id: "wsA" },
    ];
    const { client } = buildClient(jobs, certs);
    const writer = new TradeResearchWriter(client);
    const missing = await writer.listTerminalJobsMissingCertification(5);
    expect(missing.map((m) => m.job.id)).toEqual(["older-6"]);
  });

  it(">200 CERTIFIED NEWER + 1 OLDER MISSING: reconciliation still discovers the older job in ONE call", async () => {
    // 300 newest jobs are all certified. Job 301 is older and missing.
    // An application-level bounded scan would starve this. The RPC
    // filters certified rows out BEFORE LIMIT so the missing row is
    // returned in a single call.
    const newest: Job[] = Array.from({ length: 300 }, (_, i) =>
      job(`cert-${String(i + 1).padStart(4, "0")}`, `2026-09-2${9 - Math.floor(i / 100)}T${String(23 - (i % 24)).padStart(2, "0")}:00:00Z`));
    const older: Job[] = [job("older-missing", "2026-01-01T00:00:00Z")];
    const jobs = [...newest, ...older];
    const certs: Cert[] = newest.map((j) => ({ job_id: j.id, workspace_id: j.workspace_id }));
    const { client } = buildClient(jobs, certs);
    const writer = new TradeResearchWriter(client);
    const missing = await writer.listTerminalJobsMissingCertification(5);
    expect(missing.map((m) => m.job.id)).toEqual(["older-missing"]);
  });

  it("500 CERTIFIED NEWER + 3 OLDER MISSING: repeated bounded reconciliation eventually reaches and certifies all three", async () => {
    const newest: Job[] = Array.from({ length: 500 }, (_, i) =>
      job(`cert-${String(i + 1).padStart(4, "0")}`, `2026-09-${String(29 - (i % 15)).padStart(2, "0")}T${String(23 - (i % 24)).padStart(2, "0")}:${String(59 - (i % 60)).padStart(2, "0")}:00Z`));
    const older: Job[] = [
      job("older-A", "2026-01-01T00:00:00Z"),
      job("older-B", "2026-01-01T00:00:00Z"),
      job("older-C", "2026-01-01T00:00:00Z"),
    ];
    const jobs = [...newest, ...older];
    const certs: Cert[] = newest.map((j) => ({ job_id: j.id, workspace_id: j.workspace_id }));
    // Simulate the drain: each pass reads up to 5 missing rows and
    // certifies them. Repeat until zero missing rows are reported.
    let totalRpcCalls = 0;
    const seen = new Set<string>();
    while (true) {
      const { client } = buildClient(jobs, certs) as unknown as { client: SupabaseClient };
      const writer = new TradeResearchWriter(client);
      const missing = await writer.listTerminalJobsMissingCertification(5);
      totalRpcCalls += 1;
      if (missing.length === 0) break;
      for (const m of missing) {
        seen.add(m.job.id);
        certs.push({ job_id: m.job.id, workspace_id: m.job.workspace_id });
      }
      if (totalRpcCalls > 10) throw new Error("unbounded invocation guard tripped");
    }
    expect([...seen].sort()).toEqual(["older-A", "older-B", "older-C"]);
    // With p_limit=5 and only 3 missing, we drain in ONE call and
    // confirm with a second empty call. So the drain terminates in ≤2
    // invocations regardless of the 500 certified rows.
    expect(totalRpcCalls).toBeLessThanOrEqual(2);
  });

  it("IDENTICAL TIMESTAMPS: many rows share completed_at across page boundary — none are skipped, ordering is deterministic", async () => {
    // 20 terminal jobs, all with the SAME completed_at value.
    // 10 are certified, 10 are missing. Reader must surface all 10
    // missing in deterministic (id DESC) order and never skip a row.
    const sharedTs = "2026-09-29T05:00:00Z";
    const jobs: Job[] = Array.from({ length: 20 }, (_, i) =>
      job(`shared-${String(i + 1).padStart(2, "0")}`, sharedTs));
    const certs: Cert[] = jobs
      .filter((_, i) => i % 2 === 0) // even-indexed = certified
      .map((j) => ({ job_id: j.id, workspace_id: j.workspace_id }));
    const { client } = buildClient(jobs, certs);
    const writer = new TradeResearchWriter(client);
    const missing = await writer.listTerminalJobsMissingCertification(50);
    // Odd-indexed jobs are the ones missing. In id-DESC secondary
    // sort, "shared-20" > "shared-18" > ... > "shared-02".
    const expected = jobs
      .filter((_, i) => i % 2 === 1)
      .map((j) => j.id)
      .sort((a, b) => b.localeCompare(a));
    expect(missing.map((m) => m.job.id)).toEqual(expected);
  });

  it("IDENTICAL TIMESTAMPS ACROSS PAGE BOUNDARY: bounded limit does not skip any row on a shared-timestamp burst", async () => {
    // 15 rows share the exact same completed_at. All are missing.
    // limit is 5; three consecutive passes must surface all 15 in
    // strict id-DESC order with no duplicates and no gaps.
    const sharedTs = "2026-09-29T05:00:00Z";
    const jobs: Job[] = Array.from({ length: 15 }, (_, i) =>
      job(`burst-${String(i + 1).padStart(2, "0")}`, sharedTs));
    const certs: Cert[] = [];
    const drained: string[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      const { client } = buildClient(jobs, certs) as unknown as { client: SupabaseClient };
      const writer = new TradeResearchWriter(client);
      const missing = await writer.listTerminalJobsMissingCertification(5);
      for (const m of missing) {
        drained.push(m.job.id);
        certs.push({ job_id: m.job.id, workspace_id: m.job.workspace_id });
      }
      if (missing.length === 0) break;
    }
    // Expect all 15 drained, deterministic id-DESC order, no duplicates.
    const expected = jobs.map((j) => j.id).sort((a, b) => b.localeCompare(a));
    expect(drained).toEqual(expected);
    expect(new Set(drained).size).toBe(15);
  });

  it("WORKSPACE ISOLATION: a workspace-B certification cannot mask a workspace-A missing job", async () => {
    const jobs: Job[] = [
      job("jobA", "2026-09-29T05:00:00Z", "wsA"),
      job("jobB", "2026-09-29T04:00:00Z", "wsB"),
    ];
    const certs: Cert[] = [
      { job_id: "jobB", workspace_id: "wsB" },
    ];
    const { client } = buildClient(jobs, certs);
    const writer = new TradeResearchWriter(client);
    const missing = await writer.listTerminalJobsMissingCertification(5);
    expect(missing.map((m) => m.job.id)).toEqual(["jobA"]);
    for (const m of missing) expect(m.job.workspace_id).toBe("wsA");
  });

  it("WORKSPACE ISOLATION (defense-in-depth): a hypothetical corrupted cert row with the wrong workspace_id does NOT mask the job", async () => {
    const jobs: Job[] = [job("jobA", "2026-09-29T05:00:00Z", "wsA")];
    const certs: Cert[] = [{ job_id: "jobA", workspace_id: "wsB" }];
    const { client } = buildClient(jobs, certs);
    const writer = new TradeResearchWriter(client);
    const missing = await writer.listTerminalJobsMissingCertification(5);
    expect(missing.map((m) => m.job.id)).toEqual(["jobA"]);
  });

  it("skips terminal jobs whose completed_at is NULL", async () => {
    const jobs: Job[] = [
      job("terminal-1", "2026-09-29T05:00:00Z"),
      { ...job("legacy-null", "irrelevant"), completed_at: null },
    ];
    const { client } = buildClient(jobs, []);
    const writer = new TradeResearchWriter(client);
    const missing = await writer.listTerminalJobsMissingCertification(5);
    expect(missing.map((m) => m.job.id)).toEqual(["terminal-1"]);
  });

  it("clamps limit to [1, 50] and forwards the clamped value to the RPC", async () => {
    let received = -1;
    const client = {
      rpc: async (_name: string, args: { p_limit: number }) => {
        received = args.p_limit;
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;
    const writer = new TradeResearchWriter(client);
    await writer.listTerminalJobsMissingCertification(3);
    expect(received).toBe(3);
    await writer.listTerminalJobsMissingCertification(500);
    expect(received).toBe(50);
  });

  it("propagates the RPC error verbatim (drain reconciliation reports it as transient)", async () => {
    const client = {
      rpc: async () => ({ data: null, error: Object.assign(new Error("db"), { code: "PGRST_TRANSIENT" }) }),
    } as unknown as SupabaseClient;
    const writer = new TradeResearchWriter(client);
    await expect(writer.listTerminalJobsMissingCertification(5)).rejects.toMatchObject({ code: "PGRST_TRANSIENT" });
  });
});
