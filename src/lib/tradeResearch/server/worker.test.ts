import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { TradeResearchWriter, type InternalJobRow, type SnapshotRow } from "../repository";
import { drainTradeResearch, processTradeResearchJob, TradeResearchDrainExecutionError } from "./worker";

const NOW = new Date("2026-09-25T12:00:00Z");

function xlsx(): Uint8Array {
  const shared = ["Foreign Supplier Verification Programs - List of Participants (Name and State Only) April 1, 2026 – June 30, 2026", "Firm Legal Name", "State Code", "BC FOODS, INC.", "CA"];
  return zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row><c r="B1" t="s"><v>0</v></c></row><row><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c></row><row><c r="B3" t="s"><v>3</v></c><c r="C3" t="s"><v>4</v></c></row></sheetData></worksheet>`),
  });
}

function snapshot(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snapshot", provider_id: "fda-fsvp", dataset_id: "fsvp-participant-list",
    published_period: "April 1, 2026 – June 30, 2026", source_url: "https://www.fda.gov/media/186093/download",
    material_hash: "hash", retrieved_at: NOW.toISOString(), expires_at: "2026-12-31T00:00:00Z", row_count: 1,
    normalized_rows: [{ companyName: "BC FOODS, INC.", stateCode: "CA" }], ...over,
  };
}

function job(): InternalJobRow {
  return {
    id: "job", batch_id: "batch", workspace_id: "workspace", candidate_id: "candidate",
    product_id: "guntur-dry-red-chilli", country_code: "US", status: "running", stage: "preparing_identity", revision: 1,
  };
}

function candidate(): BuyerCandidate {
  return { id: "candidate", companyName: "BC Foods LLC", country: "United States", address: "Fresno, CA 93721", industry: "Food", isImporter: true, discoveryStatus: "ready", reviewStatus: "pending" };
}

function memoryWriter(over: Record<string, unknown> = {}) {
  const state = {
    cancelled: false, plan: { id: "plan", cost_class: "free", automatic_spend_rupees: 0 },
    fresh: snapshot() as SnapshotRow | undefined, latest: undefined as SnapshotRow | undefined,
    finalized: [] as Array<Record<string, unknown>>, released: [] as string[], attempts: [] as Array<Record<string, unknown>>,
    heartbeatCount: 0, saved: 0, refreshed: 0,
    candidate: candidate(),
  };
  Object.assign(state, over);
  const writer = {
    isCancellationRequested: vi.fn(async () => state.cancelled),
    finalize: vi.fn(async (_job, _worker, status, outcome, result) => { state.finalized.push({ status, outcome, result }); }),
    advance: vi.fn(async (row: InternalJobRow, _worker: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getEligiblePlan: vi.fn(async () => state.plan),
    latestAttempt: vi.fn(async () => undefined),
    startAttempt: vi.fn(async (_job, _plan, attemptNumber) => ({ id: `attempt-${attemptNumber}`, attempt_number: attemptNumber })),
    appendEvent: vi.fn(async () => undefined),
    finishAttempt: vi.fn(async (_id, patch) => { state.attempts.push(patch); }),
    release: vi.fn(async (_job, _worker, next: string) => { state.released.push(next); }),
    heartbeat: vi.fn(async (row: InternalJobRow) => { state.heartbeatCount += 1; return { ...row, revision: row.revision + 1 }; }),
    getFreshSnapshot: vi.fn(async () => state.fresh),
    getLatestSnapshot: vi.fn(async () => state.latest),
    refreshSnapshotExpiry: vi.fn(async () => { state.refreshed += 1; return { ...state.latest!, expires_at: "2027-01-01T00:00:00Z" }; }),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => { state.saved += 1; return { id: "new", ...input } as SnapshotRow; }),
    getCandidate: vi.fn(async () => state.candidate),
  };
  return { state, writer: writer as unknown as TradeResearchWriter };
}

afterEach(() => { vi.useRealTimers(); });

describe("bounded trade research worker", () => {
  it("cancels before provider execution and preserves zero spend", async () => {
    const { state, writer } = memoryWriter({ cancelled: true });
    expect(await processTradeResearchJob(writer, job(), "worker", () => NOW)).toBe("completed");
    expect(state.finalized[0]).toMatchObject({ status: "cancelled", outcome: "cancelled", result: { automaticSpendRupees: 0 } });
    expect(state.attempts).toHaveLength(0);
  });

  it("finishes honestly when no eligible provider exists", async () => {
    const { state, writer } = memoryWriter({ plan: undefined });
    await processTradeResearchJob(writer, job(), "worker", () => NOW);
    expect(writer.advance).toHaveBeenNthCalledWith(1, job(), "worker", "planning_sources");
    expect(state.finalized[0]).toMatchObject({ status: "completed", outcome: "unsupported_coverage", result: { sourcesChecked: 0 } });
  });

  it("reuses a shared cache and persists only official program corroboration", async () => {
    const { state, writer } = memoryWriter();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.attempts[0]).toMatchObject({ state: "skipped_cached", record_count: 1 });
    expect(state.finalized[0]).toMatchObject({ status: "completed", outcome: "official_importer_program_corroboration", result: { officialProgramEvidence: "verified", shipmentEvidence: "not_verified", automaticSpendRupees: 0 } });
  });

  it("handles a Goya-equivalent candidate with optional geography omitted", async () => {
    const { state, writer } = memoryWriter({
      candidate: {
        id: "candidate", companyName: "Goya Foods", country: "United States",
        domain: "goya.com", industry: "Food", isImporter: true,
        discoveryStatus: "ready", reviewStatus: "pending",
      } satisfies BuyerCandidate,
      fresh: snapshot({ normalized_rows: [{ companyName: "GOYA FOODS, INC.", stateCode: "NJ" }] }),
    });
    await expect(processTradeResearchJob(writer, job(), "worker", () => NOW)).resolves.toBe("completed");
    expect(state.finalized[0]).toMatchObject({
      status: "needs_review", outcome: "needs_review",
      result: { officialProgramEvidence: "needs_review", automaticSpendRupees: 0 },
    });
  });

  it("downloads and parses one cache miss, then saves a normalized snapshot", async () => {
    const { state, writer } = memoryWriter({ fresh: undefined, latest: undefined });
    const fetchImpl = vi.fn(async () => new Response(xlsx(), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "etag": "v1" } })) as unknown as typeof fetch;
    await processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(state.saved).toBe(1);
    expect(state.finalized[0]).toMatchObject({ outcome: "official_importer_program_corroboration" });
  });

  it("refreshes snapshot freshness on a conditional 304 without reparsing", async () => {
    const expired = snapshot({ expires_at: "2026-09-01T00:00:00Z", etag: "old" });
    const { state, writer } = memoryWriter({ fresh: undefined, latest: expired });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    await processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl);
    expect(state.refreshed).toBe(1); expect(state.saved).toBe(0);
  });

  it("releases a transient 5xx for the bounded first retry", async () => {
    const { state, writer } = memoryWriter({ fresh: undefined, latest: undefined });
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    expect(await processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl)).toBe("retry");
    expect(state.attempts[0]).toMatchObject({ state: "retry_wait" });
    expect(Date.parse(state.released[0]) - NOW.getTime()).toBe(30_000);
    expect(state.finalized).toHaveLength(0);
  });

  it("turns the bounded FDA fetch timeout into a safe retry", async () => {
    vi.useFakeTimers();
    const { state, writer } = memoryWriter({ fresh: undefined, latest: undefined });
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })) as unknown as typeof fetch;
    const running = processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl);
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(running).resolves.toBe("retry");
    expect(state.attempts[0]).toMatchObject({ state: "retry_wait", safe_error_code: "NETWORK_TIMEOUT" });
  });

  it("fails terminally on parser incompatibility without retry", async () => {
    const { state, writer } = memoryWriter({ fresh: undefined, latest: undefined });
    const fetchImpl = vi.fn(async () => new Response(strToU8("not an xlsx"), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } })) as unknown as typeof fetch;
    expect(await processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl)).toBe("failed");
    expect(state.released).toHaveLength(0);
    expect(state.attempts[0]).toMatchObject({ state: "failed_terminal", safe_error_code: "PARSER_INCOMPATIBLE" });
  });

  it("heartbeats during a slow provider fetch so a live job is not reclaimed", async () => {
    vi.useFakeTimers();
    const { state, writer } = memoryWriter({ fresh: undefined, latest: undefined });
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch;
    const running = processTradeResearchJob(writer, job(), "worker", () => NOW, fetchImpl);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.heartbeatCount).toBe(1);
    resolve(new Response(xlsx(), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }));
    await running;
  });

  it("distinguishes a successful no-work drain from productive execution", async () => {
    const log = vi.fn();
    const writer = { claim: vi.fn(async () => undefined) } as unknown as TradeResearchWriter;
    const result = await drainTradeResearch({ writer, workerId: "worker-a", maxJobs: 2, log });
    expect(result).toMatchObject({ jobsRequested: 2, claimed: 0, processed: 0, noWork: true, automaticSpendRupees: 0 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "claim_no_work", jobsClaimed: 0 }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "drain_finished", noWork: true }));
  });

  it("does not count or process an all-null scalar-composite claim response", async () => {
    const nullClaim = {
      id: null, batch_id: null, workspace_id: null, candidate_id: null, product_id: null,
      country_code: null, status: null, stage: null, revision: null, lease_owner: null,
    };
    const rpc = vi.fn(async () => ({ data: nullClaim, error: null }));
    const from = vi.fn();
    const writer = new TradeResearchWriter({ rpc, from } as unknown as SupabaseClient);
    const result = await drainTradeResearch({ writer, workerId: "worker-a", maxJobs: 2 });
    expect(result).toMatchObject({ claimed: 0, processed: 0, failed: 0, noWork: true });
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("normalizes a claim RPC rejection into a safe database error", async () => {
    const writer = {
      claim: vi.fn(async () => { throw Object.assign(new Error("private database detail"), { code: "PGRST123" }); }),
    } as unknown as TradeResearchWriter;
    await expect(drainTradeResearch({ writer, workerId: "worker-a", maxJobs: 1 })).rejects.toMatchObject({
      safeErrorCode: "DATABASE_PGRST123",
      result: { claimed: 0, processed: 0, noWork: false },
    });
  });

  it("requeues an owned job after an unexpected pre-provider exception and surfaces drain failure", async () => {
    const recovery = vi.fn(async () => "requeued" as const);
    const writer = {
      claim: vi.fn().mockResolvedValueOnce(job()),
      isCancellationRequested: vi.fn(async () => { throw new Error("unexpected repository failure"); }),
      recoverClaimedJob: recovery,
    } as unknown as TradeResearchWriter;
    const run = drainTradeResearch({ writer, workerId: "worker-a", maxJobs: 1, now: () => NOW });
    await expect(run).rejects.toBeInstanceOf(TradeResearchDrainExecutionError);
    expect(recovery).toHaveBeenCalledWith(job().id, "worker-a", "2026-09-25T12:00:30.000Z", "WORKER_INTERNAL_ERROR");
    await expect(run).rejects.toMatchObject({
      safeErrorCode: "WORKER_INTERNAL_ERROR",
      result: { claimed: 1, processed: 0, requeued: 1, noWork: false },
    });
  });

  // BI4F 2A hard-deadline safe checkpointing regressions.
  describe("hard-deadline checkpointing", () => {
    it("with generous deadline → job completes normally (control)", async () => {
      const { state, writer } = memoryWriter();
      const outcome = await processTradeResearchJob(
        writer, job(), "worker", () => NOW, undefined, undefined,
        Date.now() + 60_000,
      );
      expect(outcome).toBe("completed");
      expect(state.finalized[0]).toMatchObject({ outcome: "official_importer_program_corroboration" });
      expect(state.released).toHaveLength(0);
    });

    it("cold FDA path + insufficient headroom BEFORE fetch → checkpoints via writer.release, returns retry, no fetch, no attempt", async () => {
      const { state, writer } = memoryWriter({ fresh: undefined, latest: undefined });
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const log = vi.fn();
      const outcome = await processTradeResearchJob(
        writer, job(), "worker", () => NOW, fetchImpl, log,
        Date.now() + 5_000,   // 5 s remaining — less than 25 s FDA cold + 8 s reserve
      );
      expect(outcome).toBe("retry");
      expect(fetchImpl).not.toHaveBeenCalled();
      // No attempt row was created — resume-idempotent.
      expect(state.attempts).toHaveLength(0);
      // Lease was released with a short next_attempt_at (≤ 3 s in future).
      expect(state.released).toHaveLength(1);
      const nextAttempt = Date.parse(state.released[0]!);
      expect(nextAttempt - NOW.getTime()).toBeLessThanOrEqual(3_000);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({
        event: "job_checkpointed_runtime_budget",
        jobId: "job", batchId: "batch", stage: "screening_sources",
      }));
      // No finalize — the job is reclaimable, not terminal.
      expect(state.finalized).toHaveLength(0);
    });

    it("cache-hit + insufficient headroom BEFORE matching → checkpoints, retry, no finalize", async () => {
      const { state, writer } = memoryWriter();  // default fresh snapshot
      // The pre-FDA gate uses required=25 s; a cache-hit skips the FDA gate.
      // Insert deadline that passes the cache-hit stage AND the pre-FDA gate
      // (both require ~5 s or less remaining) but fails the pre-match gate.
      // That's tight — this test uses a large-enough deadline for the FDA
      // cache-hit + fake elapsed via now(), asserting the pre-match gate
      // fires when remaining < 5 s + reserve.
      const log = vi.fn();
      const outcome = await processTradeResearchJob(
        writer, job(), "worker", () => NOW, undefined, log,
        Date.now() + 8_000,   // ~8 s < 5 s (match) + 8 s (reserve) → checkpoint at match gate
      );
      expect(outcome).toBe("retry");
      // FDA attempt was recorded (cache-hit path completed).
      expect(state.attempts[0]).toMatchObject({ state: "skipped_cached" });
      // Then the match gate fired → released + no finalize.
      expect(state.released).toHaveLength(1);
      expect(state.finalized).toHaveLength(0);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({
        event: "job_checkpointed_runtime_budget",
      }));
    });

    it("resumed job with previous attempt = completed + fresh snapshot → NO new attempt, NO refetch, goes straight to match/finalize", async () => {
      const { state, writer } = memoryWriter();
      // Simulate a previous partial run that already finished the FDA attempt.
      (writer as unknown as {
        latestAttempt: ReturnType<typeof vi.fn>;
      }).latestAttempt = vi.fn(async () => ({
        id: "prev-attempt", attempt_number: 1, state: "completed",
      }));
      // Even with a WORKER's start-of-loop deadline that would otherwise
      // reject a cold FDA path, a resumed job with a completed attempt
      // skips the FDA gate entirely.
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const outcome = await processTradeResearchJob(
        writer, job(), "worker", () => NOW, fetchImpl, undefined,
        Date.now() + 60_000,
      );
      expect(outcome).toBe("completed");
      expect(fetchImpl).not.toHaveBeenCalled();
      // Existing attempt was reused — no new startAttempt or finishAttempt.
      expect((writer as unknown as { startAttempt: ReturnType<typeof vi.fn> }).startAttempt).not.toHaveBeenCalled();
      expect(state.attempts).toHaveLength(0);
      // Terminal outcome present.
      expect(state.finalized[0]).toMatchObject({ status: "completed" });
    });

    it("no deadline plumbed → worker behaves like before (backward-compatible)", async () => {
      const { state, writer } = memoryWriter();
      const outcome = await processTradeResearchJob(writer, job(), "worker", () => NOW);
      expect(outcome).toBe("completed");
      expect(state.released).toHaveLength(0);
      expect(state.finalized[0]).toMatchObject({ outcome: "official_importer_program_corroboration" });
    });

    it("advanceStage is idempotent — a resumed job whose stage is already at/past target does NOT re-advance", async () => {
      const { state, writer } = memoryWriter();
      const resumingJob = { ...job(), stage: "resolving_company_matches" as const };
      const outcome = await processTradeResearchJob(
        writer, resumingJob, "worker", () => NOW, undefined, undefined,
        Date.now() + 60_000,
      );
      expect(outcome).toBe("completed");
      // planning_sources / screening_sources / resolving_company_matches
      // are already-past. Only checking_trade_activity + finalizing should
      // have called writer.advance.
      const stages = (writer.advance as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
      expect(stages).not.toContain("planning_sources");
      expect(stages).not.toContain("screening_sources");
      expect(stages).not.toContain("resolving_company_matches");
      expect(stages).toContain("checking_trade_activity");
      expect(stages).toContain("finalizing");
      // Job still finalises with sourcesChecked=1 (evidence preserved from
      // the reused snapshot + match).
      expect(state.finalized[0]).toMatchObject({ result: { sourcesChecked: 1 } });
    });
  });

  it("allows only one of two overlapping drains to claim a shared job", async () => {
    let available = true;
    const { writer } = memoryWriter({ plan: undefined });
    Object.assign(writer as object, {
      claim: vi.fn(async () => {
        if (!available) return undefined;
        available = false;
        return job();
      }),
      recoverClaimedJob: vi.fn(),
    });
    const [first, second] = await Promise.all([
      drainTradeResearch({ writer, workerId: "worker-a", maxJobs: 1 }),
      drainTradeResearch({ writer, workerId: "worker-b", maxJobs: 1 }),
    ]);
    expect([first.claimed, second.claimed].sort()).toEqual([0, 1]);
    expect(first.claimed + second.claimed).toBe(1);
  });
});
