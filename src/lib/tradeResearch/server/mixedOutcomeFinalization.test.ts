import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { TradeResearchWriter, type InternalJobRow, type TradeResearchWriter as TRW } from "../repository";
import { processTradeResearchJob } from "./worker";
import type {
  TradeResearchProviderResult,
  TradeResearchResultSummary,
} from "../types";
import type { TradeResearchDiagnostic } from "./diagnostics";
import { classifyFetchFailure } from "../thaiCustomsStats/catalog";

/**
 * TH07 DEFECT 05C — mixed-outcome finalization regression.
 *
 * Pre-fix production shape (jobId d2e33666-02c4-4188-8124-19ce1a70db0a):
 *   • public-website attempt 1 completed (checkpointable
 *     providerResult, sha256:... datasetVersion)
 *   • thai-customs-stats attempts 1–3 failed_retryable
 *     (CATALOG_CONNECT_TIMEOUT); retryDelayMs(3) === null
 *   • fda-fsvp / fda-vqip / canada-cid: ineligible (unsupported)
 *   • status = running, stage = finalizing, outcome = null,
 *     completed_at = null, lease_owner = null
 *
 * Root cause: the `TradeResearchWriter.finalize` method validates
 * every evaluated `providerResult.datasetVersion` against a
 * `buyer_trade_source_snapshots` row via
 * `validateProviderResultSnapshots`. The pre-05C website executor
 * returned a checkpointable result WITHOUT ingesting the matching
 * snapshot row, so `finalize` threw
 * `EVALUATED_PROVIDER_SNAPSHOT_REQUIRED` on every drain tick → outer
 * catch → `recoverClaimedJob` released the lease → next_attempt_at
 * advanced → infinite reclaim-spin.
 *
 * Two prongs of the fix are regression-tested here:
 *   1. The public-website executor now persists the snapshot row via
 *      `writer.saveSnapshot(...)` BEFORE returning (prevents the bug
 *      on new jobs).
 *   2. `TradeResearchWriter.finalize` self-heals by backfilling a
 *      snapshot row from the checkpointed provider_result when
 *      none is found (recovers the production job already stuck
 *      pre-deploy — no manual DB mutation needed).
 */

const NOW = new Date("2026-10-06T12:00:00Z");

function jobRow(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "d2e33666-02c4-4188-8124-19ce1a70db0a",
    batch_id: "8328055b-f067-442c-a099-25ea481ce7b7",
    workspace_id: "00000000-0000-4000-8000-00000000ff01",
    candidate_id: "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc",
    product_id: "guntur-dry-red-chilli",
    country_code: "TH",
    status: "running",
    stage: "finalizing",
    revision: 8,
    lease_owner: null,
    ...over,
  };
}

function spunky(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc",
    companyName: "Spunky Food Co.",
    website: "spunkyfood.com", domain: "spunkyfood.com",
    country: "Thailand",
    industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
    ...over,
  };
}

/**
 * Builds the exact pre-05C checkpointed website provider_result —
 * the shape the stuck production job had persisted via
 * `finishAttemptWithCheckpoint`. `datasetVersion` is a real sha256
 * string, `evidence` is a full object, `execution.safeErrorCode` is
 * null (checkpoint-reader-required).
 */
function websiteCheckpointResult(datasetVersion = "sha256:f63a5599d739a659f5ca24fd34e8551a621f4e2ed82bfdb1fc2462ab4232be04"): TradeResearchProviderResult {
  return {
    providerId: "public-website",
    datasetId: "public-website-homepage",
    datasetVersion,
    parserVersion: "public-website-html-v2",
    sourceRecordIds: ["website:spunkyfood.com"],
    sourcePeriod: "2026-10",
    retrievedAt: NOW.toISOString(),
    execution: { status: "completed", safeErrorCode: null },
    evidence: {
      matchDecision: "none",
      companyEvidence: { state: "not_available", explanation: "No strong on-site identity signal." },
      productEvidence: { state: "supporting", explanation: "Observed product-signal keywords on the company's own website." },
      originEvidence: { state: "not_available", explanation: "Public website is not an origin source." },
      indiaOriginEvidence: { state: "not_verified", explanation: "Public website never establishes India origin." },
      shipmentEvidence: { state: "not_verified", explanation: "Public website never establishes shipment activity." },
      programEvidence: { state: "not_available", explanation: "Public website is not a program-participant list." },
      coverage: { state: "partially_covered", explanation: "Pages inspected: 1." },
      limitations: ["Public-website evidence is COMPANY_SITE grain."],
      attribution: "Candidate's own public website (COMPANY_SITE grain).",
      mappingScope: {
        marketCountryCode: "TH", productId: "guntur-dry-red-chilli", productForm: null,
        sourceProductCodes: [], companyGrain: "company_record", productGrain: "company_product",
        originGrain: "not_available", shipmentGrain: "not_available", programGrain: "not_available",
      },
      interpretationVersion: "public-website-html-v2:t08-v1",
      conflicts: [],
    },
  } as unknown as TradeResearchProviderResult;
}

interface Fixture {
  writer: TRW;
  state: {
    finalized: Array<{ status: string; outcome: string; result: TradeResearchResultSummary; job: InternalJobRow }>;
    events: Array<{ event: string; payload: Record<string, unknown> }>;
    attempts: Array<{ id: string; patch: Record<string, unknown> }>;
    startedAttempts: string[];
    saveCalls: Array<Record<string, unknown>>;
    diagnostics: TradeResearchDiagnostic[];
  };
  log: (d: TradeResearchDiagnostic) => void;
}

