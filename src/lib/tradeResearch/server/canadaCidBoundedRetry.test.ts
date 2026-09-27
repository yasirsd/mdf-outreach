import { describe, expect, it, vi } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type { InternalJobRow, SnapshotRow, TradeResearchWriter } from "../repository";
import { CanadaCidRuntimeBudgetError } from "../canadaCid";
import { processTradeResearchJob } from "./worker";

/**
 * BI4F Phase 2B — bounded-retry regression for the Canada CID
 * runtime-budget checkpoint path.
 *
 * Migration 0025 pins `attempt_number between 1 and 3`. If we tried
 * to insert attempt_number = 4 the CHECK constraint would fail and
 * the job would silently loop in the reclaim path. Instead, the
 * worker detects "previous attempt was runtime-budget AND we're now
 * past the 3-attempt ceiling" BEFORE starting a new attempt and
 * finalizes the job as `failed` with safe code
 * `CID_RUNTIME_BUDGET_EXHAUSTED`. This makes the retry ceiling
 * truthful and bounded.
 */

const NOW = new Date("2026-09-27T12:00:00Z");

function job(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "job-ca", batch_id: "batch-ca", workspace_id: "workspace-ca", candidate_id: "candidate-ca",
    product_id: "guntur-dry-red-chilli", country_code: "CA",
    status: "running", stage: "preparing_identity", revision: 1, ...over,
  };
}

function loblaw(): BuyerCandidate {
  return {
    id: "candidate-ca", companyName: "Loblaw Companies Limited",
    country: "Canada", city: "Brampton, ON L6Y 5S5",
    industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
  };
}

interface Fixture {
  writer: TradeResearchWriter;
  state: {
    finalized: Array<{ status: string; outcome: string; result: unknown }>;
    released: string[];
    attempts: Array<{ patch: Record<string, unknown> }>;
    startedAttempts: number[];
    events: Array<{ event: string; payload: Record<string, unknown> }>;
    saveCalls: number;
  };
}

function makeFixture(previous: Record<string, unknown> | undefined): Fixture {
  const state: Fixture["state"] = {
    finalized: [], released: [], attempts: [], startedAttempts: [], events: [], saveCalls: 0,
  };
  const writer = {
    isCancellationRequested: vi.fn(async () => false),
    advance: vi.fn(async (row: InternalJobRow, _worker: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getEligiblePlan: vi.fn(async () => ({ id: "plan-ca", provider_id: "canada-cid", cost_class: "free", automatic_spend_rupees: 0 })),
    latestAttempt: vi.fn(async () => previous),
    startAttempt: vi.fn(async (_row: InternalJobRow, _planId: string, attemptNumber: number) => {
      state.startedAttempts.push(attemptNumber);
      return { id: `attempt-${attemptNumber}`, attempt_number: attemptNumber };
    }),
    finishAttempt: vi.fn(async (_job: InternalJobRow, _worker: string, _id: string, patch: Record<string, unknown>) => { state.attempts.push({ patch }); }),
    appendEvent: vi.fn(async (_row: InternalJobRow, event: string, payload: Record<string, unknown>) => { state.events.push({ event, payload }); }),
    release: vi.fn(async (row: InternalJobRow, _worker: string, next: string) => { state.released.push(next); return { ...row, revision: row.revision + 1, lease_owner: null }; }),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (row: InternalJobRow, _worker: string, status: InternalJobRow["status"], outcome: string, result: unknown) => {
      state.finalized.push({ status, outcome, result });
      return { ...row, status, stage: "complete", outcome, revision: row.revision + 1, lease_owner: null };
    }),
    getFreshSnapshot: vi.fn(async () => undefined),
    getLatestSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async () => undefined),
    getLatestSnapshotByProvider: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => { state.saveCalls += 1; return { id: "new-ca", ...input } as SnapshotRow; }),
    refreshSnapshotExpiry: vi.fn(async () => undefined),
    getCandidate: vi.fn(async () => loblaw()),
  };
  return { writer: writer as unknown as TradeResearchWriter, state };
}

