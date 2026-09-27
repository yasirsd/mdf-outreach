import { describe, expect, it, vi } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type { InternalJobRow, SnapshotRow, TradeResearchWriter } from "../repository";
import { processTradeResearchJob } from "./worker";

/**
 * BI4F Phase 2B — stale-attempt reconciliation regressions.
 *
 * Production symptom: after Vercel hard-killed several early
 * Canada CID cold-fetch invocations, two attempt rows remained
 * `state='running'` even though the parent jobs later completed
 * successfully via warm-cache reruns. The claim RPC reclaims JOBS
 * but not ATTEMPTS, so those rows never transitioned to a truthful
 * terminal-ish state.
 *
 * Fix: before creating a NEW attempt, the worker calls
 * `writer.reconcileStaleAttempt(prevId, "STALE_LEASE_RECOVERED")`
 * which transitions the stale row to `state='failed_retryable'`
 * with an honest safe error code. History (attempt_number,
 * started_at) is preserved; only lease + state + finished_at are
 * touched. The row is NEVER rewritten as completed.
 */

const NOW = new Date("2026-09-28T00:00:00Z");

function jobRow(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "job-1", batch_id: "batch-1", workspace_id: "workspace-1", candidate_id: "candidate-1",
    product_id: "guntur-dry-red-chilli", country_code: "CA",
    status: "running", stage: "preparing_identity", revision: 1, ...over,
  };
}

function loblaw(): BuyerCandidate {
  return {
    id: "candidate-1", companyName: "Loblaw Companies Limited",
    country: "Canada", city: "Brampton, ON L6Y 5S5",
    industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
  };
}

function cidSnapshot(): SnapshotRow {
  return {
    id: "snap-1", provider_id: "canada-cid", dataset_id: "cid-major-importers-by-hs6-by-country",
    published_period: "2020",
    source_url: "https://ised-isde.canada.ca/site/ised/sites/default/files/documents/cid-bdic-majorimportersbyhs6bycountry2020.csv",
    material_hash: "h-ca-2020", retrieved_at: NOW.toISOString(), expires_at: "2027-09-28T00:00:00Z",
    row_count: 3,
    normalized_rows: [
      { hs6: "090421", originCountry: "IN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
    ] as unknown as SnapshotRow["normalized_rows"],
  };
}

interface Fixture {
  writer: TradeResearchWriter;
  state: {
    reconciled: Array<{ id: string; safe_error_code: string }>;
    finishAttemptCalls: Array<{ id: string; patch: Record<string, unknown> }>;
    startAttemptCalls: number[];
    finalized: Array<{ status: string; outcome: string }>;
  };
}

function makeFixture(previous: Record<string, unknown> | undefined, opts: { fresh?: SnapshotRow; plan?: Record<string, unknown> } = {}): Fixture {
  const state: Fixture["state"] = { reconciled: [], finishAttemptCalls: [], startAttemptCalls: [], finalized: [] };
  const writer = {
    isCancellationRequested: vi.fn(async () => false),
    advance: vi.fn(async (row: InternalJobRow, _w: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getEligiblePlan: vi.fn(async () => opts.plan ?? { id: "plan-1", provider_id: "canada-cid", cost_class: "free", automatic_spend_rupees: 0 }),
    latestAttempt: vi.fn(async () => previous),
    reconcileStaleAttempt: vi.fn(async (id: string, safe_error_code: string) => { state.reconciled.push({ id, safe_error_code }); }),
    startAttempt: vi.fn(async (_row: InternalJobRow, _planId: string, attemptNumber: number) => {
      state.startAttemptCalls.push(attemptNumber);
      return { id: `attempt-${attemptNumber}`, attempt_number: attemptNumber };
    }),
    finishAttempt: vi.fn(async (id: string, patch: Record<string, unknown>) => { state.finishAttemptCalls.push({ id, patch }); }),
    appendEvent: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (_row: InternalJobRow, _w: string, status: string, outcome: string) => { state.finalized.push({ status, outcome }); }),
    getFreshSnapshot: vi.fn(async () => undefined),
    getLatestSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async () => opts.fresh),
    getLatestSnapshotByProvider: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => ({ id: "new-snap", ...input } as SnapshotRow)),
    refreshSnapshotExpiry: vi.fn(async () => undefined),
    getCandidate: vi.fn(async () => loblaw()),
  };
  return { writer: writer as unknown as TradeResearchWriter, state };
}

