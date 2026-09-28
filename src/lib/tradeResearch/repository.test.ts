import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TradeResearchContractError,
  TradeResearchLeaseLostError,
  TradeResearchWriter,
  createTradeResearchReadRepository,
  mapTradeResearchJob,
  type InternalJobRow,
} from "./repository";
import { fingerprintResearchContext } from "./context";
import type { ResearchContext } from "./types";
import { safeTradeResearchErrorCode, safeTradeResearchErrorMetadata } from "./server/diagnostics";

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
  lease_owner: "worker-a",
};

function clientWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = async () => ({ data: [], error: null });
  return { rpc, from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe("T06 additive result_summary mapping", () => {
  it("preserves explicit context and typed provider results without fabricating legacy context", () => {
    const context: ResearchContext = {
      workspaceId: claimed.workspace_id,
      candidateId: claimed.candidate_id,
      marketCountryCode: "US",
      productId: claimed.product_id!,
      productForm: null,
      researchGoal: "screen_trade_activity",
      providerPlanVersion: "trade-planner-v1",
      interpretationVersion: "trade-interpretation-v1",
    };
    const contextFingerprint = fingerprintResearchContext(context);
    const result = mapTradeResearchJob({
      id: claimed.id,
      batch_id: claimed.batch_id,
      candidate_id: claimed.candidate_id,
      product_id: claimed.product_id,
      country_code: claimed.country_code,
      requested_goal: "screen_trade_activity",
      status: "completed",
      stage: "complete",
      outcome: "no_verified_evidence",
      revision: 2,
      automatic_spend_rupees: 0,
      created_at: "2026-09-28T00:00:00Z",
      research_context: context,
      context_fingerprint: contextFingerprint,
      result_summary: {
        context,
        contextFingerprint,
        providerResults: [],
      },
    });

    expect(result.result.context).toMatchObject({ productId: "guntur-dry-red-chilli", marketCountryCode: "US" });
    expect(result.result.providerResults).toEqual([]);
    expect(mapTradeResearchJob({
      id: claimed.id,
      batch_id: claimed.batch_id,
      candidate_id: claimed.candidate_id,
      country_code: "US",
      requested_goal: "screen_trade_activity",
      status: "completed",
      stage: "complete",
      revision: 1,
      automatic_spend_rupees: 0,
      created_at: "2026-09-28T00:00:00Z",
      result_summary: { context, contextFingerprint },
    }).result.context).toBeUndefined();
  });
});

describe("T07 exact-context repository reads", () => {
  it("returns chilli only for the chilli fingerprint and never for mango", async () => {
    const chilli: ResearchContext = {
      workspaceId: claimed.workspace_id,
      candidateId: claimed.candidate_id,
      marketCountryCode: "US",
      productId: "guntur-dry-red-chilli",
      productForm: null,
      researchGoal: "screen_trade_activity",
      providerPlanVersion: "trade-planner-v1",
      interpretationVersion: "trade-interpretation-v1",
    };
    const mango = { ...chilli, productId: "banganapalli-mango" };
    const chilliFingerprint = fingerprintResearchContext(chilli);
    const filters = new Map<string, unknown>();
    const row = {
      id: claimed.id,
      batch_id: claimed.batch_id,
      candidate_id: claimed.candidate_id,
      product_id: chilli.productId,
      country_code: "US",
      requested_goal: "screen_trade_activity",
      status: "completed",
      stage: "complete",
      outcome: "no_verified_evidence",
      revision: 2,
      automatic_spend_rupees: 0,
      created_at: "2026-09-28T00:00:00Z",
      research_context: chilli,
      context_fingerprint: chilliFingerprint,
      result_summary: {},
    };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((field: string, value: unknown) => { filters.set(field, value); return builder; }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data: filters.get("context_fingerprint") === chilliFingerprint ? row : null,
        error: null,
      })),
    };
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
    const repository = createTradeResearchReadRepository(client, claimed.workspace_id);

    await expect(repository.getLatestJobForContext(claimed.candidate_id, chilliFingerprint))
      .resolves.toMatchObject({ productId: "guntur-dry-red-chilli", contextFingerprint: chilliFingerprint });
    await expect(repository.getLatestJobForContext(
      claimed.candidate_id,
      fingerprintResearchContext(mango),
    )).resolves.toBeUndefined();
  });

  it.each(["queued", "running", "failed", "cancelled", "completed"] as const)(
    "preserves the authoritative context when a job is %s",
    (status) => {
      const context: ResearchContext = {
        workspaceId: claimed.workspace_id,
        candidateId: claimed.candidate_id,
        marketCountryCode: "US",
        productId: "guntur-dry-red-chilli",
        productForm: null,
        researchGoal: "screen_trade_activity",
        providerPlanVersion: "trade-planner-v1",
        interpretationVersion: "trade-interpretation-v1",
      };
      const contextFingerprint = fingerprintResearchContext(context);
      const mapped = mapTradeResearchJob({
        ...claimed,
        status,
        stage: status === "queued" || status === "running" ? claimed.stage : "complete",
        research_context: context,
        context_fingerprint: contextFingerprint,
        automatic_spend_rupees: 0,
        result_summary: {},
      });
      expect(mapped.context).toEqual(context);
      expect(mapped.contextFingerprint).toBe(contextFingerprint);
      expect(mapped.result).toMatchObject({ context, contextFingerprint });
    },
  );

  it("keeps a historical both-null row contextless", () => {
    const mapped = mapTradeResearchJob({
      ...claimed,
      research_context: null,
      context_fingerprint: null,
      automatic_spend_rupees: 0,
      result_summary: {},
    });
    expect(mapped.context).toBeUndefined();
    expect(mapped.contextFingerprint).toBeUndefined();
    expect(mapped.result.context).toBeUndefined();
  });
});

