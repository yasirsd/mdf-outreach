import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { InternalJobRow, TradeResearchWriter } from "../repository";
import type { ResearchContext, TradeResearchProviderResult, TradeResearchSourceEvidence } from "../types";
import type { TradeResearchProviderDescriptor } from "../providers";
import { TradeResearchLeaseLostError } from "../repository";
import {
  DEFAULT_TRADE_RESEARCH_PROVIDER_REGISTRY,
  createTradeResearchProviderRegistry,
  type ProviderExecutionResult,
  type TradeResearchProviderExecutor,
} from "./providerExecutors";
import { processTradeResearchJob } from "./worker";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const CONTEXT: ResearchContext = {
  workspaceId: "workspace", candidateId: "candidate", marketCountryCode: "US",
  productId: "guntur-dry-red-chilli", productForm: "whole",
  researchGoal: "screen_trade_activity", providerPlanVersion: "trade-planner-v1",
  interpretationVersion: "trade-interpretation-v1",
};

function descriptor(id: string): TradeResearchProviderDescriptor {
  return {
    id, displayName: id, version: `${id}-v1`, costClass: "free", countries: ["US"],
    roles: ["COMPANY_MATCH"], automationAllowed: true, termsApproved: true,
    termsVersion: "test-v1", datasetCadence: "annual", cacheMaxAgeDays: 1,
    compatiblePlannerVersions: ["trade-planner-v1"],
  };
}

function plan(providerId: string, sequence: number, over: Record<string, unknown> = {}) {
  return {
    id: `plan-${providerId}`, provider_id: providerId, sequence, eligibility: "eligible",
    decision_reason: "eligible", cost_class: "free", automatic_spend_rupees: 0, ...over,
  };
}

function job(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "job", batch_id: "batch", workspace_id: "workspace", candidate_id: "candidate",
    product_id: CONTEXT.productId, country_code: "US", status: "running",
    stage: "preparing_identity", revision: 1, research_context: CONTEXT, ...over,
  };
}

function evaluated(providerId: string, status: "completed" | "no_match" | "cached" = "completed"): ProviderExecutionResult {
  const noMatch = status === "no_match";
  const source = {
    providerId: providerId as TradeResearchSourceEvidence["providerId"],
    outcome: status === "cached" ? "cache_hit" : noMatch ? "no_match" : "completed",
    source: "FDA FSVP", datasetPeriod: "2026", retrievedAt: NOW.toISOString(),
    candidateName: "Candidate", identityDecision: noMatch ? "none" : "strong",
    matchReason: "test", coverageExplanation: "test",
    companyEvidence: noMatch ? "no_verified_match" : "verified",
    productEvidence: "not_available", originEvidence: "not_available",
    shipmentEvidence: "not_verified", attribution: "test",
  } as TradeResearchSourceEvidence;
  const providerResult: TradeResearchProviderResult = {
    providerId, datasetId: `${providerId}-dataset`, datasetVersion: `${providerId}-hash`,
    parserVersion: `${providerId}-parser`, sourceRecordIds: noMatch ? [] : [`${providerId}-row`],
    sourcePeriod: "2026", retrievedAt: NOW.toISOString(), execution: { status, safeErrorCode: null },
    evidence: {
      matchDecision: source.identityDecision,
      companyEvidence: { state: source.companyEvidence, explanation: "test" },
      productEvidence: { state: "not_available", explanation: "test" },
      originEvidence: { state: "not_available", explanation: "test" },
      shipmentEvidence: { state: "not_verified", explanation: "test" },
      programEvidence: { state: noMatch ? "no_verified_match" : "verified", explanation: "test" },
      coverage: { state: "covered", explanation: "test" }, limitations: [], attribution: "test",
      mappingScope: {
        marketCountryCode: "US", productId: CONTEXT.productId, productForm: CONTEXT.productForm,
        sourceProductCodes: [], companyGrain: "company_record", productGrain: "not_available",
        originGrain: "not_available", shipmentGrain: "not_available", programGrain: "company_program",
      },
      interpretationVersion: CONTEXT.interpretationVersion, conflicts: [],
    },
  };
  return { status, providerResult, sourceEvidence: source, recordCount: 1, matchCount: noMatch ? 0 : 1 };
}

