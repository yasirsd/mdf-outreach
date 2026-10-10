import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { TradeResearchWriter, type InternalJobRow } from "../repository";
import type {
  TradeResearchProviderResult,
  TradeResearchResultSummary,
} from "../types";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  ProviderOutcomeProjectionError,
  validateProviderResultSnapshots,
} from "../providerOutcomes";
import { safeTradeResearchErrorCode } from "./diagnostics";
import { processTradeResearchJob } from "./worker";
import type { TradeResearchDiagnostic } from "./diagnostics";

/**
 * TH07 DEFECT 05D — repository-level finalization regression.
 *
 * Pre-05D PRODUCTION STATE (post-05C deploy):
 *   • public-website snapshot EXISTS in buyer_trade_source_snapshots
 *     (05C self-heal filled it: material_hash = sha256:f63a5599…,
 *     parse_version = public-website-html-v2, published_period =
 *     "2026-10", coverage.backfilled = true, coverage.reason =
 *     defect_05c_finalize_self_heal).
 *   • Job jobId = d2e33666-02c4-4188-8124-19ce1a70db0a still cannot
 *     finalize: safeErrorCode = WORKER_INTERNAL_ERROR; job_finalize_blocked
 *     + job_requeued on every drain; HTTP drain = 500.
 *
 * ROOT CAUSE:
 *   `validateProviderResultSnapshots` was comparing
 *   `snapshot.retrieved_at` to `provider_result.retrievedAt` by
 *   STRICT STRING EQUALITY. `buyer_trade_source_snapshots.retrieved_at`
 *   is a Postgres `timestamptz`. PostgREST serialises it as
 *   `YYYY-MM-DDTHH:mm:ss(.sss)+00:00`, which is NOT byte-identical to
 *   `new Date().toISOString()` (`.sssZ` form). The pre-05D website
 *   executor also wrote `provider_result.retrievedAt = now.toISOString()`
 *   independently of the saved snapshot's returned row, so the two
 *   strings never matched. `PROVIDER_SNAPSHOT_METADATA_CONFLICT`
 *   threw as a `ProviderOutcomeProjectionError` (regular Error), the
 *   diagnostic classifier fell through to the opaque
 *   `WORKER_INTERNAL_ERROR` label, and the lease-recovery requeue
 *   loop started.
 *
 * Three prongs are regression-tested here:
 *   1. `validateProviderResultSnapshots` now treats `retrieved_at` as
 *      a semantic timestamp (parsed millis equal) — the exact
 *      production shape passes.
 *   2. `safeTradeResearchErrorCode` maps every
 *      `ProviderOutcomeProjectionError` subcode to a bounded safe
 *      `FINALIZE_*` code (no more silent WORKER_INTERNAL_ERROR on
 *      snapshot invariants).
 *   3. The repository-level finalize path end-to-end: existing
 *      snapshot (returned with timestamptz-normalised retrieved_at)
 *      → no self-heal → semantic validator passes → finalize RPC
 *      invoked with the exact mixed-shape result → terminal row
 *      shape (status/stage/outcome/completed_at/lease_owner).
 *
 * This file is INTENTIONALLY repository-level: `writer.finalize` is
 * driven directly against a Supabase-shaped client that returns the
 * `retrieved_at` in the DB-normalised form the live Postgres emits.
 * The pre-05C `mixedOutcomeFinalization.test.ts` suite mocked
 * `writer.finalize` as a drop-through, which hid this entire class
 * of failure. We do not use that path here.
 */

const NOW_ISO_Z = "2026-10-06T12:00:00.000Z";
// PostgREST serialises `timestamptz` as `+00:00` (not `Z`) and uses
// `.sss` precision regardless of input. Both forms encode the SAME
// instant — the whole point of the 05D fix.
const NOW_PG_TIMESTAMPTZ = "2026-10-06T12:00:00.000+00:00";
const WEBSITE_DATASET_VERSION = "sha256:f63a5599d739a659f5ca24fd34e8551a621f4e2ed82bfdb1fc2462ab4232be04";

const PROD_JOB_ID = "d2e33666-02c4-4188-8124-19ce1a70db0a";
const PROD_BATCH_ID = "8328055b-f067-442c-a099-25ea481ce7b7";
const PROD_WORKSPACE_ID = "00000000-0000-4000-8000-00000000ff01";
const PROD_CANDIDATE_ID = "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc";