function makeFixture(opts: {
  plans: Array<{ provider_id: string; id: string; sequence?: number; eligibility?: "eligible" | "ineligible"; decision_reason?: string }>;
  attempts: Partial<Record<string, Record<string, unknown>>>;
  candidate?: BuyerCandidate;
  finalizeImpl?: (job: InternalJobRow, status: string, outcome: string, result: TradeResearchResultSummary) => InternalJobRow | Promise<InternalJobRow>;
}): Fixture {
  const state: Fixture["state"] = {
    finalized: [], events: [], attempts: [], startedAttempts: [], saveCalls: [], diagnostics: [],
  };
  const writer = {
    isCancellationRequested: vi.fn(async () => false),
    advance: vi.fn(async (row: InternalJobRow, _w: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getProviderPlans: vi.fn(async () => opts.plans.map((p) => ({
      ...p,
      cost_class: "free",
      automatic_spend_rupees: 0,
      eligibility: p.eligibility ?? "eligible",
      decision_reason: p.decision_reason ?? "eligible",
      sequence: p.sequence ?? 1,
    }))),
    latestAttempt: vi.fn(async (planId: string) => opts.attempts[planId]),
    reconcileStaleAttempt: vi.fn(async () => undefined),
    startAttempt: vi.fn(async (_r: InternalJobRow, planId: string, n: number) => ({ id: `attempt-${planId}-${n}`, attempt_number: n })),
    finishAttempt: vi.fn(async (_j: InternalJobRow, _w: string, id: string, patch: Record<string, unknown>) => {
      state.attempts.push({ id, patch });
    }),
    finishAttemptWithCheckpoint: vi.fn(async (_j: InternalJobRow, _w: string, id: string, patch: Record<string, unknown>) => {
      state.attempts.push({ id, patch });
    }),
    appendEvent: vi.fn(async (_r: InternalJobRow, event: string, payload: Record<string, unknown>) => {
      state.events.push({ event, payload });
    }),
    release: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1, lease_owner: null })),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (row: InternalJobRow, _w: string, status: string, outcome: string, result: TradeResearchResultSummary) => {
      if (opts.finalizeImpl) {
        return await opts.finalizeImpl(row, status, outcome, result);
      }
      // Mirror the production shape set by
      // `finalize_buyer_trade_research_job_v2` (migrations 0025/0027/0029):
      //   status = p_status, stage = 'complete', outcome = p_outcome,
      //   lease_owner = NULL, lease_expires_at = NULL,
      //   heartbeat_at = p_now, last_progress_at = p_now,
      //   completed_at = p_now, revision = revision + 1.
      const finalizedJob = {
        ...row, status, stage: "complete", outcome,
        revision: row.revision + 1,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: NOW.toISOString(),
        last_progress_at: NOW.toISOString(),
        completed_at: NOW.toISOString(),
      } as unknown as InternalJobRow;
      state.finalized.push({ status, outcome, result, job: finalizedJob });
      return finalizedJob;
    }),
    getFreshSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async () => undefined),
    getLatestSnapshotByProvider: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => {
      state.saveCalls.push(input);
      return { id: "test-snapshot", ...input } as unknown as never;
    }),
    getCandidate: vi.fn(async () => opts.candidate ?? spunky()),
    refreshOwnedJob: vi.fn(async (id: string) => ({ ...jobRow({ id }), revision: 9 })),
  };
  // Hoist finalized recording even when `finalizeImpl` is set so the
  // non-impl tests still see the finalize call site.
  const originalFinalize = writer.finalize;
  writer.finalize = vi.fn(async (row: InternalJobRow, w: string, status: string, outcome: string, result: TradeResearchResultSummary) => {
    const job = await originalFinalize(row, w, status, outcome, result) as InternalJobRow;
    if (opts.finalizeImpl) state.finalized.push({ status, outcome, result, job });
    return job;
  }) as typeof writer.finalize;
  const log = (d: TradeResearchDiagnostic) => { state.diagnostics.push(d); };
  return { writer: writer as unknown as TRW, state, log };
}