function checkpoint(providerId: string, status: "completed" | "no_match" | "cached" = "completed", attemptNumber = 1) {
  const result = evaluated(providerId, status);
  if (!("providerResult" in result)) throw new Error("invalid fixture");
  return {
    id: `attempt-${providerId}-${attemptNumber}`, provider_plan_id: `plan-${providerId}`, attempt_number: attemptNumber,
    state: status === "cached" ? "skipped_cached" : status === "no_match" ? "completed_no_match" : "completed",
    provider_result: result.providerResult,
  };
}

function executor(
  providerId: string,
  execute: TradeResearchProviderExecutor["execute"] = vi.fn(async () => evaluated(providerId)),
  fresh = true,
): TradeResearchProviderExecutor {
  return {
    providerId, descriptor: descriptor(providerId), requiredStartBudgetMs: 25_000,
    hasFreshSnapshot: vi.fn(async () => fresh), execute,
  };
}

function fixture(input: {
  plans: Array<Record<string, unknown>>;
  attempts?: Map<string, Record<string, unknown>>;
  cancelled?: boolean;
  heartbeatThrows?: boolean;
}) {
  const attempts = input.attempts ?? new Map<string, Record<string, unknown>>();
  const startedById = new Map<string, { planId: string; attemptNumber: number }>();
  const state = {
    starts: [] as Array<{ planId: string; attemptNumber: number }>,
    finishes: [] as Array<{ id: string; patch: Record<string, unknown>; result?: TradeResearchProviderResult }>,
    events: [] as Array<{ event: string; details: Record<string, unknown> }>,
    finalized: [] as Array<{ status: string; outcome: string; result: Record<string, unknown> }>,
    releases: 0, heartbeats: 0, reconciled: [] as string[],
  };
  const writer = {
    getProviderPlans: vi.fn(async () => input.plans),
    getEligiblePlans: vi.fn(async () => input.plans.filter((p) => p.eligibility === "eligible")),
    getEligiblePlan: vi.fn(async () => input.plans.find((p) => p.eligibility === "eligible")),
    isCancellationRequested: vi.fn(async () => Boolean(input.cancelled)),
    refreshOwnedJob: vi.fn(async () => job({ status: "cancel_requested", revision: 2 })),
    advance: vi.fn(async (row: InternalJobRow, _owner: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    latestAttempt: vi.fn(async (planId: string) => attempts.get(planId)),
    reconcileStaleAttempt: vi.fn(async (_row: InternalJobRow, _owner: string, id: string) => { state.reconciled.push(id); }),
    startAttempt: vi.fn(async (_row: InternalJobRow, planId: string, attemptNumber: number) => {
      const id = `new-${planId}-${attemptNumber}`;
      state.starts.push({ planId, attemptNumber }); startedById.set(id, { planId, attemptNumber });
      return { id, attempt_number: attemptNumber };
    }),
    finishAttempt: vi.fn(async (_row: InternalJobRow, _owner: string, id: string, patch: Record<string, unknown>) => {
      state.finishes.push({ id, patch });
      const started = startedById.get(id);
      if (started) attempts.set(started.planId, { id, provider_plan_id: started.planId, attempt_number: started.attemptNumber, ...patch });
    }),
    finishAttemptWithCheckpoint: vi.fn(async (_row: InternalJobRow, _owner: string, id: string, patch: Record<string, unknown>, result: TradeResearchProviderResult) => {
      state.finishes.push({ id, patch, result });
      const started = startedById.get(id);
      if (started) attempts.set(started.planId, { id, provider_plan_id: started.planId, attempt_number: started.attemptNumber, ...patch, provider_result: result });
    }),
    appendEvent: vi.fn(async (_row: InternalJobRow, event: string, details: Record<string, unknown>) => { state.events.push({ event, details }); }),
    release: vi.fn(async (row: InternalJobRow) => { state.releases += 1; return { ...row, revision: row.revision + 1 }; }),
    heartbeat: vi.fn(async (row: InternalJobRow) => {
      state.heartbeats += 1;
      if (input.heartbeatThrows) throw new TradeResearchLeaseLostError();
      return { ...row, revision: row.revision + 1 };
    }),
    finalize: vi.fn(async (row: InternalJobRow, _owner: string, status: string, outcome: string, result: Record<string, unknown>) => {
      state.finalized.push({ status, outcome, result }); return { ...row, status, outcome, stage: "complete", revision: row.revision + 1 };
    }),
    getCandidate: vi.fn(async () => ({ id: "candidate", companyName: "Candidate", country: "United States", discoveryStatus: "ready", reviewStatus: "pending" })),
  };
  return { writer: writer as unknown as TradeResearchWriter, state, attempts };
}

describe("T11 provider registry and generic execution", () => {
  it.each(["fda-fsvp", "fda-vqip", "canada-cid"])("resolves the production %s adapter", (providerId) => {
    expect(DEFAULT_TRADE_RESEARCH_PROVIDER_REGISTRY.resolve(providerId)?.providerId).toBe(providerId);
  });

  it.each([1, 2, 3, 5])("uses the same ordered lifecycle for %i providers", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `generic-${index + 1}`);
    const calls: string[] = [];
    const executors = ids.map((id) => executor(id, vi.fn(async () => { calls.push(id); return evaluated(id); })));
    const fx = fixture({ plans: ids.map((id, index) => plan(id, index + 1)) });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, createTradeResearchProviderRegistry(executors));
    expect(calls).toEqual(ids);
    expect(fx.state.starts.map((item) => item.attemptNumber)).toEqual(Array(count).fill(1));
    expect((fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((r) => r.providerId)).toEqual(ids);
    expect(fx.state.finalized[0]!.result.automaticSpendRupees).toBe(0);
  });

  it.each(["completed", "no_match"] as const)("handles one-provider %s", async (status) => {
    const id = `one-${status}`;
    const fx = fixture({ plans: [plan(id, 1)] });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([executor(id, vi.fn(async () => evaluated(id, status)))]));
    expect((fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[])[0]!.execution.status).toBe(status);
  });

  it.each(["failed_retryable", "failed_terminal"] as const)("handles one-provider %s safely", async (status) => {
    const id = `one-${status}`;
    const fx = fixture({ plans: [plan(id, 1)] });
    const result: ProviderExecutionResult = { status, safeErrorCode: status === "failed_retryable" ? "NETWORK_TIMEOUT" : "PROVIDER_FAILURE", retryable: status === "failed_retryable" };
    const outcome = await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([executor(id, vi.fn(async () => result))]));
    expect(outcome).toBe(status === "failed_retryable" ? "retry" : "failed");
    expect(fx.state.finishes[0]!.patch.state).toBe(status === "failed_retryable" ? "retry_wait" : "failed_terminal");
  });

  it.each(["completed", "cached"] as const)("reuses a %s checkpoint without invoking its executor", async (status) => {
    const id = `checkpoint-${status}`;
    const run = vi.fn(async () => evaluated(id));
    const attempts = new Map([[`plan-${id}`, checkpoint(id, status)]]);
    const fx = fixture({ plans: [plan(id, 1)], attempts });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([executor(id, run)]));
    expect(run).not.toHaveBeenCalled();
    expect(fx.state.starts).toEqual([]);
    expect(fx.state.events).toEqual([]);
  });

  it("keeps two-provider mixed success/no-match and success/failure outcomes", async () => {
    const a = executor("a", vi.fn(async () => evaluated("a")));
    const b = executor("b", vi.fn(async () => evaluated("b", "no_match")));
    const fx = fixture({ plans: [plan("a", 1), plan("b", 2)] });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, createTradeResearchProviderRegistry([a, b]));
    expect((fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((r) => r.execution.status)).toEqual(["completed", "no_match"]);

    const fail = executor("b", vi.fn(async (): Promise<ProviderExecutionResult> => ({ status: "failed_terminal", safeErrorCode: "SOURCE_UNAVAILABLE", retryable: false })));
    const fx2 = fixture({ plans: [plan("a", 1), plan("b", 2)] });
    await processTradeResearchJob(fx2.writer, job(), "worker", () => NOW, undefined, undefined, undefined, createTradeResearchProviderRegistry([a, fail]));
    expect((fx2.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((r) => r.execution.status)).toEqual(["completed", "failed_terminal"]);
  });

  it("honors unsupported and blocked plans without executor invocation", async () => {
    const run = vi.fn(async () => evaluated("eligible"));
    const fx = fixture({ plans: [
      plan("eligible", 1),
      plan("unsupported", 2, { eligibility: "ineligible", decision_reason: "wrong_country", cost_class: "unsupported" }),
      plan("blocked", 3, { eligibility: "ineligible", decision_reason: "manual_only", cost_class: "unsupported" }),
    ] });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, createTradeResearchProviderRegistry([executor("eligible", run)]));
    expect(run).toHaveBeenCalledTimes(1);
    expect((fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((r) => r.execution.status)).toEqual(["completed", "unsupported", "blocked"]);
  });

  it("resumes five providers after provider 2 and skips every valid checkpoint", async () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const attempts = new Map([["plan-p1", checkpoint("p1")], ["plan-p2", checkpoint("p2", "cached")]]);
    const calls: string[] = [];
    const fx = fixture({ plans: ids.map((id, i) => plan(id, i + 1)), attempts });
    const registry = createTradeResearchProviderRegistry(ids.map((id) => executor(id, vi.fn(async (): Promise<ProviderExecutionResult> => {
      calls.push(id);
      return id === "p3" ? { status: "failed_terminal", safeErrorCode: "SOURCE_UNAVAILABLE", retryable: false } : evaluated(id);
    }))));
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, registry);
    expect(calls).toEqual(["p3", "p4", "p5"]);
    expect(fx.state.starts.map((s) => s.planId)).toEqual(["plan-p3", "plan-p4", "plan-p5"]);
    expect((fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((r) => r.execution.status)).toEqual(["completed", "cached", "failed_terminal", "completed", "completed"]);
  });

  it("does not retry failed_terminal and increments a retryable attempt monotonically", async () => {
    const terminalRun = vi.fn(async () => evaluated("terminal"));
    const terminalFx = fixture({ plans: [plan("terminal", 1)], attempts: new Map([["plan-terminal", { id: "old", attempt_number: 1, state: "failed_terminal", safe_error_code: "SOURCE_UNAVAILABLE" }]]) });
    await processTradeResearchJob(terminalFx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, createTradeResearchProviderRegistry([executor("terminal", terminalRun)]));
    expect(terminalRun).not.toHaveBeenCalled();

    const retryFx = fixture({ plans: [plan("retry", 1)], attempts: new Map([["plan-retry", { id: "old", attempt_number: 1, state: "failed_retryable", safe_error_code: "NETWORK_TIMEOUT" }]]) });
    await processTradeResearchJob(retryFx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, createTradeResearchProviderRegistry([executor("retry") ]));
    expect(retryFx.state.starts).toEqual([{ planId: "plan-retry", attemptNumber: 2 }]);
  });

  it("prevents an unsafe late start and passes the shared remaining deadline", async () => {
    const seen: number[] = [];
    const late = executor("late", vi.fn(async ({ deadline }) => { seen.push(deadline.remainingMs()); return evaluated("late"); }));
    const lateFx = fixture({ plans: [plan("late", 1)] });
    await expect(processTradeResearchJob(lateFx.writer, job(), "worker", () => NOW, undefined, undefined, Date.now() + 1, createTradeResearchProviderRegistry([late])))
      .resolves.toBe("retry");
    expect(late.execute).not.toHaveBeenCalled();
    expect(lateFx.state.releases).toBe(1);

    const okFx = fixture({ plans: [plan("late", 1)] });
    await processTradeResearchJob(okFx.writer, job(), "worker", () => NOW, undefined, undefined, Date.now() + 60_000, createTradeResearchProviderRegistry([late]));
    expect(seen[0]).toBeGreaterThan(0);
  });

  it.each(["fda-fsvp", "fda-vqip", "canada-cid"])("uses the shared heartbeat wrapper for %s", async (id) => {
    const fx = fixture({ plans: [plan(id, 1)] });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([executor(id)]));
    expect(fx.state.heartbeats).toBe(1);
  });

  it("stops all writes after the shared heartbeat loses the lease", async () => {
    const fx = fixture({ plans: [plan("lease", 1)], heartbeatThrows: true });
    await expect(processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([executor("lease")]))).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    expect(fx.state.finishes).toEqual([]);
    expect(fx.state.finalized).toEqual([]);
  });

  it("delivers an immutable, unchanged T07 context to every provider", async () => {
    const received: ResearchContext[] = [];
    const ids = ["context-a", "context-b", "context-c"];
    const registry = createTradeResearchProviderRegistry(ids.map((id) => executor(id, vi.fn(async ({ context }) => {
      received.push(context as ResearchContext);
      expect(Object.isFrozen(context)).toBe(true);
      expect(() => { (context as ResearchContext).productId = "replacement"; }).toThrow();
      return evaluated(id);
    }))));
    const fx = fixture({ plans: ids.map((id, i) => plan(id, i + 1)) });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, registry);
    expect(received).toEqual([CONTEXT, CONTEXT, CONTEXT]);
  });

  it("persists success through the v2 checkpoint path and preserves complete T08/T09 output", async () => {
    const fx = fixture({ plans: [plan("typed", 1)] });
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([executor("typed")]));
    expect(fx.state.finishes[0]!.result).toMatchObject({ providerId: "typed", execution: { status: "completed", safeErrorCode: null } });
    expect(fx.state.finalized[0]!.result).toMatchObject({ automaticSpendRupees: 0 });
    expect(fx.state.finalized[0]!.result.providerResults).toHaveLength(1);
    expect(fx.state.finalized[0]!.result.aggregate).toBeDefined();
  });

  it("makes an unknown provider visible as failed_terminal UNKNOWN_PROVIDER", async () => {
    const fx = fixture({ plans: [plan("unknown", 1)] });
    await expect(processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined,
      createTradeResearchProviderRegistry([]))).resolves.toBe("failed");
    expect(fx.state.finishes[0]!.patch).toMatchObject({ state: "failed_terminal", safe_error_code: "UNKNOWN_PROVIDER" });
    expect((fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[])[0]).toMatchObject({
      providerId: "unknown", execution: { status: "failed_terminal", safeErrorCode: "UNKNOWN_PROVIDER" }, evidence: null,
    });
  });

  it("normalizes thrown errors without persisting raw text", async () => {
    const secret = "Bearer super-secret-token";
    const fx = fixture({ plans: [plan("thrower", 1)] });
    const registry = createTradeResearchProviderRegistry([executor("thrower", vi.fn(async () => { throw new Error(secret); }))]);
    await processTradeResearchJob(fx.writer, job(), "worker", () => NOW, undefined, undefined, undefined, registry);
    expect(fx.state.finishes[0]!.patch).toMatchObject({ state: "failed_terminal", safe_error_code: "PROVIDER_FAILURE" });
    expect(JSON.stringify({ state: fx.state, attempts: [...fx.attempts.values()] })).not.toContain(secret);
  });

  it("prevents provider-name branching from returning to the core loop", () => {
    const source = readFileSync("src/lib/tradeResearch/server/worker.ts", "utf8");
    const core = source.slice(source.indexOf("async function processProviderPlans("), source.indexOf("export function aggregateProviderEvidence("));
    expect(core).not.toMatch(/fda-fsvp|fda-vqip|canada-cid/);
    expect(core).not.toMatch(/switch\s*\(\s*providerId\s*\)/);
  });
});