function prodJob(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: PROD_JOB_ID,
    batch_id: PROD_BATCH_ID,
    workspace_id: PROD_WORKSPACE_ID,
    candidate_id: PROD_CANDIDATE_ID,
    product_id: "guntur-dry-red-chilli",
    country_code: "TH",
    status: "running",
    stage: "finalizing",
    revision: 42,
    lease_owner: "worker-a",
    ...over,
  };
}

/**
 * Build the EXACT production-shape website provider_result as it was
 * written to `provider_result` by the pre-05D executor: `retrievedAt`
 * is `now.toISOString()` (the `.sssZ` form) because that executor
 * did not read back the snapshot's DB-normalised value.
 */
function websiteCheckpoint(overrides: Partial<TradeResearchProviderResult> = {}): TradeResearchProviderResult {
  return {
    providerId: "public-website",
    datasetId: "public-website-homepage",
    datasetVersion: WEBSITE_DATASET_VERSION,
    parserVersion: "public-website-html-v2",
    sourceRecordIds: ["website:spunkyfood.com"],
    sourcePeriod: "2026-10",
    retrievedAt: NOW_ISO_Z, // pre-05D form
    execution: { status: "completed", safeErrorCode: null },
    evidence: {
      matchDecision: "none",
      companyEvidence: { state: "not_available", explanation: "No strong on-site identity signal." },
      productEvidence: { state: "supporting", explanation: "Product-signal keywords on the company's website." },
      originEvidence: { state: "not_available", explanation: "Public website is not an origin source." },
      indiaOriginEvidence: { state: "not_verified", explanation: "Public website never establishes India origin." },
      shipmentEvidence: { state: "not_verified", explanation: "Public website never establishes shipment activity." },
      programEvidence: { state: "not_available", explanation: "Public website is not a program list." },
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
    ...overrides,
  } as unknown as TradeResearchProviderResult;
}

/**
 * Supabase client that mirrors the production shape:
 *   • snapshot row EXISTS with retrieved_at in `+00:00` form.
 *   • plans + attempts return the pre-05D job's durable state.
 *   • finalize RPC is a captured spy.
 */
function pgNormalisedClient(opts: {
  existingSnapshots: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
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
        select: () => ({ single: async () => ({ data: { id: "backfilled", ...payload, retrieved_at: NOW_PG_TIMESTAMPTZ }, error: null }) }),
      };
    };
    return chain;
  };
  return { rpc: opts.finalizeRpc, from: vi.fn(makeFrom) } as unknown as SupabaseClient;
}

function websiteSummary(): TradeResearchResultSummary {
  return {
    automaticSpendRupees: 0,
    officialProgramEvidence: "not_checked", productEvidence: "supporting",
    indiaOrigin: "not_verified", originEvidence: "not_available",
    shipmentEvidence: "not_verified", sourcesChecked: 1,
    providerResults: [websiteCheckpoint()],
  } as TradeResearchResultSummary;
}

