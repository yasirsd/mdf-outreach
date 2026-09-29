import { describe, expect, it, vi } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { aggregateTradeResearchEvidence } from "../aggregation";
import type { InternalJobRow, SnapshotRow, TradeResearchWriter } from "../repository";
import type { TradeResearchProviderResult } from "../types";
import { processTradeResearchJob } from "./worker";

const NOW = new Date("2026-09-28T12:00:00.000Z");

type Plan = {
  id: string;
  provider_id: string;
  sequence: number;
  eligibility: "eligible" | "ineligible";
  decision_reason: string;
  cost_class: "free" | "unsupported";
  automatic_spend_rupees: 0;
};

function plan(providerId: string, sequence: number, over: Partial<Plan> = {}): Plan {
  return {
    id: `plan-${providerId}`, provider_id: providerId, sequence,
    eligibility: "eligible", decision_reason: "eligible", cost_class: "free",
    automatic_spend_rupees: 0, ...over,
  };
}

function job(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "job", batch_id: "batch", workspace_id: "workspace", candidate_id: "candidate",
    product_id: "guntur-dry-red-chilli", country_code: "US", status: "running",
    stage: "preparing_identity", revision: 1, lease_owner: "worker-a", ...over,
  };
}

function providerResult(
  providerId: string,
  status: "completed" | "no_match" | "cached" = "completed",
): TradeResearchProviderResult {
  const noMatch = status === "no_match";
  return {
    providerId,
    datasetId: providerId === "fda-vqip" ? "fda-vqip-participant-list" : "fsvp-participant-list",
    datasetVersion: `hash-${providerId}`,
    parserVersion: `${providerId}-parser-v1`,
    sourceRecordIds: noMatch ? [] : [`${providerId}-row-1`],
    sourcePeriod: "2026 Q2",
    retrievedAt: NOW.toISOString(),
    execution: { status, safeErrorCode: null },
    evidence: {
      matchDecision: noMatch ? "none" : "strong",
      companyEvidence: { state: noMatch ? "no_verified_match" : "verified", explanation: "provider-local identity" },
      productEvidence: { state: "not_available", explanation: "source has no product grain" },
      originEvidence: { state: "not_available", explanation: "source has no origin grain" },
      shipmentEvidence: { state: "not_verified", explanation: "source has no shipment grain" },
      programEvidence: { state: noMatch ? "no_verified_match" : "verified", explanation: "official program list" },
      coverage: { state: "covered", explanation: "published program period" },
      limitations: ["program participation only"],
      attribution: providerId,
      mappingScope: {
        marketCountryCode: "US", productId: "guntur-dry-red-chilli", productForm: null,
        sourceProductCodes: [], companyGrain: "company_record", productGrain: "not_available",
        originGrain: "not_available", shipmentGrain: "not_available", programGrain: "company_program",
      },
      interpretationVersion: "trade-interpretation-v1",
      conflicts: [],
    },
  };
}

function attemptFor(
  p: Plan,
  status: "completed" | "no_match" | "cached" = "completed",
  attemptNumber = 1,
): Record<string, unknown> {
  const state = status === "completed" ? "completed" : status === "no_match" ? "completed_no_match" : "skipped_cached";
  return {
    id: `attempt-${p.id}-${attemptNumber}`,
    provider_plan_id: p.id,
    attempt_number: attemptNumber,
    state,
    provider_result: providerResult(p.provider_id, status),
  };
}

function snapshot(providerId: "fda-fsvp" | "fda-vqip"): SnapshotRow {
  const vqip = providerId === "fda-vqip";
  return {
    id: `snapshot-${providerId}`,
    provider_id: providerId,
    dataset_id: vqip ? "fda-vqip-participant-list" : "fsvp-participant-list",
    published_period: "2026 Q2",
    source_url: "https://example.test/source",
    material_hash: `hash-${providerId}`,
    retrieved_at: NOW.toISOString(),
    expires_at: "2026-12-31T00:00:00.000Z",
    row_count: 1,
    normalized_rows: (vqip
      ? [{ firmName: "LT Foods Americas", stateCode: "CA", address: "Cypress, CA" }]
      : [{ companyName: "LT FOODS AMERICAS", stateCode: "CA" }]) as unknown as SnapshotRow["normalized_rows"],
  };
}