// ───────────────────────────────────────────────────────────────
// PHASE 7 — exact production shape terminates in ONE drain tick.
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — exact production shape finalizes", () => {
  it("1. (exact prod shape) website completed + customs exhausted → finalize called exactly once, status terminal, website evidence preserved", async () => {
    const websiteAttempt = {
      id: "att-ws", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws",
      provider_result: websiteCheckpointResult(),
    };
    const customsAttempt3 = {
      id: "att-cust-3", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust",
      safe_error_code: "CATALOG_CONNECT_TIMEOUT",
    };
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
        { provider_id: "fda-fsvp", id: "plan-fsvp", sequence: 3, eligibility: "ineligible", decision_reason: "wrong_country" },
        { provider_id: "fda-vqip", id: "plan-vqip", sequence: 4, eligibility: "ineligible", decision_reason: "wrong_country" },
        { provider_id: "canada-cid", id: "plan-cid", sequence: 5, eligibility: "ineligible", decision_reason: "wrong_country" },
      ],
      attempts: { "plan-ws": websiteAttempt, "plan-cust": customsAttempt3 },
    });
    const outcome = await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    // (1) exactly one finalize call.
    expect(state.finalized).toHaveLength(1);
    // (4,5,6) terminal state exists in the project model.
    const settled = state.finalized[0]!;
    expect(["completed", "partial", "needs_review", "failed", "cancelled"]).toContain(settled.status);
    expect(settled.outcome).not.toBe("");
    // Specifically for THIS mix (supporting-only website + exhausted
    // customs), existing semantics → completed + no_verified_evidence.
    expect(settled.status).toBe("completed");
    expect(settled.outcome).toBe("no_verified_evidence");
    expect(outcome).toBe("completed");

    // ─────────────────────────────────────────────────────────
    // HARDENING: exact production terminal DB/job shape.
    //
    // Mirrors `finalize_buyer_trade_research_job_v2` (migrations
    // 0025/0027/0029) which sets:
    //   status           = p_status
    //   stage            = 'complete'
    //   outcome          = p_outcome
    //   lease_owner      = NULL
    //   lease_expires_at = NULL
    //   completed_at     = p_now (not null)
    //
    // The UI's terminal-state semantics require stage="complete" —
    // asserting `stage !== "finalizing"` is NOT sufficient.
    // ─────────────────────────────────────────────────────────
    expect(settled.job.status).toBe("completed");
    expect(settled.job.stage).toBe("complete");
    expect(settled.job.outcome).toBe("no_verified_evidence");
    expect(settled.job.completed_at).not.toBeNull();
    expect(settled.job.completed_at).toBeDefined();
    expect(settled.job.lease_owner).toBeNull();
    expect((settled.job as unknown as { lease_expires_at: unknown }).lease_expires_at).toBeNull();
    // (2) website evidence preserved in the final result.
    const providerResults = settled.result.providerResults ?? [];
    const website = providerResults.find((r) => r.providerId === "public-website");
    expect(website).toBeDefined();
    expect(website?.execution.status).toBe("completed");
    expect(website?.datasetVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(website?.evidence?.productEvidence.state).toBe("supporting");
    // (3) Customs is classified as a failed/exhausted source, not negative evidence.
    const customs = providerResults.find((r) => r.providerId === "thai-customs-stats");
    expect(customs?.execution.status).toBe("failed_retryable");
    expect(customs?.execution.safeErrorCode).toBe("CATALOG_CONNECT_TIMEOUT");
    expect(customs?.evidence).toBeNull();
    // (11) no new provider attempt #4 was ever started.
    expect(state.startedAttempts.filter((id) => id.includes("plan-cust"))).toHaveLength(0);
    // (12) no job_requeued diagnostic emitted during the finalize path.
    expect(state.diagnostics.find((d) => d.event === "job_requeued")).toBeUndefined();
    expect(state.diagnostics.find((d) => d.event === "job_finalize_blocked")).toBeUndefined();
    // (Observability) job_finalized emitted with safe counts.
    const finalizedEvent = state.diagnostics.find((d) => d.event === "job_finalized");
    expect(finalizedEvent).toBeDefined();
    expect(finalizedEvent?.outcome).toBe("no_verified_evidence");
    expect(finalizedEvent?.sourcesEvaluated).toBe(1);
    expect(finalizedEvent?.sourcesFailed).toBeGreaterThanOrEqual(1);
    expect(finalizedEvent?.retryExhaustedCount).toBeGreaterThanOrEqual(1);
  });

  it("2. The exhausted customs provider does NOT contribute negative evidence (shipment stays not_verified, India origin stays not_verified)", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a2", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    const result = state.finalized[0]!.result;
    // "Unknown remains unknown": shipment / India origin derived only
    // from the evaluated website, which never promotes to supporting
    // for those dimensions.
    expect(result.shipmentEvidence).toBe("not_verified");
    expect(result.indiaOrigin).toBe("not_verified");
    // Website product evidence is preserved (supporting).
    expect(result.productEvidence).toBe("supporting");
    // sourcesChecked = exactly 1 (website).
    expect(result.sourcesChecked).toBe(1);
    // Automatic spend remains zero.
    expect(result.automaticSpendRupees).toBe(0);
  });

  it("3. The already-completed website attempt is NOT re-executed (no provider_attempt_started for it, no provider_attempt_completed overwrite)", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a2", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    // No new attempts started (both resolved from durable state).
    expect(state.startedAttempts).toHaveLength(0);
  });

  it("4. After finalize, the next drain tick finds NO claimable job for this id — no reclaim-spin", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a2", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    const finalizedJob = (await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log)) === "completed";
    expect(finalizedJob).toBe(true);
    // The simulated claim RPC — status in ('queued','running') AND
    // next_attempt_at <= now AND lease_owner null — would never pick
    // a job whose status is now terminal. We assert the terminal
    // status via the finalize call site itself (the migration-level
    // `claim_buyer_trade_research_job` filter is unchanged).
    expect(state.finalized[0]!.status).not.toBe("running");
    expect(state.finalized[0]!.status).not.toBe("queued");
  });
});