// ───────────────────────────────────────────────────────────────
// (1,2) snapshot validator — semantic retrieved_at equality.
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05D — snapshot validator uses semantic timestamptz equality", () => {
  it("snapshot.retrieved_at = `+00:00` form, result.retrievedAt = `.Z` form → SAME INSTANT → validator passes", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: NOW_ISO_Z })],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: NOW_PG_TIMESTAMPTZ,
        parse_version: "public-website-html-v2",
      }],
    )).not.toThrow();
  });

  it("same-instant with 6-digit microsecond fraction (`.sssuuu+00:00`) → validator passes", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: NOW_ISO_Z })],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: "2026-10-06T12:00:00.000000+00:00",
        parse_version: "public-website-html-v2",
      }],
    )).not.toThrow();
  });

  it("DIFFERENT instant → still throws PROVIDER_SNAPSHOT_METADATA_CONFLICT (invariant preserved)", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: "2026-10-06T12:00:00.000Z" })],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: "2027-01-01T00:00:00.000+00:00", // off by months
        parse_version: "public-website-html-v2",
      }],
    )).toThrow(/PROVIDER_SNAPSHOT_METADATA_CONFLICT/);
  });

  it("mismatched parse_version STILL throws (text fields keep strict equality)", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: NOW_ISO_Z })],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: NOW_PG_TIMESTAMPTZ,
        parse_version: "public-website-html-v1", // wrong
      }],
    )).toThrow(/PROVIDER_SNAPSHOT_METADATA_CONFLICT/);
  });

  it("mismatched published_period STILL throws (text fields keep strict equality)", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: NOW_ISO_Z, sourcePeriod: "2026-10" })],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-09", // wrong
        retrieved_at: NOW_PG_TIMESTAMPTZ,
        parse_version: "public-website-html-v2",
      }],
    )).toThrow(/PROVIDER_SNAPSHOT_METADATA_CONFLICT/);
  });

  it("missing snapshot STILL throws EVALUATED_PROVIDER_SNAPSHOT_REQUIRED (invariant preserved)", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: NOW_ISO_Z })],
      [], // no snapshot
    )).toThrow(/EVALUATED_PROVIDER_SNAPSHOT_REQUIRED/);
  });

  it("non-parseable timestamps fall back to strict compare (never silently equal)", () => {
    expect(() => validateProviderResultSnapshots(
      [websiteCheckpoint({ retrievedAt: "not-a-timestamp" })],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: NOW_PG_TIMESTAMPTZ,
        parse_version: "public-website-html-v2",
      }],
    )).toThrow(/PROVIDER_SNAPSHOT_METADATA_CONFLICT/);
  });
});

// ───────────────────────────────────────────────────────────────
// (safe observability) ProviderOutcomeProjectionError → FINALIZE_*
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05D — safe error classifier covers finalize invariants", () => {
  it("EVALUATED_PROVIDER_SNAPSHOT_REQUIRED → FINALIZE_SNAPSHOT_INVARIANT (no more WORKER_INTERNAL_ERROR)", () => {
    expect(safeTradeResearchErrorCode(
      new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_SNAPSHOT_REQUIRED"),
    )).toBe("FINALIZE_SNAPSHOT_INVARIANT");
  });

  it("PROVIDER_SNAPSHOT_METADATA_CONFLICT → FINALIZE_SNAPSHOT_INVARIANT", () => {
    expect(safeTradeResearchErrorCode(
      new ProviderOutcomeProjectionError("PROVIDER_SNAPSHOT_METADATA_CONFLICT"),
    )).toBe("FINALIZE_SNAPSHOT_INVARIANT");
  });

  it("EVALUATED_PROVIDER_RESULT_REQUIRED → FINALIZE_RESULT_CONTRACT_INVALID", () => {
    expect(safeTradeResearchErrorCode(
      new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_RESULT_REQUIRED"),
    )).toBe("FINALIZE_RESULT_CONTRACT_INVALID");
  });

  it.each([
    "DUPLICATE_PROVIDER_PLAN",
    "UNPLANNED_PROVIDER_RESULT",
    "DUPLICATE_PROVIDER_RESULT",
    "ATTEMPT_FOR_UNPLANNED_PROVIDER",
    "UNKNOWN_PROVIDER_ATTEMPT_STATE",
  ])("%s → FINALIZE_PROJECTION_FAILED", (code) => {
    expect(safeTradeResearchErrorCode(
      new ProviderOutcomeProjectionError(code),
    )).toBe("FINALIZE_PROJECTION_FAILED");
  });

  it("P0001 STALE_JOB_REVISION (raw RPC object) → FINALIZE_CAS_CONFLICT", () => {
    expect(safeTradeResearchErrorCode({
      code: "P0001",
      message: "STALE_JOB_REVISION",
    })).toBe("FINALIZE_CAS_CONFLICT");
  });

  it("P0001 RESULT_CONTEXT_CONFLICT → FINALIZE_RPC_REJECTED", () => {
    expect(safeTradeResearchErrorCode({
      code: "P0001",
      message: "RESULT_CONTEXT_CONFLICT",
    })).toBe("FINALIZE_RPC_REJECTED");
  });

  it("P0001 invalid terminal status → FINALIZE_RESULT_CONTRACT_INVALID", () => {
    expect(safeTradeResearchErrorCode({
      code: "P0001",
      message: "invalid terminal status",
    })).toBe("FINALIZE_RESULT_CONTRACT_INVALID");
  });

  it("mapped codes never leak SQL text, provider bodies, URLs, cookies, tokens or PII", () => {
    for (const code of [
      "EVALUATED_PROVIDER_SNAPSHOT_REQUIRED",
      "PROVIDER_SNAPSHOT_METADATA_CONFLICT",
      "EVALUATED_PROVIDER_RESULT_REQUIRED",
      "DUPLICATE_PROVIDER_PLAN",
      "UNPLANNED_PROVIDER_RESULT",
    ]) {
      const emitted = safeTradeResearchErrorCode(new ProviderOutcomeProjectionError(code));
      expect(emitted).toMatch(/^FINALIZE_[A-Z_]+$/);
      expect(emitted).not.toContain(" ");
      expect(emitted).not.toContain("select");
      expect(emitted).not.toContain("sha256");
      expect(emitted.length).toBeLessThanOrEqual(80);
    }
  });
});