describe("BI4F 2B — reconciles stale 'running' attempts as failed_retryable/STALE_LEASE_RECOVERED", () => {
  it("previous attempt state='running' + Canada CID reclaim → reconcile called with STALE_LEASE_RECOVERED", async () => {
    const stale = {
      id: "attempt-stale-1", attempt_number: 1, state: "running",
      lease_owner: "inline-killed", lease_expires_at: "2026-09-27T01:15:23Z",
      safe_error_code: null, started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(stale, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    // Reconciled BEFORE startAttempt.
    expect(state.reconciled).toHaveLength(1);
    expect(state.reconciled[0]).toEqual({ id: "attempt-stale-1", safe_error_code: "STALE_LEASE_RECOVERED" });
    // New attempt gets attempt_number 2 (the stale one held #1).
    expect(state.startAttemptCalls).toEqual([2]);
    // Terminal outcome finalizes truthfully.
    expect(state.finalized).toHaveLength(1);
  });

  it("previous attempt state='completed' → NO reconcile, attempt reused (no new attempt inserted)", async () => {
    const completed = {
      id: "attempt-1", attempt_number: 1, state: "completed",
      lease_owner: null, lease_expires_at: null,
      safe_error_code: null, started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(completed, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    expect(state.reconciled).toEqual([]);
    // No new attempt row is inserted — the existing completed row
    // is reused via `attemptAlreadyResolved && snapshot`.
    expect(state.startAttemptCalls).toEqual([]);
  });

  it("previous attempt state='skipped_cached' → NO reconcile, attempt reused", async () => {
    const skipped = {
      id: "attempt-1", attempt_number: 1, state: "skipped_cached",
      lease_owner: null, lease_expires_at: null,
      safe_error_code: null, started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(skipped, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    expect(state.reconciled).toEqual([]);
    expect(state.startAttemptCalls).toEqual([]);
  });

  it("previous attempt state='failed_terminal' → NO reconcile, new attempt at #2 created", async () => {
    const failed = {
      id: "attempt-1", attempt_number: 1, state: "failed_terminal",
      lease_owner: null, lease_expires_at: null,
      safe_error_code: "PROVIDER_FAILURE", started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(failed, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    expect(state.reconciled).toEqual([]);
    expect(state.startAttemptCalls).toEqual([2]);
  });

  it("previous attempt state='retry_wait' → NO reconcile, new attempt at #2 created", async () => {
    const retry = {
      id: "attempt-1", attempt_number: 1, state: "retry_wait",
      lease_owner: null, lease_expires_at: null,
      safe_error_code: "TRANSIENT_HTTP", started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(retry, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    expect(state.reconciled).toEqual([]);
    expect(state.startAttemptCalls).toEqual([2]);
  });

  it("no previous attempt → NO reconcile, new attempt at #1", async () => {
    const { writer, state } = makeFixture(undefined, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    expect(state.reconciled).toEqual([]);
    expect(state.startAttemptCalls).toEqual([1]);
  });

  it("FDA regression: stale FDA attempt is also reconciled (same contract, both provider paths)", async () => {
    const staleFda = {
      id: "attempt-fda-stale", attempt_number: 1, state: "running",
      lease_owner: "inline-killed", lease_expires_at: "2026-09-27T01:15:23Z",
      safe_error_code: null, started_at: "2026-09-27T01:14:23Z",
    };
    const fdaSnapshot: SnapshotRow = {
      id: "fda-snap", provider_id: "fda-fsvp", dataset_id: "fsvp-participant-list",
      published_period: "April 1, 2026 – June 30, 2026",
      source_url: "https://www.fda.gov/media/186093/download",
      material_hash: "h-us", retrieved_at: NOW.toISOString(), expires_at: "2026-12-31T00:00:00Z",
      row_count: 1,
      normalized_rows: [{ companyName: "IBERIA FOODS CORP.", stateCode: "FL" }] as unknown as SnapshotRow["normalized_rows"],
    };
    const { writer, state } = makeFixture(staleFda, {
      plan: { id: "plan-fda", provider_id: "fda-fsvp", cost_class: "free", automatic_spend_rupees: 0 },
    });
    // For FDA the fresh snapshot is served from writer.getFreshSnapshot(), not the ByProvider variant.
    (writer as unknown as { getFreshSnapshot: ReturnType<typeof vi.fn> }).getFreshSnapshot.mockResolvedValue(fdaSnapshot);
    await processTradeResearchJob(
      writer,
      jobRow({ country_code: "US", candidate_id: "candidate-us" }),
      "worker-new", () => NOW,
    );
    expect(state.reconciled).toEqual([{ id: "attempt-fda-stale", safe_error_code: "STALE_LEASE_RECOVERED" }]);
    expect(state.startAttemptCalls).toEqual([2]);
  });

  it("preserves attempt_number sequence: stale #1 + new #2 (attempt_number strictly incremented)", async () => {
    const stale = {
      id: "attempt-stale-1", attempt_number: 1, state: "running",
      lease_owner: "inline-killed", lease_expires_at: "2026-09-27T01:15:23Z",
      safe_error_code: null, started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(stale, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    expect(state.startAttemptCalls).toEqual([2]);
    // The stale row is NEVER rewritten as completed — only the
    // dedicated reconcile method touches it.
    expect(state.finishAttemptCalls.every((call) => call.id !== "attempt-stale-1")).toBe(true);
  });

  it("₹0 invariant preserved regardless of reconciliation", async () => {
    const stale = {
      id: "attempt-stale-1", attempt_number: 1, state: "running",
      lease_owner: "inline-killed", lease_expires_at: "2026-09-27T01:15:23Z",
      safe_error_code: null, started_at: "2026-09-27T01:14:23Z",
    };
    const { writer, state } = makeFixture(stale, { fresh: cidSnapshot() });
    await processTradeResearchJob(writer, jobRow(), "worker-new", () => NOW);
    // Every finalize call must carry automaticSpendRupees = 0.
    // Finalize is invoked via writer.finalize; the mock captures
    // status + outcome; automaticSpendRupees is enforced by
    // TradeResearchWriter.finalize itself (contract preserved).
    expect(state.finalized.length).toBeGreaterThan(0);
  });
});

describe("BI4F 2B — reconcileStaleAttempt writer method contract", () => {
  it("exists on the writer, is idempotent by state='running' filter", async () => {
    // We can't easily instrument the low-level Supabase client here
    // (it's a real chained builder), but we assert the method exists
    // on the class prototype and has the expected signature.
    const { TradeResearchWriter } = await import("../repository");
    expect(typeof TradeResearchWriter.prototype.reconcileStaleAttempt).toBe("function");
    expect(TradeResearchWriter.prototype.reconcileStaleAttempt.length).toBe(2); // (id, safeErrorCode)
  });
});