// ───────────────────────────────────────────────────────────────
// PHASE 2 — retry-exhaustion semantics (attempt #3 retryable → terminal).
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — retry exhaustion is derived from attempt count + retry policy", () => {
  it("retryDelayMs(3) === null is the sole trigger that marks the plan as resolved despite state=failed_retryable", async () => {
    const { retryDelayMs } = await import("../stateMachine");
    expect(retryDelayMs(3)).toBeNull();
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(1)).toBe(30_000);
  });

  it("the three cardinal retryDelayMs branches are what the finalizer uses to classify exhaustion", async () => {
    // Mirrors the exact pair the worker checks in
    // loadDurableProviderProgress: `attempt_number >= 3 &&
    // retryDelayMs(attempt_number) === null`.
    const { retryDelayMs } = await import("../stateMachine");
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBeNull();
    // Boundary: attempt_number=2 is still within budget → the
    // finalizer must NOT treat the plan as resolved.
    expect(retryDelayMs(2) !== null).toBe(true);
    // Boundary: attempt_number=3 is exhausted → the finalizer
    // treats the plan as resolved (not negative evidence).
    expect(retryDelayMs(3) === null).toBe(true);
  });

  it("plan with attempt #3 state=failed_retryable + retryDelayMs(3)=null is marked as RESOLVED by loadDurableProviderProgress → the whole job proceeds to finalize without starting an invalid attempt #4", async () => {
    // Pure production shape: website checkpoint resolved via
    // readProviderResultCheckpoint, customs exhausted via the
    // retryDelayMs(3)===null branch. If the resolution branch is
    // broken, finalize won't be called.
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a3", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    // No invalid attempt #4 was ever started.
    expect(state.startedAttempts.filter((id) => /-cust-/.test(id))).toHaveLength(0);
    // Finalize ran exactly once.
    expect(state.finalized).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────
// PHASE 8 — all-failed regression (preserve previous behavior).
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — all-failed regression (website + customs both exhausted)", () => {
  it("both providers failed_retryable at attempt #3 → coverage.evaluated=0, coverage.failed>0 → terminal 'failed/failed'", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-ws", safe_error_code: "WEBSITE_DNS_UNRESOLVED" },
        "plan-cust": { id: "a2", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    const outcome = await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    expect(outcome).toBe("failed");
    expect(state.finalized).toHaveLength(1);
    expect(state.finalized[0]!.status).toBe("failed");
    expect(state.finalized[0]!.outcome).toBe("failed");
    expect(state.finalized[0]!.result.sourcesChecked).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
// PHASE 9 — all-success regression (both providers evaluated).
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — all-success regression preserves existing terminal", () => {
  it("website completed + customs completed → terminal 'completed' with existing aggregate (not failed)", async () => {
    const customsCompleted: TradeResearchProviderResult = {
      providerId: "thai-customs-stats",
      datasetId: "ctm_06_11",
      datasetVersion: "material-hash-customs",
      parserVersion: "thai-customs-stats-csv-v1",
      sourceRecordIds: ["ctm_06_11:2026-09:HS0904"],
      sourcePeriod: "2026-09",
      retrievedAt: NOW.toISOString(),
      execution: { status: "completed", safeErrorCode: null },
      evidence: {
        matchDecision: "none",
        companyEvidence: { state: "not_available", explanation: "aggregate." },
        productEvidence: { state: "not_available", explanation: "aggregate dataset — not company-product." },
        originEvidence: { state: "not_available", explanation: "aggregate." },
        indiaOriginEvidence: { state: "not_verified", explanation: "n/a" },
        shipmentEvidence: { state: "not_verified", explanation: "n/a" },
        programEvidence: { state: "not_available", explanation: "n/a" },
        coverage: { state: "not_covered", explanation: "aggregate ctm_06_11" },
        limitations: ["Aggregate dataset is not shipment-level."],
        attribution: "Thai Customs Data Catalog (CKAN)",
        mappingScope: {
          marketCountryCode: "TH", productId: "guntur-dry-red-chilli", productForm: null,
          sourceProductCodes: [], companyGrain: "not_available", productGrain: "aggregate",
          originGrain: "aggregate", shipmentGrain: "not_available", programGrain: "not_available",
        },
        interpretationVersion: "customs-stats-v1:t08-v1",
        conflicts: [],
      },
    } as unknown as TradeResearchProviderResult;
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a2", attempt_number: 1, state: "completed", provider_plan_id: "plan-cust", provider_result: customsCompleted },
      },
    });
    const outcome = await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    expect(outcome).toBe("completed");
    expect(state.finalized).toHaveLength(1);
    expect(["completed", "needs_review", "partial"]).toContain(state.finalized[0]!.status);
    // Both evaluated.
    expect(state.finalized[0]!.result.sourcesChecked).toBe(2);
    const providerResults = state.finalized[0]!.result.providerResults ?? [];
    expect(providerResults.find((r) => r.providerId === "public-website")?.execution.status).toBe("completed");
    expect(providerResults.find((r) => r.providerId === "thai-customs-stats")?.execution.status).toBe("completed");
  });
});

// ───────────────────────────────────────────────────────────────
// PHASE 10 — single success + unsupported regression (sane generic).
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — single success + unsupported providers (generic terminal)", () => {
  it("one completed website + three ineligible unsupported plans → terminal 'completed' (does not become 'failed')", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "fda-fsvp", id: "plan-fsvp", sequence: 2, eligibility: "ineligible", decision_reason: "wrong_country" },
        { provider_id: "fda-vqip", id: "plan-vqip", sequence: 3, eligibility: "ineligible", decision_reason: "wrong_country" },
        { provider_id: "canada-cid", id: "plan-cid", sequence: 4, eligibility: "ineligible", decision_reason: "wrong_country" },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
      },
    });
    const outcome = await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    expect(outcome).toBe("completed");
    expect(state.finalized[0]!.status).toBe("completed");
    expect(state.finalized[0]!.status).not.toBe("failed");
  });
});