describe("TradeResearchWriter RPC contract", () => {
  it("keeps a catalogue product slug in text while validating create-time UUID fields", async () => {
    const batch = {
      id: "00000000-0000-4000-8000-000000000010", status: "queued", requested_goal: "screen_trade_activity",
      total_jobs: 1, queued_count: 1, running_count: 0, completed_count: 0, partial_count: 0,
      needs_review_count: 0, failed_count: 0, cancelled_count: 0, corroborated_count: 0,
      automatic_spend_rupees: 0, created_at: "2026-09-25T12:00:00Z",
    };
    const input = {
      workspaceId: claimed.workspace_id, createdBy: "00000000-0000-4000-8000-000000000005",
      requestedGoal: "screen_trade_activity", productId: "", countryCode: "", plannerVersion: "trade-planner-v1",
      jobs: [{
        candidateId: claimed.candidate_id, productId: "guntur-dry-red-chilli", countryCode: "US", supersedesJobId: "",
        context: {
          workspaceId: claimed.workspace_id,
          candidateId: claimed.candidate_id,
          marketCountryCode: "US",
          productId: "guntur-dry-red-chilli",
          productForm: null,
          researchGoal: "screen_trade_activity",
          providerPlanVersion: "trade-planner-v1",
          interpretationVersion: "trade-interpretation-v1",
        },
        contextFingerprint: fingerprintResearchContext({
          workspaceId: claimed.workspace_id,
          candidateId: claimed.candidate_id,
          marketCountryCode: "US",
          productId: "guntur-dry-red-chilli",
          productForm: null,
          researchGoal: "screen_trade_activity",
          providerPlanVersion: "trade-planner-v1",
          interpretationVersion: "trade-interpretation-v1",
        }),
        plans: [{ providerId: "fda-fsvp", eligibility: "eligible", costClass: "free", sequence: 1 }],
      }],
    };
    const rpc = vi.fn(async () => ({ data: batch, error: null }));
    await expect(new TradeResearchWriter(clientWithRpc(rpc)).createBatch(input)).resolves.toMatchObject({ id: batch.id });
    expect(rpc).toHaveBeenCalledWith("create_buyer_trade_research_batch", { p_input: input });

    const invalid = { ...input, jobs: [{ ...input.jobs[0], candidateId: "guntur-dry-red-chilli" }] };
    const rejectedRpc = vi.fn();
    await expect(new TradeResearchWriter(clientWithRpc(rejectedRpc)).createBatch(invalid))
      .rejects.toMatchObject({ expectedSqlType: "uuid", fieldName: "p_input.jobs[0].candidateId" });
    expect(rejectedRpc).not.toHaveBeenCalled();
  });

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

  it("treats PostgREST's all-null scalar-composite claim as no work", async () => {
    const nullComposite = Object.fromEntries(Object.keys(claimed).map((key) => [key, null]));
    const rpc = vi.fn(async () => ({ data: nullComposite, error: null }));
    const from = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient;
    expect(await new TradeResearchWriter(client).claim("worker-a")).toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts catalogue product slugs and nullable product identity because product_id is SQL text", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: claimed, error: null })
      .mockResolvedValueOnce({ data: { ...claimed, product_id: null }, error: null });
    const writer = new TradeResearchWriter(clientWithRpc(rpc));
    expect((await writer.claim("worker-a"))?.product_id).toBe("guntur-dry-red-chilli");
    expect((await writer.claim("worker-a"))?.product_id).toBeNull();
  });

  it("rejects an invalid UUID claim identity before any post-claim query", async () => {
    const rpc = vi.fn(async () => ({ data: { ...claimed, batch_id: "guntur-dry-red-chilli" }, error: null }));
    const from = vi.fn();
    const writer = new TradeResearchWriter({ rpc, from } as unknown as SupabaseClient);
    const failure = writer.claim("worker-a");
    await expect(failure).rejects.toBeInstanceOf(TradeResearchContractError);
    await expect(failure).rejects.toMatchObject({ fieldName: "job.batch_id", expectedSqlType: "uuid", suppliedCategory: "string" });
    expect(from).not.toHaveBeenCalled();
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

  it("finalizes through the revision-CAS v2 RPC and adopts the terminal revision", async () => {
    const finalized: InternalJobRow = {
      ...claimed, status: "completed", stage: "complete", revision: 2, lease_owner: null,
    };
    const rpc = vi.fn(async () => ({ data: finalized, error: null }));
    const result = await new TradeResearchWriter(clientWithRpc(rpc)).finalize(
      claimed,
      "worker-a",
      "completed",
      "no_verified_evidence",
      {
        automaticSpendRupees: 0, officialProgramEvidence: "not_checked", productEvidence: "not_available",
        indiaOrigin: "not_verified", originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0,
      },
    );

    expect(rpc).toHaveBeenCalledWith("finalize_buyer_trade_research_job_v2", expect.objectContaining({
      p_job_id: claimed.id,
      p_worker_id: "worker-a",
      p_revision: 1,
    }));
    expect(result).toEqual(finalized);
  });

  it("adds an omitted failed provider from durable plans and attempts before finalization", async () => {
    const finalized: InternalJobRow = { ...claimed, status: "partial", stage: "complete", revision: 2, lease_owner: null };
    const rpc = vi.fn(async () => ({ data: finalized, error: null }));
    const rows: Record<string, unknown[]> = {
      buyer_trade_research_provider_plans: [{
        id: "plan-1", provider_id: "fda-vqip", sequence: 1,
        eligibility: "eligible", decision_reason: "eligible", dataset_version: null,
      }],
      buyer_trade_research_attempts: [{
        provider_plan_id: "plan-1", attempt_number: 1, state: "failed_terminal", safe_error_code: "SOURCE_UNAVAILABLE",
      }],
    };
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = async () => ({ data: rows[table] ?? [], error: null });
      return chain;
    });
    const writer = new TradeResearchWriter({ rpc, from } as unknown as SupabaseClient);
    await writer.finalize(claimed, "worker-a", "partial", "partial", {
      automaticSpendRupees: 0, officialProgramEvidence: "not_checked", productEvidence: "not_available",
      indiaOrigin: "not_verified", originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0,
      providerResults: [],
    });
    expect(rpc).toHaveBeenCalledWith("finalize_buyer_trade_research_job_v2", expect.objectContaining({
      p_result_summary: expect.objectContaining({
        sourcesPlanned: 1, sourcesAttempted: 1, sourcesFailed: 1,
        providerResults: [expect.objectContaining({
          providerId: "fda-vqip",
          execution: { status: "failed_terminal", safeErrorCode: "SOURCE_UNAVAILABLE" },
          evidence: null,
        })],
        aggregate: expect.objectContaining({
          identitySummary: expect.objectContaining({ state: "not_evaluated" }),
          coverageCounts: expect.objectContaining({ planned: 1, evaluated: 0, failed: 1 }),
        }),
      }),
    }));
  });

  it.each([
    ["stale revision", { code: "P0001", message: "STALE_JOB_REVISION" }],
    ["wrong lease owner", { code: "P0001", message: "STALE_JOB_REVISION" }],
  ])("classifies %s finalization as lease loss", async (_label, databaseError) => {
    const rpc = vi.fn(async () => ({ data: null, error: databaseError }));
    await expect(new TradeResearchWriter(clientWithRpc(rpc)).finalize(
      claimed, "worker-b", "completed", "no_verified_evidence", {
        automaticSpendRupees: 0, officialProgramEvidence: "not_checked", productEvidence: "not_available",
        indiaOrigin: "not_verified", originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0,
      },
    )).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
  });

  it("finishes an attempt only through the fenced RPC with authoritative job context", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000006";
    const rpc = vi.fn(async () => ({ data: { id: attemptId, state: "completed" }, error: null }));
    await new TradeResearchWriter(clientWithRpc(rpc)).finishAttempt(
      claimed, "worker-a", attemptId,
      { state: "completed", duration_ms: 10, record_count: 2, match_count: 1 },
    );
    expect(rpc).toHaveBeenCalledWith("finish_buyer_trade_research_attempt", {
      p_attempt_id: attemptId,
      p_job_id: claimed.id,
      p_worker_id: "worker-a",
      p_revision: 1,
      p_state: "completed",
      p_safe_error_code: null,
      p_duration_ms: 10,
      p_record_count: 2,
      p_match_count: 1,
    });
  });

  it("fences stale attempt completion and stale-attempt reconciliation", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000006";
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "STALE_JOB_REVISION" } }));
    const writer = new TradeResearchWriter(clientWithRpc(rpc));
    await expect(writer.finishAttempt(claimed, "worker-a", attemptId, { state: "failed_terminal" }))
      .rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    await expect(writer.reconcileStaleAttempt(claimed, "worker-a", attemptId, "STALE_LEASE_RECOVERED"))
      .rejects.toBeInstanceOf(TradeResearchLeaseLostError);
  });

  it("uses the fenced reconciliation RPC and accepts an idempotent null attempt result", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000006";
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await expect(new TradeResearchWriter(clientWithRpc(rpc)).reconcileStaleAttempt(
      claimed, "worker-a", attemptId, "STALE_LEASE_RECOVERED",
    )).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("reconcile_buyer_trade_research_attempt", {
      p_attempt_id: attemptId,
      p_job_id: claimed.id,
      p_worker_id: "worker-a",
      p_revision: 1,
      p_safe_error_code: "STALE_LEASE_RECOVERED",
    });
  });

  it("blocks invalid revision, stage, timestamp, and JSON before an RPC", async () => {
    const rpc = vi.fn();
    const writer = new TradeResearchWriter(clientWithRpc(rpc));
    await expect(writer.advance({ ...claimed, revision: "1" as unknown as number }, "worker-a", "planning_sources"))
      .rejects.toMatchObject({ expectedSqlType: "bigint", fieldName: "job.revision" });
    await expect(writer.advance(claimed, "worker-a", "not_a_stage" as InternalJobRow["stage"]))
      .rejects.toMatchObject({ expectedSqlType: "constrained_text", fieldName: "p_stage" });
    await expect(writer.release(claimed, "worker-a", "not-a-timestamp"))
      .rejects.toMatchObject({ expectedSqlType: "timestamptz", fieldName: "p_next_attempt_at" });
    await expect(writer.finalize(claimed, "worker-a", "completed", "no_verified_evidence", {
      automaticSpendRupees: 0, officialProgramEvidence: "not_checked", productEvidence: "not_available",
      indiaOrigin: "not_verified", originEvidence: "not_available", shipmentEvidence: "not_verified",
      sourcesChecked: BigInt(1) as unknown as number,
    })).rejects.toMatchObject({ expectedSqlType: "jsonb", fieldName: "p_result" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses provider and dataset identifiers as text filters, never UUID arguments", async () => {
    const query = {
      select: vi.fn(function (this: typeof query) { return this; }),
      eq: vi.fn(function (this: typeof query) { return this; }),
      gte: vi.fn(function (this: typeof query) { return this; }),
      order: vi.fn(function (this: typeof query) { return this; }),
      limit: vi.fn(function (this: typeof query) { return this; }),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    await expect(new TradeResearchWriter(client).getFreshSnapshot(new Date("2026-09-25T12:00:00Z"))).resolves.toBeNull();
    expect(query.eq).toHaveBeenCalledWith("provider_id", "fda-fsvp");
    expect(query.eq).toHaveBeenCalledWith("dataset_id", "fsvp-participant-list");
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

describe("safe database type diagnostics", () => {
  it.each([
    ["invalid input syntax for type uuid", "DATABASE_22P02_INVALID_UUID"],
    ["invalid input value for enum research_stage", "DATABASE_22P02_INVALID_ENUM"],
    ["invalid input syntax for type bigint", "DATABASE_22P02_INVALID_INTEGER"],
    ["invalid input syntax for type timestamp with time zone", "DATABASE_22P02_INVALID_TIMESTAMP"],
    ["invalid input syntax", "DATABASE_22P02_OTHER"],
  ])("classifies 22P02 without returning the offending value", (message, expected) => {
    const error = { code: "22P02", message: `${message}: secret-value` };
    expect(safeTradeResearchErrorCode(error)).toBe(expected);
    expect(safeTradeResearchErrorCode(error)).not.toContain("secret-value");
  });

  it("reports only safe field/type/category metadata for local contract failures", () => {
    const error = new TradeResearchContractError("job.batch_id", "uuid", "null");
    expect(safeTradeResearchErrorMetadata(error)).toEqual({
      fieldName: "job.batch_id", expectedSqlType: "uuid", suppliedCategory: "null", validFormat: false,
    });
  });
});