// ───────────────────────────────────────────────────────────────
// (3,4,5,6,7,8,9) end-to-end: existing snapshot (DB-normalised) +
// mixed-outcome checkpoint → finalize RPC called with correct payload.
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05D — repository.finalize finalises the exact production shape against DB-normalised snapshot", () => {
  it("existing snapshot with timestamptz-normalised retrieved_at → NO self-heal → finalize RPC invoked → terminal row shape", async () => {
    const finalizedJob: InternalJobRow = {
      id: PROD_JOB_ID, batch_id: PROD_BATCH_ID, workspace_id: PROD_WORKSPACE_ID, candidate_id: PROD_CANDIDATE_ID,
      product_id: "guntur-dry-red-chilli", country_code: "TH",
      status: "completed", stage: "complete", revision: 43, lease_owner: null,
    };
    (finalizedJob as unknown as { outcome: string }).outcome = "no_verified_evidence";
    (finalizedJob as unknown as { completed_at: string }).completed_at = NOW_PG_TIMESTAMPTZ;
    (finalizedJob as unknown as { lease_expires_at: null }).lease_expires_at = null;
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = pgNormalisedClient({
      // Exact post-05C-self-heal production row:
      existingSnapshots: [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: NOW_PG_TIMESTAMPTZ, // ← the critical bit (DB-normalised)
        parse_version: "public-website-html-v2",
      }],
      plans: [
        { id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
        { id: "plan-cust", provider_id: "thai-customs-stats", sequence: 2, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
      ],
      attempts: [
        { provider_plan_id: "plan-ws", attempt_number: 1, state: "completed", safe_error_code: null },
        { provider_plan_id: "plan-cust", attempt_number: 1, state: "failed_retryable", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
        { provider_plan_id: "plan-cust", attempt_number: 2, state: "failed_retryable", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
        { provider_plan_id: "plan-cust", attempt_number: 3, state: "failed_retryable", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      ],
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    const result = await writer.finalize(
      prodJob(),
      "worker-a",
      "completed",
      "no_verified_evidence",
      websiteSummary(),
    );
    // (3,4) The exact production mixed result reached finalize RPC.
    // (5) The fix makes it terminal completed.
    expect(finalizeRpc).toHaveBeenCalledTimes(1);
    const rpcCall = (finalizeRpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]!;
    expect(rpcCall[0]).toBe("finalize_buyer_trade_research_job_v2");
    const payload = rpcCall[1];
    expect(payload.p_job_id).toBe(PROD_JOB_ID);
    expect(payload.p_worker_id).toBe("worker-a");
    expect(payload.p_revision).toBe(42);
    expect(payload.p_status).toBe("completed");
    expect(payload.p_outcome).toBe("no_verified_evidence");
    // The result summary is authoritative — automaticSpendRupees=0,
    // and the aggregate was recomputed from the projection.
    const summary = payload.p_result_summary as Record<string, unknown>;
    expect(summary.automaticSpendRupees).toBe(0);
    expect(summary).toHaveProperty("aggregate");
    expect(summary).toHaveProperty("providerResults");
    // (6,7,8,9) Terminal shape returned by the RPC.
    expect(result.status).toBe("completed");
    expect(result.stage).toBe("complete");
    expect((result as unknown as { outcome: string }).outcome).toBe("no_verified_evidence");
    expect((result as unknown as { completed_at: unknown }).completed_at).not.toBeNull();
    expect(result.lease_owner).toBeNull();
    expect((result as unknown as { lease_expires_at: unknown }).lease_expires_at).toBeNull();
    // (10) No recoverClaimedJob (finalize succeeded).
    // Asserted implicitly by the lack of release/recover calls on
    // the shared client.
    // Snapshot was present → NO backfill upsert (05C self-heal did
    // not re-fire on this drain).
    expect(captureInserts).toHaveLength(0);
    // (11) No new attempt for customs — this test does not even
    // reach the executor path; `writer.finalize` is pure settlement.
    // (12) Website evidence preserved on the payload.
    const providerResults = summary.providerResults as unknown as Array<{ providerId: string; execution: { status: string }; datasetVersion?: string }>;
    const website = providerResults.find((p) => p.providerId === "public-website");
    expect(website).toBeDefined();
    expect(website?.execution.status).toBe("completed");
    expect(website?.datasetVersion).toBe(WEBSITE_DATASET_VERSION);
    // (13) Customs is `failed_retryable`, not treated as negative evidence.
    const customs = providerResults.find((p) => p.providerId === "thai-customs-stats");
    expect(customs?.execution.status).toBe("failed_retryable");
    expect((customs as unknown as { execution: { safeErrorCode: string } }).execution.safeErrorCode).toBe("CATALOG_CONNECT_TIMEOUT");
    // (14) Automatic spend = 0.
    expect(summary.automaticSpendRupees).toBe(0);
  });

  it("REPRODUCES PRE-FIX BEHAVIOR: if the validator used strict string equality, the exact same shape would throw PROVIDER_SNAPSHOT_METADATA_CONFLICT", () => {
    // Simulate the pre-05D compare directly. This is the proof that
    // the production repro is real and that the fix is scoped to the
    // retrieved_at timestamp compare only.
    const strictCompare = (
      snapRetrievedAt: string,
      resultRetrievedAt: string,
    ): boolean => snapRetrievedAt === resultRetrievedAt;
    expect(strictCompare(NOW_PG_TIMESTAMPTZ, NOW_ISO_Z)).toBe(false);
    // After the fix:
    expect(Date.parse(NOW_PG_TIMESTAMPTZ)).toBe(Date.parse(NOW_ISO_Z));
  });

  it("historical missing snapshot → self-heal fires → backfilled retrieved_at (`+00:00`) and ISO-Z result both pass validator post-fix", async () => {
    const finalizedJob: InternalJobRow = {
      id: PROD_JOB_ID, batch_id: PROD_BATCH_ID, workspace_id: PROD_WORKSPACE_ID, candidate_id: PROD_CANDIDATE_ID,
      product_id: "guntur-dry-red-chilli", country_code: "TH",
      status: "completed", stage: "complete", revision: 43, lease_owner: null,
    };
    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = pgNormalisedClient({
      // Pre-05C state: no snapshot.
      existingSnapshots: [],
      plans: [
        { id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
      ],
      attempts: [{ provider_plan_id: "plan-ws", attempt_number: 1, state: "completed", safe_error_code: null }],
      finalizeRpc,
      captureInserts,
    });
    const writer = new TradeResearchWriter(client);
    await writer.finalize(prodJob(), "worker-a", "completed", "no_verified_evidence", websiteSummary());
    // 05C self-heal fired exactly once.
    expect(captureInserts).toHaveLength(1);
    // 05D validator accepted the DB-returned retrieved_at (which the
    // mock client normalises to `+00:00`).
    expect(finalizeRpc).toHaveBeenCalledTimes(1);
  });

  it("T12 CERTIFICATION SAFETY — finalize succeeds even if the certification writer method is absent (certification is best-effort)", async () => {
    // Repository.finalize does NOT call certifyFinalizedJob; that's
    // the worker's job post-finalize and is already wrapped in a
    // try/catch. We assert here that the repository-level finalize
    // never throws a certification-related code — it only throws
    // snapshot/projection/RPC codes.
    const finalizedJob: InternalJobRow = {
      id: PROD_JOB_ID, batch_id: PROD_BATCH_ID, workspace_id: PROD_WORKSPACE_ID, candidate_id: PROD_CANDIDATE_ID,
      product_id: "guntur-dry-red-chilli", country_code: "TH",
      status: "completed", stage: "complete", revision: 43, lease_owner: null,
    };
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = pgNormalisedClient({
      existingSnapshots: [{
        provider_id: "public-website", dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION, published_period: "2026-10",
        retrieved_at: NOW_PG_TIMESTAMPTZ, parse_version: "public-website-html-v2",
      }],
      plans: [{ id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null }],
      attempts: [{ provider_plan_id: "plan-ws", attempt_number: 1, state: "completed", safe_error_code: null }],
      finalizeRpc, captureInserts: [],
    });
    const writer = new TradeResearchWriter(client);
    await expect(writer.finalize(prodJob(), "worker-a", "completed", "no_verified_evidence", websiteSummary())).resolves.toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────
// Worker-level: processTradeResearchJob drives REAL repository.finalize
// (the 05C suite mocked finalize as a drop-through and hid this class).
// ───────────────────────────────────────────────────────────────
describe("TH07 DEFECT 05D — processTradeResearchJob uses real repository.finalize", () => {
  function websiteCheckpointForWorker(): TradeResearchProviderResult {
    return websiteCheckpoint({ retrievedAt: NOW_ISO_Z });
  }

  it("exact production mixed shape + existing PG-normalised snapshot → completed/complete/no_verified_evidence; no recoverClaimedJob; no attempt #4", async () => {
    const finalizedJob: InternalJobRow = {
      id: PROD_JOB_ID, batch_id: PROD_BATCH_ID, workspace_id: PROD_WORKSPACE_ID, candidate_id: PROD_CANDIDATE_ID,
      product_id: "guntur-dry-red-chilli", country_code: "TH",
      status: "completed", stage: "complete", revision: 43, lease_owner: null,
    };
    (finalizedJob as unknown as { outcome: string }).outcome = "no_verified_evidence";
    (finalizedJob as unknown as { completed_at: string }).completed_at = NOW_PG_TIMESTAMPTZ;
    (finalizedJob as unknown as { lease_expires_at: null }).lease_expires_at = null;

    const captureInserts: Array<Record<string, unknown>> = [];
    const finalizeRpc = vi.fn(async () => ({ data: finalizedJob, error: null }));
    const client = pgNormalisedClient({
      existingSnapshots: [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: NOW_PG_TIMESTAMPTZ,
        parse_version: "public-website-html-v2",
      }],
      plans: [
        { id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
        { id: "plan-cust", provider_id: "thai-customs-stats", sequence: 2, eligibility: "eligible", decision_reason: "eligible", dataset_version: null },
        { id: "plan-fsvp", provider_id: "fda-fsvp", sequence: 3, eligibility: "ineligible", decision_reason: "wrong_country", dataset_version: null },
        { id: "plan-vqip", provider_id: "fda-vqip", sequence: 4, eligibility: "ineligible", decision_reason: "wrong_country", dataset_version: null },
        { id: "plan-cid", provider_id: "canada-cid", sequence: 5, eligibility: "ineligible", decision_reason: "wrong_country", dataset_version: null },
      ],
      attempts: [
        { provider_plan_id: "plan-ws", attempt_number: 1, state: "completed", safe_error_code: null },
        { provider_plan_id: "plan-cust", attempt_number: 3, state: "failed_retryable", safe_error_code: "CATALOG_CONNECT_TIMEOUT" },
      ],
      finalizeRpc,
      captureInserts,
    });
    const realWriter = new TradeResearchWriter(client);
    const recoverClaimedJob = vi.fn();
    const startAttempt = vi.fn();
    const diagnostics: TradeResearchDiagnostic[] = [];
    const writer = {
      isCancellationRequested: vi.fn(async () => false),
      getProviderPlans: vi.fn(async () => [
        { id: "plan-ws", provider_id: "public-website", sequence: 1, eligibility: "eligible", decision_reason: "eligible", cost_class: "free", automatic_spend_rupees: 0 },
        { id: "plan-cust", provider_id: "thai-customs-stats", sequence: 2, eligibility: "eligible", decision_reason: "eligible", cost_class: "free", automatic_spend_rupees: 0 },
        { id: "plan-fsvp", provider_id: "fda-fsvp", sequence: 3, eligibility: "ineligible", decision_reason: "wrong_country", cost_class: "free", automatic_spend_rupees: 0 },
        { id: "plan-vqip", provider_id: "fda-vqip", sequence: 4, eligibility: "ineligible", decision_reason: "wrong_country", cost_class: "free", automatic_spend_rupees: 0 },
        { id: "plan-cid", provider_id: "canada-cid", sequence: 5, eligibility: "ineligible", decision_reason: "wrong_country", cost_class: "free", automatic_spend_rupees: 0 },
      ]),
      latestAttempt: vi.fn(async (planId: string) => {
        if (planId === "plan-ws") {
          return {
            id: "att-ws", attempt_number: 1, state: "completed", provider_plan_id: "plan-ws",
            provider_result: websiteCheckpointForWorker(),
          };
        }
        if (planId === "plan-cust") {
          return {
            id: "att-cust-3", attempt_number: 3, state: "failed_retryable",
            provider_plan_id: "plan-cust", safe_error_code: "CATALOG_CONNECT_TIMEOUT",
          };
        }
        return undefined;
      }),
      advance: vi.fn(async (row: InternalJobRow, _w: string, stage: InternalJobRow["stage"]) => ({
        ...row, stage, revision: row.revision + 1,
      })),
      finalize: (job: InternalJobRow, worker: string, status: "completed" | "partial" | "needs_review" | "failed" | "cancelled", outcome: "no_verified_evidence" | "failed" | "cancelled" | "partial" | "needs_review" | "unsupported_coverage" | "official_importer_program_corroboration" | "trade_activity_only", result: TradeResearchResultSummary) =>
        realWriter.finalize(job, worker, status, outcome, result),
      recoverClaimedJob,
      startAttempt,
      getCandidate: vi.fn(async (): Promise<BuyerCandidate> => ({
        id: PROD_CANDIDATE_ID, companyName: "Spunky Food Co.",
        website: "spunkyfood.com", domain: "spunkyfood.com",
        country: "Thailand", industry: "Food", isImporter: true,
        discoveryStatus: "ready", reviewStatus: "pending",
      })),
      appendEvent: vi.fn(),
      release: vi.fn(),
      heartbeat: vi.fn(),
      certifyResearchJob: vi.fn(async () => ({
        outcome: "inserted" as const, status: "certified" as const,
        snapshotFingerprint: "fp", classifierVersion: "v2",
      })),
    } as unknown as TradeResearchWriter;

    const outcome = await processTradeResearchJob(
      writer,
      prodJob({ stage: "finalizing", revision: 42, lease_owner: "worker-a" }),
      "worker-a",
      () => new Date(NOW_ISO_Z),
      undefined,
      (d) => { diagnostics.push(d); },
    );

    expect(outcome).toBe("completed");
    expect(finalizeRpc).toHaveBeenCalledTimes(1);
    const payload = (finalizeRpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]![1];
    expect(payload.p_status).toBe("completed");
    expect(payload.p_outcome).toBe("no_verified_evidence");
    expect(captureInserts).toHaveLength(0);
    expect(recoverClaimedJob).not.toHaveBeenCalled();
    expect(startAttempt).not.toHaveBeenCalled();
    expect(diagnostics.find((d) => d.event === "job_finalize_blocked")).toBeUndefined();
    expect(diagnostics.find((d) => d.event === "job_finalized")?.outcome).toBe("no_verified_evidence");
    const summary = payload.p_result_summary as { automaticSpendRupees: number; providerResults: Array<{ providerId: string; execution: { status: string; safeErrorCode?: string | null }; datasetVersion?: string }> };
    expect(summary.automaticSpendRupees).toBe(0);
    const website = summary.providerResults.find((r) => r.providerId === "public-website");
    expect(website?.execution.status).toBe("completed");
    expect(website?.datasetVersion).toBe(WEBSITE_DATASET_VERSION);
    const customs = summary.providerResults.find((r) => r.providerId === "thai-customs-stats");
    expect(customs?.execution.status).toBe("failed_retryable");
    expect(customs?.execution.safeErrorCode).toBe("CATALOG_CONNECT_TIMEOUT");
  });
});