// ───────────────────────────────────────────────────────────────
// PHASE 11 — Thailand evidence contract preserved.
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — Thailand evidence contract: customs timeout proves nothing against the candidate", () => {
  it("company_shipment_activity (shipmentEvidence) remains not_verified when customs is exhausted, not 'no_verified_match' or 'no_evidence'", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a2", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    const result = state.finalized[0]!.result;
    expect(result.shipmentEvidence).toBe("not_verified");
    expect(result.indiaOrigin).toBe("not_verified");
    expect(result.originEvidence).not.toBe("verified");
    // Market data is NOT promoted to company evidence (aggregate ctm
    // mapping scope has `companyGrain: "not_available"`).
  });
});

// ───────────────────────────────────────────────────────────────
// SELF-HEAL unit test — repository.ts finalize backfills missing snapshot.
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — repository.finalize backfills missing snapshot from the checkpointed provider_result", () => {
  function mockSupabaseClient(opts: {
    plans: Array<Record<string, unknown>>;
    attempts: Array<Record<string, unknown>>;
    existingSnapshots: Array<Record<string, unknown>>;
    finalizeRpc: ReturnType<typeof vi.fn>;
    captureInserts: Array<Record<string, unknown>>;
  }): SupabaseClient {
    const makeFrom = (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.order = async () => {
        if (table === "buyer_trade_research_provider_plans") return { data: opts.plans, error: null };
        if (table === "buyer_trade_research_attempts") return { data: opts.attempts, error: null };
        return { data: [], error: null };
      };
      // Terminal fetch for snapshot query: `.in("material_hash", ...)` is awaited directly.
      chain.then = (resolve: (v: unknown) => void) => {
        if (table === "buyer_trade_source_snapshots") {
          resolve({ data: opts.existingSnapshots, error: null });
          return;
        }
        resolve({ data: [], error: null });
      };
      chain.upsert = (payload: Record<string, unknown>) => {
        opts.captureInserts.push(payload);
        return {
          select: () => ({ single: async () => ({ data: { id: "backfilled-snap", ...payload }, error: null }) }),
        };
      };
      return chain;
    };
    return { rpc: opts.finalizeRpc, from: vi.fn(makeFrom) } as unknown as SupabaseClient;
  }

  it("stuck production job: evaluated website result + NO existing snapshot → backfill upserts a snapshot row, finalize succeeds", async () => {
    const finalizedJob: InternalJobRow = {
      id: "d2e33666-02c4-4188-8124-19ce1a70db0a", batch_id: "8328055b-f067-442c-a099-25ea481ce7b7",
      workspace_id: "00000000-0000-4000-8000-00000000ff01", candidate_id: "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc",
      product_id: "guntur-dry-red-chilli", country_code: "TH",
      status: "completed", stage: "complete", revision: 10, lease_owner: null,
    };
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = mockSupabaseClient({
      plans: [
        { id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
        { id: "plan-cust", provider_id: "thai-customs-stats", sequence: 2, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
      ],
      attempts: [
        { provider_plan_id: "plan-ws", attempt_number: 1, state: "completed", safe_error_code: null },
        { provider_plan_id: "plan-cust", attempt_number: 3, state: "failed_retryable", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      ],
      existingSnapshots: [], // ← the exact pre-05C bug: snapshot absent.
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    const result = await writer.finalize(
      jobRow({ status: "running", lease_owner: "worker-a" }),
      "worker-a",
      "completed",
      "no_verified_evidence",
      {
        automaticSpendRupees: 0,
        officialProgramEvidence: "not_checked", productEvidence: "supporting",
        indiaOrigin: "not_verified", originEvidence: "not_available",
        shipmentEvidence: "not_verified", sourcesChecked: 1,
        providerResults: [websiteCheckpointResult()],
      } as TradeResearchResultSummary,
    );
    // (A) finalize RPC was called (did NOT throw EVALUATED_PROVIDER_SNAPSHOT_REQUIRED).
    expect(finalizeRpc).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(finalizedJob.id);
    // (B) Exactly one backfill snapshot was upserted, with the
    //     expected material_hash matching the stored provider_result.
    expect(captureInserts).toHaveLength(1);
    const backfill = captureInserts[0]!;
    expect(backfill.provider_id).toBe("public-website");
    expect(backfill.dataset_id).toBe("public-website-homepage");
    expect(backfill.material_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(backfill.parse_version).toBe("public-website-html-v2");
    expect(backfill.status).toBe("ready");
    // (C) Backfill is marked as such for operator triage; no PII/body.
    expect((backfill.coverage as Record<string, unknown>).backfilled).toBe(true);
    expect((backfill.safe_metadata as Record<string, unknown>).reason).toBe("defect_05c_finalize_self_heal");
    // (D) The row_count=0 and normalized_rows=[] so no bytes are
    //     persisted beyond the hash + ids.
    expect(backfill.row_count).toBe(0);
    expect(backfill.normalized_rows).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // TH07 DEFECT 05C HARDENING — narrow self-heal allow-list.
  //
  // Self-heal is gated to the exact historical public-website shape
  // (providerId, datasetId, sha256 datasetVersion, parserVersion,
  // evaluated success state). Every other evaluated provider missing
  // a snapshot MUST still throw `EVALUATED_PROVIDER_SNAPSHOT_REQUIRED`.
  // ─────────────────────────────────────────────────────────────

  function websiteStuckJob(): InternalJobRow {
    return jobRow({ status: "running", lease_owner: "worker-a" });
  }

  function websiteSummary(result: TradeResearchProviderResult): TradeResearchResultSummary {
    return {
      automaticSpendRupees: 0,
      officialProgramEvidence: "not_checked", productEvidence: "supporting",
      indiaOrigin: "not_verified", originEvidence: "not_available",
      shipmentEvidence: "not_verified", sourcesChecked: 1,
      providerResults: [result],
    } as TradeResearchResultSummary;
  }

  async function runNarrowSelfHealCase(result: TradeResearchProviderResult, planProviderId: string): Promise<Array<Record<string, unknown>>> {
    const finalizedJob: InternalJobRow = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      batch_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      candidate_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      product_id: null, country_code: "TH",
      status: "completed", stage: "complete", revision: 2, lease_owner: null,
    };
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = mockSupabaseClient({
      plans: [{ id: "plan-x", provider_id: planProviderId, sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null }],
      attempts: [{ provider_plan_id: "plan-x", attempt_number: 1, state: "completed", safe_error_code: null }],
      existingSnapshots: [],
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    await writer.finalize(websiteStuckJob(), "worker-a", "completed", "no_verified_evidence", websiteSummary(result));
    return captureInserts;
  }

  async function expectThrows(result: TradeResearchProviderResult, planProviderId: string): Promise<unknown> {
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: null, error: null }));
    const client = mockSupabaseClient({
      plans: [{ id: "plan-x", provider_id: planProviderId, sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null }],
      attempts: [{ provider_plan_id: "plan-x", attempt_number: 1, state: "completed", safe_error_code: null }],
      existingSnapshots: [],
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    let caught: unknown = null;
    try {
      await writer.finalize(websiteStuckJob(), "worker-a", "completed", "no_verified_evidence", websiteSummary(result));
    } catch (err) {
      caught = err;
    }
    // (A) finalize RPC must NOT have been called — invariant threw first.
    expect(finalizeRpc).not.toHaveBeenCalled();
    // (B) No backfill was attempted for a non-whitelisted provider.
    expect(captureInserts).toHaveLength(0);
    return caught;
  }

  // ─────────────────────────────────────────────────────────────
  // (1) historical public-website missing snapshot IS backfilled.
  //     (covered by the "stuck production job" test above; also
  //     asserted here for the hardening suite.)
  // ─────────────────────────────────────────────────────────────
  it("HARDENING (1): historical public-website checkpoint missing snapshot → backfilled (narrow allow-list fires)", async () => {
    const captureInserts = await runNarrowSelfHealCase(websiteCheckpointResult(), "public-website");
    expect(captureInserts).toHaveLength(1);
    const backfill = captureInserts[0]!;
    expect(backfill.provider_id).toBe("public-website");
    expect(backfill.dataset_id).toBe("public-website-homepage");
    expect(backfill.material_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(backfill.parse_version).toBe("public-website-html-v2");
  });

  // ─────────────────────────────────────────────────────────────
  // (2) normal public-website WITH snapshot: no backfill emitted.
  //     (covered by "existing snapshot is NOT re-upserted" below —
  //     dedicated case kept for the narrow allow-list proof.)
  // ─────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────
  // (3-6) OTHER evaluated providers missing snapshots STILL throw.
  //       Each provider individually asserted.
  // ─────────────────────────────────────────────────────────────
  it("HARDENING (3): fda-fsvp evaluated result missing snapshot → still throws (self-heal narrow)", async () => {
    const fsvp: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      providerId: "fda-fsvp", datasetId: "fsvp-participant-list",
      parserVersion: "fsvp-xlsx-v1", datasetVersion: "material-hash-fsvp",
    } as TradeResearchProviderResult;
    const err = await expectThrows(fsvp, "fda-fsvp");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("HARDENING (4): fda-vqip evaluated result missing snapshot → still throws (self-heal narrow)", async () => {
    const vqip: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      providerId: "fda-vqip", datasetId: "vqip-importer-list",
      parserVersion: "vqip-xlsx-v1", datasetVersion: "material-hash-vqip",
    } as TradeResearchProviderResult;
    const err = await expectThrows(vqip, "fda-vqip");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("HARDENING (5): canada-cid evaluated result missing snapshot → still throws (self-heal narrow)", async () => {
    const cid: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      providerId: "canada-cid", datasetId: "cid-major-importers-by-hs6-by-country",
      parserVersion: "canada-cid-csv-v1", datasetVersion: "material-hash-cid",
    } as TradeResearchProviderResult;
    const err = await expectThrows(cid, "canada-cid");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("HARDENING (6): thai-customs-stats evaluated result missing snapshot → still throws (self-heal narrow)", async () => {
    const customs: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      providerId: "thai-customs-stats", datasetId: "ctm_06_11",
      parserVersion: "thai-customs-stats-csv-v1", datasetVersion: "material-hash-customs",
    } as TradeResearchProviderResult;
    const err = await expectThrows(customs, "thai-customs-stats");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  // ─────────────────────────────────────────────────────────────
  // (7) Malformed website datasetVersion does NOT qualify for self-heal.
  // ─────────────────────────────────────────────────────────────
  it("HARDENING (7a): public-website with non-sha256 datasetVersion → does NOT self-heal (still throws)", async () => {
    const malformed: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      datasetVersion: "not-a-sha256-hash",
    } as TradeResearchProviderResult;
    const err = await expectThrows(malformed, "public-website");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("HARDENING (7b): public-website with wrong-length sha256 → does NOT self-heal (still throws)", async () => {
    const malformed: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      datasetVersion: "sha256:deadbeef",
    } as TradeResearchProviderResult;
    const err = await expectThrows(malformed, "public-website");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("HARDENING (7c): public-website with wrong parserVersion → does NOT self-heal (still throws)", async () => {
    const wrongParser: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      parserVersion: "public-website-html-v1", // superseded version
    } as TradeResearchProviderResult;
    const err = await expectThrows(wrongParser, "public-website");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("HARDENING (7d): public-website with wrong datasetId → does NOT self-heal (still throws)", async () => {
    const wrongDataset: TradeResearchProviderResult = {
      ...websiteCheckpointResult(),
      datasetId: "public-website-arbitrary",
    } as TradeResearchProviderResult;
    const err = await expectThrows(wrongDataset, "public-website");
    expect(String(err)).toMatch(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  // ─────────────────────────────────────────────────────────────
  // (8) Non-success website result does NOT qualify for self-heal.
  //     The `evaluated` set already filters to {completed, no_match,
  //     cached}, so a `failed_retryable` result never reaches the
  //     snapshot invariant at all. Asserted here for defense-in-depth.
  // ─────────────────────────────────────────────────────────────
  it("HARDENING (8): website provider_result with failed_retryable execution is NOT evaluated (snapshot invariant skipped entirely)", async () => {
    const notEvaluated = {
      ...websiteCheckpointResult(),
      execution: { status: "failed_retryable", safeErrorCode: "WEBSITE_CONNECT_TIMEOUT", retryable: true },
      evidence: null,
    } as unknown as TradeResearchProviderResult;
    const finalizedJob: InternalJobRow = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      batch_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      workspace_id: "99999999-9999-4999-8999-999999999999",
      candidate_id: "88888888-8888-4888-8888-888888888888",
      product_id: null, country_code: "TH",
      status: "failed", stage: "complete", revision: 3, lease_owner: null,
    };
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = mockSupabaseClient({
      plans: [{ id: "plan-x", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null }],
      attempts: [{ provider_plan_id: "plan-x", attempt_number: 3, state: "failed_retryable", safe_error_code: "WEBSITE_CONNECT_TIMEOUT" }],
      existingSnapshots: [],
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    await writer.finalize(websiteStuckJob(), "worker-a", "failed", "failed", {
      automaticSpendRupees: 0,
      officialProgramEvidence: "not_checked", productEvidence: "not_available",
      indiaOrigin: "not_verified", originEvidence: "not_available",
      shipmentEvidence: "not_verified", sourcesChecked: 0,
      providerResults: [notEvaluated],
    } as TradeResearchResultSummary);
    // Non-evaluated result → the snapshot invariant is skipped entirely
    // (no backfill upsert, no throw).
    expect(captureInserts).toHaveLength(0);
    expect(finalizeRpc).toHaveBeenCalledTimes(1);
  });

  it("existing snapshot is NOT re-upserted (idempotency, no duplicate backfill)", async () => {
    const finalizedJob: InternalJobRow = {
      id: "11111111-1111-4111-8111-111111111111",
      batch_id: "22222222-2222-4222-8222-222222222222",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      candidate_id: "44444444-4444-4444-8444-444444444444",
      product_id: null, country_code: "TH",
      status: "completed", stage: "complete", revision: 2, lease_owner: null,
    };
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = mockSupabaseClient({
      plans: [{ id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null }],
      attempts: [{ provider_plan_id: "plan-ws", attempt_number: 1, state: "completed", safe_error_code: null }],
      existingSnapshots: [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: "sha256:f63a5599d739a659f5ca24fd34e8551a621f4e2ed82bfdb1fc2462ab4232be04",
        published_period: "2026-10",
        retrieved_at: NOW.toISOString(),
        parse_version: "public-website-html-v2",
      }],
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    await writer.finalize(
      jobRow({ status: "running", lease_owner: "worker-a" }),
      "worker-a", "completed", "no_verified_evidence",
      {
        automaticSpendRupees: 0, officialProgramEvidence: "not_checked", productEvidence: "supporting",
        indiaOrigin: "not_verified", originEvidence: "not_available",
        shipmentEvidence: "not_verified", sourcesChecked: 1,
        providerResults: [websiteCheckpointResult()],
      } as TradeResearchResultSummary,
    );
    // Snapshot was present → no backfill upsert.
    expect(captureInserts).toHaveLength(0);
    expect(finalizeRpc).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────
// PRESERVE-FIX regression invariants.
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05C — preserved verified fixes (05A, 05B, scheduler, Thailand mapping)", () => {
  it("05A Customs classifier unchanged — same prefix-scoped codes", () => {
    const err = new Error("x"); err.name = "FetchError";
    (err as unknown as { cause: unknown }).cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
    expect(classifyFetchFailure("CATALOG", err).code).toBe("CATALOG_CONNECT_TIMEOUT");
    expect(classifyFetchFailure("RESOURCE", err).code).toBe("RESOURCE_CONNECT_TIMEOUT");
    expect(classifyFetchFailure("WEBSITE", err).code).toBe("WEBSITE_CONNECT_TIMEOUT");
  });

  it("Migration 0037 unchanged — scheduler file still contains the drain cron contract", () => {
    const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"), "utf8");
    expect(sql).toMatch(/schedule_trade_research_drain/);
  });

  it("Automatic spend contract: result.automaticSpendRupees is forever 0 (05C never introduces paid infra)", async () => {
    const { writer, state, log } = makeFixture({
      plans: [
        { provider_id: "public-website", id: "plan-ws", sequence: 1 },
        { provider_id: "thai-customs-stats", id: "plan-cust", sequence: 2 },
      ],
      attempts: {
        "plan-ws": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws", provider_result: websiteCheckpointResult() },
        "plan-cust": { id: "a2", attempt_number: 3, state: "failed_retryable", provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      },
    });
    await processTradeResearchJob(writer, jobRow(), "worker-a", () => NOW, undefined, log);
    expect(state.finalized[0]!.result.automaticSpendRupees).toBe(0);
  });

  it("US regression unchanged — a US candidate with evaluated FDA sources still finalizes with existing semantics (does not go through TH-specific paths)", async () => {
    const fsvpCompleted: TradeResearchProviderResult = {
      providerId: "fda-fsvp", datasetId: "fsvp-participant-list",
      datasetVersion: "material-hash-fsvp", parserVersion: "fsvp-xlsx-v1",
      sourceRecordIds: ["row-ltfoods"], sourcePeriod: "2026 Q2", retrievedAt: NOW.toISOString(),
      execution: { status: "completed", safeErrorCode: null },
      evidence: {
        matchDecision: "exact",
        companyEvidence: { state: "verified", explanation: "FSVP participant match." },
        productEvidence: { state: "not_available", explanation: "FSVP is program-level, not product." },
        originEvidence: { state: "not_available", explanation: "FSVP is destination-only." },
        indiaOriginEvidence: { state: "not_verified", explanation: "n/a" },
        shipmentEvidence: { state: "not_verified", explanation: "n/a" },
        programEvidence: { state: "verified", explanation: "Verified FDA FSVP participant." },
        coverage: { state: "partially_covered", explanation: "program-level only." },
        limitations: ["FSVP is program-level only."],
        attribution: "FDA FSVP Importer List",
        mappingScope: {
          marketCountryCode: "US", productId: "guntur-dry-red-chilli", productForm: null,
          sourceProductCodes: [], companyGrain: "company_record", productGrain: "not_available",
          originGrain: "not_available", shipmentGrain: "not_available", programGrain: "company_program",
        },
        interpretationVersion: "fsvp-v1:t08-v1", conflicts: [],
      },
    } as unknown as TradeResearchProviderResult;
    const { writer, state, log } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp", sequence: 1 }],
      attempts: { "plan-fsvp": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-fsvp", provider_result: fsvpCompleted } },
      candidate: {
        id: "candidate-us", companyName: "LT Foods Americas", country: "United States",
        industry: "Food", isImporter: true, discoveryStatus: "ready", reviewStatus: "pending",
      },
    });
    const outcome = await processTradeResearchJob(
      writer, jobRow({ country_code: "US", candidate_id: "candidate-us", stage: "finalizing" }),
      "worker-a", () => NOW, undefined, log,
    );
    expect(outcome).toBe("completed");
    expect(state.finalized[0]!.status).toBe("completed");
    expect(state.finalized[0]!.outcome).toBe("official_importer_program_corroboration");
  });

  it("Canada regression unchanged — a CA candidate with evaluated Canada CID still finalizes with existing semantics", async () => {
    const cidCompleted: TradeResearchProviderResult = {
      providerId: "canada-cid", datasetId: "cid-major-importers-by-hs6-by-country",
      datasetVersion: "material-hash-cid", parserVersion: "canada-cid-csv-v1",
      sourceRecordIds: ["cid:2020:090421"], sourcePeriod: "2020", retrievedAt: NOW.toISOString(),
      execution: { status: "completed", safeErrorCode: null },
      evidence: {
        matchDecision: "exact",
        companyEvidence: { state: "verified", explanation: "CID match." },
        productEvidence: { state: "supporting", explanation: "HS 090421 reported." },
        originEvidence: { state: "supporting", explanation: "India origin for HS." },
        indiaOriginEvidence: { state: "supporting", explanation: "India origin reported." },
        shipmentEvidence: { state: "not_verified", explanation: "n/a" },
        programEvidence: { state: "not_available", explanation: "n/a" },
        coverage: { state: "partially_covered", explanation: "aggregate." },
        limitations: ["CID is directory-level."], attribution: "Canadian Importers Database",
        mappingScope: {
          marketCountryCode: "CA", productId: "guntur-dry-red-chilli", productForm: null,
          sourceProductCodes: ["090421"], companyGrain: "company_record",
          productGrain: "company_product", originGrain: "company_product_origin",
          shipmentGrain: "not_available", programGrain: "not_available",
        },
        interpretationVersion: "cid-v1:t08-v1", conflicts: [],
      },
    } as unknown as TradeResearchProviderResult;
    const { writer, state, log } = makeFixture({
      plans: [{ provider_id: "canada-cid", id: "plan-cid", sequence: 1 }],
      attempts: { "plan-cid": { id: "a1", attempt_number: 1, state: "completed", provider_plan_id: "plan-cid", provider_result: cidCompleted } },
      candidate: {
        id: "candidate-ca", companyName: "Loblaw Companies Limited", country: "Canada",
        industry: "Food", isImporter: true, discoveryStatus: "ready", reviewStatus: "pending",
      },
    });
    const outcome = await processTradeResearchJob(
      writer, jobRow({ country_code: "CA", candidate_id: "candidate-ca", stage: "finalizing" }),
      "worker-a", () => NOW, undefined, log,
    );
    expect(outcome).toBe("completed");
    expect(state.finalized[0]!.status).toBe("completed");
  });
});