function candidate(): BuyerCandidate {
  return {
    id: "candidate", companyName: "LT Foods Americas", country: "United States",
    city: "Cypress, CA", industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
  };
}

function fixture(input: {
  plans: Plan[];
  attempts?: Map<string, Record<string, unknown>>;
  cancelled?: boolean;
  fresh?: Partial<Record<"fda-fsvp" | "fda-vqip", SnapshotRow | undefined>>;
}) {
  const attempts = input.attempts ?? new Map<string, Record<string, unknown>>();
  const started = new Map<string, string>();
  const state = {
    starts: [] as Array<{ planId: string; attemptNumber: number }>,
    finishes: [] as Array<{ id: string; result: TradeResearchProviderResult }>,
    reconciled: [] as string[],
    events: [] as string[],
    finalized: [] as Array<{ status: string; outcome: string; result: Record<string, unknown> }>,
    releases: 0,
  };
  const writer = {
    isCancellationRequested: vi.fn(async () => Boolean(input.cancelled)),
    refreshOwnedJob: vi.fn(async (id: string, owner: string) => ({ ...job(), id, lease_owner: owner })),
    advance: vi.fn(async (row: InternalJobRow, _owner: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getProviderPlans: vi.fn(async () => input.plans),
    getEligiblePlans: vi.fn(async () => input.plans.filter((item) => item.eligibility === "eligible")),
    getEligiblePlan: vi.fn(async () => input.plans.find((item) => item.eligibility === "eligible")),
    latestAttempt: vi.fn(async (planId: string) => attempts.get(planId)),
    reconcileStaleAttempt: vi.fn(async (_row: InternalJobRow, _owner: string, id: string) => {
      state.reconciled.push(id);
      for (const [planId, attempt] of attempts) {
        if (attempt.id === id) attempts.set(planId, { ...attempt, state: "failed_retryable", safe_error_code: "STALE_LEASE_RECOVERED" });
      }
    }),
    startAttempt: vi.fn(async (_row: InternalJobRow, planId: string, attemptNumber: number) => {
      const id = `new-${planId}-${attemptNumber}`;
      state.starts.push({ planId, attemptNumber });
      started.set(id, planId);
      return { id, attempt_number: attemptNumber };
    }),
    finishAttempt: vi.fn(async () => undefined),
    finishAttemptWithCheckpoint: vi.fn(async (
      _row: InternalJobRow, _owner: string, id: string, patch: Record<string, unknown>, result: TradeResearchProviderResult,
    ) => {
      state.finishes.push({ id, result });
      const planId = started.get(id)!;
      const startedAttempt = state.starts.find((item) => item.planId === planId)!;
      attempts.set(planId, {
        id, provider_plan_id: planId, attempt_number: startedAttempt.attemptNumber,
        state: patch.state, provider_result: result,
      });
    }),
    appendEvent: vi.fn(async (_row: InternalJobRow, event: string) => { state.events.push(event); }),
    release: vi.fn(async (row: InternalJobRow) => { state.releases += 1; return { ...row, revision: row.revision + 1, lease_owner: null }; }),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (row: InternalJobRow, _owner: string, status: string, outcome: string, result: Record<string, unknown>) => {
      state.finalized.push({ status, outcome, result });
      return { ...row, status, outcome, stage: "complete", revision: row.revision + 1, lease_owner: null };
    }),
    getFreshSnapshot: vi.fn(async () => input.fresh?.["fda-fsvp"]),
    getLatestSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async (providerId: "fda-fsvp" | "fda-vqip") => input.fresh?.[providerId]),
    getLatestSnapshotByProvider: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async () => { throw new Error("unexpected snapshot write"); }),
    refreshSnapshotExpiry: vi.fn(async () => { throw new Error("unexpected snapshot refresh"); }),
    getCandidate: vi.fn(async () => candidate()),
  };
  return { writer: writer as unknown as TradeResearchWriter, rawWriter: writer, state, attempts };
}

