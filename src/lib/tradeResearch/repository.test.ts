import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TradeResearchWriter, type InternalJobRow } from "./repository";

const claimed: InternalJobRow = {
  id: "00000000-0000-4000-8000-000000000001",
  batch_id: "00000000-0000-4000-8000-000000000002",
  workspace_id: "00000000-0000-4000-8000-000000000003",
  candidate_id: "00000000-0000-4000-8000-000000000004",
  product_id: "guntur-dry-red-chilli",
  country_code: "US",
  status: "running",
  stage: "preparing_identity",
  revision: 1,
};

function clientWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe("TradeResearchWriter RPC contract", () => {
  it("calls the live 0025 claim signature and leaves p_now to the database default", async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: claimed, error: null }));
    const result = await new TradeResearchWriter(clientWithRpc(rpc)).claim("worker-a");
    expect(result).toEqual(claimed);
    expect(rpc).toHaveBeenCalledWith("claim_buyer_trade_research_job", { p_worker: "worker-a" });
  });

  it("treats an empty PostgREST row set as no work and accepts a one-row composite result", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [claimed], error: null });
    const writer = new TradeResearchWriter(clientWithRpc(rpc));
    expect(await writer.claim("worker-a")).toBeUndefined();
    expect(await writer.claim("worker-a")).toEqual(claimed);
  });

  it("advances with the revision returned by claim and adopts the returned revision", async () => {
    const advanced = { ...claimed, stage: "planning_sources", revision: 2 };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: claimed, error: null })
      .mockResolvedValueOnce({ data: advanced, error: null });
    const writer = new TradeResearchWriter(clientWithRpc(rpc));
    const job = await writer.claim("worker-a");
    const result = await writer.advance(job!, "worker-a", "planning_sources");
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_job_id: claimed.id,
      p_worker: "worker-a",
      p_revision: 1,
      p_stage: "planning_sources",
    });
    expect(result.revision).toBe(2);
  });

  it("fails a stale CAS result instead of silently continuing", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await expect(new TradeResearchWriter(clientWithRpc(rpc)).advance(claimed, "worker-b", "planning_sources"))
      .rejects.toThrow("JOB_LEASE_LOST");
  });

  it("releases the currently owned revision for a safe retry after an unexpected exception", async () => {
    const owned = { ...claimed, revision: 4, lease_owner: "worker-a" };
    const jobQuery = {
      select: vi.fn(function (this: typeof jobQuery) { return this; }),
      eq: vi.fn(function (this: typeof jobQuery) { return this; }),
      in: vi.fn(function (this: typeof jobQuery) { return this; }),
      maybeSingle: vi.fn(async () => ({ data: owned, error: null })),
    };
    const attemptQuery = {
      select: vi.fn(function (this: typeof attemptQuery) { return this; }),
      eq: vi.fn(function (this: typeof attemptQuery) { return this; }),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const rpc = vi.fn(async () => ({ data: { ...owned, revision: 5, lease_owner: null }, error: null }));
    const client = {
      rpc,
      from: vi.fn((table: string) => table === "buyer_trade_research_jobs" ? jobQuery : attemptQuery),
    } as unknown as SupabaseClient;
    const outcome = await new TradeResearchWriter(client).recoverClaimedJob(owned.id, "worker-a", "2026-09-25T12:00:30.000Z", "WORKER_INTERNAL_ERROR");
    expect(outcome).toBe("requeued");
    expect(rpc).toHaveBeenCalledWith("release_buyer_trade_research_job", {
      p_job_id: owned.id,
      p_worker: "worker-a",
      p_revision: 4,
      p_next_attempt_at: "2026-09-25T12:00:30.000Z",
    });
  });

  it("does not recover a job owned by another worker", async () => {
    const jobQuery = {
      select: vi.fn(function (this: typeof jobQuery) { return this; }),
      eq: vi.fn(function (this: typeof jobQuery) { return this; }),
      in: vi.fn(function (this: typeof jobQuery) { return this; }),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const rpc = vi.fn();
    const client = { rpc, from: vi.fn(() => jobQuery) } as unknown as SupabaseClient;
    expect(await new TradeResearchWriter(client).recoverClaimedJob(claimed.id, "worker-b", "2026-09-25T12:00:30.000Z", "WORKER_INTERNAL_ERROR"))
      .toBe("lease_lost");
    expect(rpc).not.toHaveBeenCalled();
  });
});