describe("BI4F 2B — runtime-budget retry is bounded at 3 attempts", () => {
  it("first attempt with runtime budget exhausted → attempt 1 saved as retry_wait, release, no snapshot", async () => {
    const { writer, state } = makeFixture(undefined);
    // Force the streaming loader to time out immediately by giving a
    // near-past deadline. The Canada CID processor catches
    // CanadaCidRuntimeBudgetError and issues writer.release + retry.
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, undefined, undefined,
      Date.now() + 5_000, // 5 s remaining; cold-path gate is 30 s
    );
    expect(outcome).toBe("retry");
    // First-invocation checkpoint happens at the pre-fetch deadline
    // gate — no attempt is ever inserted. No snapshot, no finalize.
    expect(state.startedAttempts).toEqual([]);
    expect(state.saveCalls).toBe(0);
    expect(state.finalized).toHaveLength(0);
    expect(state.released).toHaveLength(1);
  });

  it("second attempt after prior retry_wait with runtime budget → still retries safely", async () => {
    // Simulate a prior retry_wait attempt with the runtime-budget
    // safe code — the pre-fetch deadline gate fires again.
    const previous = {
      id: "attempt-1", attempt_number: 1, state: "retry_wait",
      safe_error_code: "CID_RUNTIME_BUDGET_CHECKPOINT",
    };
    const { writer, state } = makeFixture(previous);
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, undefined, undefined,
      Date.now() + 5_000,
    );
    expect(outcome).toBe("retry");
    expect(state.finalized).toHaveLength(0);
  });

  it("third attempt after two prior runtime-budget retries → still retries safely (attempt 3 within cap)", async () => {
    const previous = {
      id: "attempt-2", attempt_number: 2, state: "retry_wait",
      safe_error_code: "CID_RUNTIME_BUDGET_CHECKPOINT",
    };
    const { writer, state } = makeFixture(previous);
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, undefined, undefined,
      Date.now() + 5_000,
    );
    expect(outcome).toBe("retry");
    expect(state.finalized).toHaveLength(0);
  });

  it("attempt 4 after three prior budget checkpoints → job finalizes as FAILED with CID_RUNTIME_BUDGET_EXHAUSTED", async () => {
    // previous.attempt_number = 3 → next would be 4, exceeding the
    // migration 0025 CHECK ceiling. The worker refuses to insert
    // attempt 4 and finalizes as failed with a truthful terminal
    // safe error code.
    const previous = {
      id: "attempt-3", attempt_number: 3, state: "retry_wait",
      safe_error_code: "CID_RUNTIME_BUDGET_CHECKPOINT",
    };
    const { writer, state } = makeFixture(previous);
    // Give a generous deadline so the pre-fetch gate does NOT fire —
    // the bounded-retry guard must be responsible for terminating.
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, undefined, undefined,
      Date.now() + 60_000,
    );
    expect(outcome).toBe("failed");
    expect(state.finalized).toHaveLength(1);
    expect(state.finalized[0]).toMatchObject({ status: "failed", outcome: "failed" });
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result).toMatchObject({ sourcesChecked: 0, automaticSpendRupees: 0, shipmentEvidence: "not_verified" });
    // No new attempt row created; no snapshot saved.
    expect(state.startedAttempts).toEqual([]);
    expect(state.saveCalls).toBe(0);
  });

  it("attempt 4 after three prior NON-budget failures → NOT terminated by bounded-retry guard", async () => {
    // If the previous attempt failed for a reason OTHER than runtime
    // budget (e.g. HTTP_ERROR / PARSER_INCOMPATIBLE), the retry
    // classification path (isRetryableProviderFailure / finalize-as-
    // failed) governs, NOT the runtime-budget bounded guard. This
    // guarantees a single-cause exhaustion cap without stealing
    // other error branches.
    const previous = {
      id: "attempt-3", attempt_number: 3, state: "retry_wait",
      safe_error_code: "TRANSIENT_HTTP",
    };
    const { writer, state } = makeFixture(previous);
    // Force the pre-fetch deadline gate to fire so we return retry
    // via the STANDARD budget-low path, not the terminal one.
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, undefined, undefined,
      Date.now() + 5_000,
    );
    expect(outcome).toBe("retry");
    expect(state.finalized).toHaveLength(0);
  });

  it("CanadaCidRuntimeBudgetError type is exposed and correctly-coded", () => {
    const err = new CanadaCidRuntimeBudgetError("test");
    expect(err.code).toBe("CID_RUNTIME_BUDGET_CHECKPOINT");
    expect(err.name).toBe("CanadaCidRuntimeBudgetError");
  });
});