describe("T10 durable provider resume", () => {
  it.each([
    ["completed", "completed"],
    ["cached", "skipped_cached"],
    ["no_match", "completed_no_match"],
  ] as const)("reuses a %s checkpoint without a new attempt, provider call, match, or duplicate event", async (status, _attemptState) => {
    const p = plan("fda-fsvp", 1);
    const attempts = new Map([[p.id, attemptFor(p, status)]]);
    const { writer, rawWriter, state } = fixture({ plans: [p], attempts });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(processTradeResearchJob(writer, job(), "worker-a", () => NOW, fetchImpl)).resolves.toBe("completed");
    expect(state.starts).toEqual([]);
    expect(state.finishes).toEqual([]);
    expect(state.events).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rawWriter.getCandidate).not.toHaveBeenCalled();
    expect((state.finalized[0]!.result.providerResults as TradeResearchProviderResult[])[0].execution.status).toBe(status);
  });

  it("skips completed A and executes pending B as attempt 1", async () => {
    const a = plan("fda-fsvp", 1);
    const b = plan("fda-vqip", 2);
    const { writer, state } = fixture({
      plans: [a, b], attempts: new Map([[a.id, attemptFor(a)]]),
      fresh: { "fda-vqip": snapshot("fda-vqip") },
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(state.starts).toEqual([{ planId: b.id, attemptNumber: 1 }]);
    expect(state.finishes).toHaveLength(1);
    expect(state.finishes[0]!.result.providerId).toBe("fda-vqip");
    expect((state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((item) => item.providerId))
      .toEqual(["fda-fsvp", "fda-vqip"]);
  });

  it("skips completed A, reconciles interrupted B, and retries B as attempt 2", async () => {
    const a = plan("fda-fsvp", 1);
    const b = plan("fda-vqip", 2);
    const attempts = new Map<string, Record<string, unknown>>([
      [a.id, attemptFor(a)],
      [b.id, { id: "attempt-b-1", provider_plan_id: b.id, attempt_number: 1, state: "running" }],
    ]);
    const { writer, state } = fixture({ plans: [a, b], attempts, fresh: { "fda-vqip": snapshot("fda-vqip") } });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(state.reconciled).toEqual(["attempt-b-1"]);
    expect(state.starts).toEqual([{ planId: b.id, attemptNumber: 2 }]);
  });

  it("loads and skips completed A before a short deadline releases pending B", async () => {
    const a = plan("fda-fsvp", 1);
    const b = plan("fda-vqip", 2);
    const { writer, state } = fixture({ plans: [a, b], attempts: new Map([[a.id, attemptFor(a)]]) });
    await expect(processTradeResearchJob(writer, job(), "worker-a", () => NOW, undefined, undefined, Date.now() + 1))
      .resolves.toBe("retry");
    expect(state.starts).toEqual([]);
    expect(state.releases).toBe(1);
  });

  it("preserves completed evidence when cancellation is observed", async () => {
    const a = plan("fda-fsvp", 1);
    const b = plan("fda-vqip", 2);
    const { writer, state } = fixture({ plans: [a, b], attempts: new Map([[a.id, attemptFor(a)]]), cancelled: true });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const results = state.finalized[0]!.result.providerResults as TradeResearchProviderResult[];
    expect(state.finalized[0]).toMatchObject({ status: "cancelled", outcome: "cancelled" });
    expect(results).toHaveLength(2);
    expect(results.map((item) => item.execution.status)).toEqual(["completed", "cancelled"]);
    expect(results[0]!.evidence).not.toBeNull();
  });

  it("does not retry terminal failure and retains its safe error code", async () => {
    const p = plan("fda-fsvp", 1);
    const attempts = new Map([[p.id, {
      id: "failed", provider_plan_id: p.id, attempt_number: 1,
      state: "failed_terminal", safe_error_code: "SOURCE_UNAVAILABLE",
    }]]);
    const { writer, state } = fixture({ plans: [p], attempts });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(state.starts).toEqual([]);
    expect((state.finalized[0]!.result.providerResults as TradeResearchProviderResult[])[0])
      .toMatchObject({ execution: { status: "failed_terminal", safeErrorCode: "SOURCE_UNAVAILABLE" } });
  });

  it("retries a permitted retryable attempt monotonically and stops at exhausted attempt 3", async () => {
    const p = plan("fda-fsvp", 1);
    const retryable = new Map([[p.id, {
      id: "retry-1", provider_plan_id: p.id, attempt_number: 1,
      state: "failed_retryable", safe_error_code: "TRANSIENT_HTTP",
    }]]);
    const allowed = fixture({ plans: [p], attempts: retryable, fresh: { "fda-fsvp": snapshot("fda-fsvp") } });
    await processTradeResearchJob(allowed.writer, job(), "worker-a", () => NOW);
    expect(allowed.state.starts).toEqual([{ planId: p.id, attemptNumber: 2 }]);

    const exhausted = fixture({ plans: [p], attempts: new Map([[p.id, {
      id: "retry-3", provider_plan_id: p.id, attempt_number: 3,
      state: "failed_retryable", safe_error_code: "STALE_LEASE_RECOVERED",
    }]]) });
    await processTradeResearchJob(exhausted.writer, job(), "worker-a", () => NOW);
    expect(exhausted.state.starts).toEqual([]);
    expect(exhausted.state.finalized).toHaveLength(1);
  });

  it.each([1, 2, 3, 5])("restores %i providers once in plan sequence", async (count) => {
    const plans = Array.from({ length: count }, (_, index) => plan(`provider-${index + 1}`, index + 1));
    const attempts = new Map(plans.map((item) => [item.id, attemptFor(item)]));
    const { writer, state } = fixture({ plans, attempts });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const results = state.finalized[0]!.result.providerResults as TradeResearchProviderResult[];
    expect(results.map((item) => item.providerId)).toEqual(plans.map((item) => item.provider_id));
    expect(new Set(results.map((item) => item.providerId)).size).toBe(count);
  });

  it("restores unsupported and blocked plans beside evaluated checkpoints", async () => {
    const evaluated = plan("fda-fsvp", 1);
    const unsupported = plan("canada-cid", 2, {
      eligibility: "ineligible", decision_reason: "wrong_country", cost_class: "unsupported",
    });
    const blocked = plan("manual-provider", 3, {
      eligibility: "ineligible", decision_reason: "manual_only", cost_class: "unsupported",
    });
    const { writer, state } = fixture({ plans: [evaluated, unsupported, blocked], attempts: new Map([[evaluated.id, attemptFor(evaluated)]]) });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect((state.finalized[0]!.result.providerResults as TradeResearchProviderResult[]).map((item) => item.execution.status))
      .toEqual(["completed", "unsupported", "blocked"]);
  });

  it("valid checkpoint reuse is independent of snapshot expiry and is idempotent", async () => {
    const p = plan("fda-fsvp", 1);
    const attempts = new Map([[p.id, attemptFor(p, "cached")]]);
    const shared = fixture({ plans: [p], attempts, fresh: { "fda-fsvp": undefined } });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await processTradeResearchJob(shared.writer, job(), "worker-a", () => NOW, fetchImpl);
    await processTradeResearchJob(shared.writer, job(), "worker-a", () => NOW, fetchImpl);
    expect(shared.state.starts).toEqual([]);
    expect(shared.state.finishes).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(shared.state.finalized).toHaveLength(2);
  });

  it("handles a historical terminal attempt with NULL checkpoint by conservatively re-matching fresh data", async () => {
    const p = plan("fda-fsvp", 1);
    const attempts = new Map([[p.id, {
      id: "legacy", provider_plan_id: p.id, attempt_number: 1, state: "completed", provider_result: null,
    }]]);
    const { writer, rawWriter, state } = fixture({ plans: [p], attempts, fresh: { "fda-fsvp": snapshot("fda-fsvp") } });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(state.starts).toEqual([]);
    expect(state.finishes).toEqual([]);
    expect(rawWriter.getCandidate).toHaveBeenCalledTimes(1);
    expect(state.events).toContain("match_resolved");
  });

  it("keeps T09 aggregation identical when outcomes come from checkpoints", async () => {
    const a = plan("fda-fsvp", 1);
    const b = plan("fda-vqip", 2);
    const expectedResults = [providerResult("fda-fsvp"), providerResult("fda-vqip", "no_match")];
    const attempts = new Map<string, Record<string, unknown>>([
      [a.id, { ...attemptFor(a), provider_result: expectedResults[0] }],
      [b.id, { ...attemptFor(b, "no_match"), provider_result: expectedResults[1] }],
    ]);
    const { writer, state } = fixture({ plans: [a, b], attempts });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(state.finalized[0]!.result.aggregate).toEqual(aggregateTradeResearchEvidence(expectedResults));
  });
});
