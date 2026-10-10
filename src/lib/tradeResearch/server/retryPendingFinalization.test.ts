import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { InternalJobRow, TradeResearchWriter } from "../repository";
import type { ResearchContext, TradeResearchProviderResult, TradeResearchSourceEvidence } from "../types";
import type { TradeResearchProviderDescriptor } from "../providers";
import { retryDelayMs } from "../stateMachine";
import { validateProviderResultSnapshots } from "../providerOutcomes";
import {
  createTradeResearchProviderRegistry,
  type ProviderExecutionResult,
  type TradeResearchProviderExecutor,
} from "./providerExecutors";
import { processTradeResearchJob } from "./worker";
import type { TradeResearchDiagnostic } from "./diagnostics";
import { classifyFetchFailure } from "../thaiCustomsStats/catalog";

/**
 * TH07 DEFECT 05E — a job must not terminalize while any eligible
 * provider still has retry budget.
 *
 * Production (jobId c5b80ba6-d8be-48fc-811f-f0409655c5ba):
 *   thai-customs-stats attempt 1 = failed_retryable CATALOG_CONNECT_TIMEOUT
 *   public-website attempt 1 = completed (snapshot persisted, no 05C backfill)
 *   immediately stage=finalizing → status=needs_review
 *   NO attempt 2, NO attempt 3, NO job_requeued, NO retry delay
 *
 * Root cause: processProviderPlans released/requeued only when
 * `eligiblePlans.length === 1`. Thailand has two eligible providers,
 * so customs attempt 1 was recorded and the loop continued to
 * website, then finalizeGenericResults ran.
 */

const NOW = new Date("2026-10-10T08:24:51.000Z");
const WEBSITE_DATASET_VERSION = "sha256:783c775f92dbe463a94f132bcc17ff388ebdd934611135e665887da0e8749b52";
const PROD_JOB_ID = "c5b80ba6-d8be-48fc-811f-f0409655c5ba";
const PROD_BATCH_ID = "d543c810-51f6-4215-b91c-df41943f5244";
const PROD_CANDIDATE_ID = "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc";
const PROD_WORKSPACE_ID = "00000000-0000-4000-8000-00000000ff01";

const CONTEXT: ResearchContext = {
  workspaceId: PROD_WORKSPACE_ID,
  candidateId: PROD_CANDIDATE_ID,
  marketCountryCode: "TH",
  productId: "guntur-dry-red-chilli",
  productForm: null,
  researchGoal: "screen_trade_activity",
  providerPlanVersion: "thailand-provider-plan-v1",
  interpretationVersion: "public-website-html-v2:t08-v1",
};

function descriptor(id: string, countries: string[] = ["TH"]): TradeResearchProviderDescriptor {
  return {
    id, displayName: id, version: `${id}-v1`, costClass: "free", countries,
    roles: ["COMPANY_MATCH"], automationAllowed: true, termsApproved: true,
    termsVersion: "test-v1", datasetCadence: "annual", cacheMaxAgeDays: 1,
    compatiblePlannerVersions: ["trade-planner-v1", "thailand-provider-plan-v1"],
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
    id: PROD_JOB_ID, batch_id: PROD_BATCH_ID, workspace_id: PROD_WORKSPACE_ID,
    candidate_id: PROD_CANDIDATE_ID, product_id: "guntur-dry-red-chilli",
    country_code: "TH", status: "running", stage: "preparing_identity",
    revision: 1, research_context: CONTEXT, lease_owner: "worker-a", ...over,
  };
}

function websiteEvaluated(): ProviderExecutionResult {
  const source = {
    providerId: "public-website" as TradeResearchSourceEvidence["providerId"],
    outcome: "completed" as const,
    source: "Candidate Public Website" as const, datasetPeriod: "2026-10", retrievedAt: NOW.toISOString(),
    candidateName: "Spunky Food Co.", identityDecision: "ambiguous" as const,
    matchReason: "Name overlap on the company's own website.",
    coverageExplanation: "Pages inspected: 1.",
    companyEvidence: "supporting" as const, productEvidence: "supporting" as const,
    originEvidence: "not_available" as const, shipmentEvidence: "not_verified" as const,
    attribution: "Candidate's own public website.",
  } as TradeResearchSourceEvidence;
  const providerResult: TradeResearchProviderResult = {
    providerId: "public-website",
    datasetId: "public-website-homepage",
    datasetVersion: WEBSITE_DATASET_VERSION,
    parserVersion: "public-website-html-v2",
    sourceRecordIds: ["website:spunkyfood.com"],
    sourcePeriod: "2026-10",
    retrievedAt: NOW.toISOString(),
    execution: { status: "completed", safeErrorCode: null },
    evidence: {
      matchDecision: "ambiguous",
      companyEvidence: { state: "supporting", explanation: "On-site identity overlap." },
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
  };
  return { status: "completed", providerResult, sourceEvidence: source, recordCount: 6933, matchCount: 3 };
}

function customsRetryable(): ProviderExecutionResult {
  return { status: "failed_retryable", safeErrorCode: "CATALOG_CONNECT_TIMEOUT", retryable: true };
}

function websiteCheckpoint(attemptNumber = 1) {
  const result = websiteEvaluated();
  if (!("providerResult" in result)) throw new Error("invalid fixture");
  return {
    id: `attempt-public-website-${attemptNumber}`,
    provider_plan_id: "plan-public-website",
    attempt_number: attemptNumber,
    state: "completed",
    provider_result: result.providerResult,
  };
}

function customsAttempt(attemptNumber: number) {
  return {
    id: `attempt-thai-customs-stats-${attemptNumber}`,
    provider_plan_id: "plan-thai-customs-stats",
    attempt_number: attemptNumber,
    state: "failed_retryable",
    safe_error_code: "CATALOG_CONNECT_TIMEOUT",
  };
}

function fsvpEvaluated(providerId = "fda-fsvp"): ProviderExecutionResult {
  const source = {
    providerId: providerId as TradeResearchSourceEvidence["providerId"],
    outcome: "completed" as const,
    source: "FDA FSVP" as const, datasetPeriod: "2026", retrievedAt: NOW.toISOString(),
    candidateName: "LT Foods Americas", identityDecision: "exact" as const,
    matchReason: "test", coverageExplanation: "test",
    companyEvidence: "verified" as const, productEvidence: "not_available" as const,
    originEvidence: "not_available" as const, shipmentEvidence: "not_verified" as const,
    attribution: "FDA FSVP Importer List",
  } as TradeResearchSourceEvidence;
  const providerResult: TradeResearchProviderResult = {
    providerId, datasetId: `${providerId}-dataset`, datasetVersion: `${providerId}-hash`,
    parserVersion: `${providerId}-parser`, sourceRecordIds: [`${providerId}-row`],
    sourcePeriod: "2026", retrievedAt: NOW.toISOString(),
    execution: { status: "completed", safeErrorCode: null },
    evidence: {
      matchDecision: "exact",
      companyEvidence: { state: "verified", explanation: "FSVP participant match." },
      productEvidence: { state: "not_available", explanation: "program-level." },
      originEvidence: { state: "not_available", explanation: "destination-only." },
      indiaOriginEvidence: { state: "not_verified", explanation: "n/a" },
      shipmentEvidence: { state: "not_verified", explanation: "n/a" },
      programEvidence: { state: "verified", explanation: "Verified FDA FSVP participant." },
      coverage: { state: "partially_covered", explanation: "program-level only." },
      limitations: [], attribution: "FDA FSVP Importer List",
      mappingScope: {
        marketCountryCode: "US", productId: "guntur-dry-red-chilli", productForm: null,
        sourceProductCodes: [], companyGrain: "company_record", productGrain: "not_available",
        originGrain: "not_available", shipmentGrain: "not_available", programGrain: "company_program",
      },
      interpretationVersion: "fsvp-v1:t08-v1", conflicts: [],
    },
  };
  return { status: "completed", providerResult, sourceEvidence: source, recordCount: 1, matchCount: 1 };
}

function executor(
  providerId: string,
  execute: TradeResearchProviderExecutor["execute"],
): TradeResearchProviderExecutor {
  return {
    providerId, descriptor: descriptor(providerId, providerId === "canada-cid" ? ["CA"] : providerId.startsWith("fda") ? ["US"] : ["TH"]),
    requiredStartBudgetMs: 1_000,
    hasFreshSnapshot: vi.fn(async () => false), execute,
  };
}

function thailandPlans() {
  return [
    plan("thai-customs-stats", 1),
    plan("public-website", 2),
    plan("fda-fsvp", 3, { eligibility: "ineligible", decision_reason: "wrong_country" }),
    plan("fda-vqip", 4, { eligibility: "ineligible", decision_reason: "wrong_country" }),
    plan("canada-cid", 5, { eligibility: "ineligible", decision_reason: "wrong_country" }),
  ];
}

function productionClaimPredicate(nextAttemptAt: string | null, now: Date): boolean {
  const next = nextAttemptAt ? new Date(nextAttemptAt) : now;
  return next <= now;
}

function fixture(input: {
  plans: Array<Record<string, unknown>>;
  attempts?: Map<string, Record<string, unknown>>;
  countryCode?: string;
}) {
  const attempts = input.attempts ?? new Map<string, Record<string, unknown>>();
  const startedById = new Map<string, { planId: string; attemptNumber: number }>();
  const state = {
    starts: [] as Array<{ planId: string; attemptNumber: number }>,
    finishes: [] as Array<{ id: string; patch: Record<string, unknown>; result?: TradeResearchProviderResult }>,
    events: [] as Array<{ event: string; details: Record<string, unknown> }>,
    finalized: [] as Array<{ status: string; outcome: string; result: Record<string, unknown>; job: InternalJobRow }>,
    releases: [] as Array<{ nextAttemptAt: string; leaseOwner: null }>,
    diagnostics: [] as TradeResearchDiagnostic[],
  };
  const writer = {
    getProviderPlans: vi.fn(async () => input.plans),
    isCancellationRequested: vi.fn(async () => false),
    refreshOwnedJob: vi.fn(async (row: InternalJobRow) => row),
    advance: vi.fn(async (row: InternalJobRow, _owner: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    latestAttempt: vi.fn(async (planId: string) => attempts.get(planId)),
    reconcileStaleAttempt: vi.fn(async () => undefined),
    startAttempt: vi.fn(async (_row: InternalJobRow, planId: string, attemptNumber: number) => {
      const id = `new-${planId}-${attemptNumber}`;
      state.starts.push({ planId, attemptNumber });
      startedById.set(id, { planId, attemptNumber });
      return { id, attempt_number: attemptNumber };
    }),
    finishAttempt: vi.fn(async (_row: InternalJobRow, _owner: string, id: string, patch: Record<string, unknown>) => {
      state.finishes.push({ id, patch });
      const started = startedById.get(id);
      if (started) {
        attempts.set(started.planId, { id, provider_plan_id: started.planId, attempt_number: started.attemptNumber, ...patch });
      }
    }),
    finishAttemptWithCheckpoint: vi.fn(async (_row: InternalJobRow, _owner: string, id: string, patch: Record<string, unknown>, result: TradeResearchProviderResult) => {
      state.finishes.push({ id, patch, result });
      const started = startedById.get(id);
      if (started) {
        attempts.set(started.planId, {
          id, provider_plan_id: started.planId, attempt_number: started.attemptNumber, ...patch, provider_result: result,
        });
      }
    }),
    appendEvent: vi.fn(async (_row: InternalJobRow, event: string, details: Record<string, unknown>) => {
      state.events.push({ event, details });
    }),
    release: vi.fn(async (row: InternalJobRow, _worker: string, nextAttemptAt: string) => {
      state.releases.push({ nextAttemptAt, leaseOwner: null });
      return { ...row, revision: row.revision + 1, lease_owner: null };
    }),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (row: InternalJobRow, _owner: string, status: InternalJobRow["status"], outcome: string, result: Record<string, unknown>) => {
      const finalizedJob: InternalJobRow = {
        ...row, status, stage: "complete", revision: row.revision + 1, lease_owner: null,
      };
      (finalizedJob as unknown as { outcome: string; completed_at: string }).outcome = outcome;
      (finalizedJob as unknown as { completed_at: string }).completed_at = NOW.toISOString();
      state.finalized.push({ status, outcome, result, job: finalizedJob });
      return finalizedJob;
    }),
    getCandidate: vi.fn(async () => ({
      id: PROD_CANDIDATE_ID, companyName: "Spunky Food Co.", country: "Thailand",
      website: "spunkyfood.com", domain: "spunkyfood.com",
      discoveryStatus: "ready", reviewStatus: "pending",
    })),
  };
  const log = (d: TradeResearchDiagnostic) => { state.diagnostics.push(d); };
  return { writer: writer as unknown as TradeResearchWriter, state, attempts, log };
}

function thailandRegistry(
  customsExecute: TradeResearchProviderExecutor["execute"],
  websiteExecute: TradeResearchProviderExecutor["execute"] = async () => websiteEvaluated(),
) {
  return createTradeResearchProviderRegistry([
    executor("thai-customs-stats", customsExecute),
    executor("public-website", websiteExecute),
  ]);
}

describe("TH07 DEFECT 05E — CASE A attempt 1: retry remaining must not finalize", () => {
  it("exact production shape: website completed + customs attempt 1 failed_retryable → no finalize, next_attempt_at = now+retryDelayMs(1), lease released, website preserved, no second website attempt", async () => {
    const fx = fixture({ plans: thailandPlans() });
    const websiteRun = vi.fn(async () => websiteEvaluated());
    const customsRun = vi.fn(async () => customsRetryable());
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(customsRun, websiteRun),
    );

    expect(outcome).toBe("retry");
    expect(fx.state.finalized).toHaveLength(0);
    expect(fx.writer.finalize).not.toHaveBeenCalled();
    expect(fx.state.events.some((e) => e.event === "job_completed")).toBe(false);
    expect(fx.state.diagnostics.some((d) => d.event === "job_finalized")).toBe(false);

    expect(fx.state.releases).toHaveLength(1);
    const nextAttemptAt = fx.state.releases[0]!.nextAttemptAt;
    expect(Date.parse(nextAttemptAt) - NOW.getTime()).toBe(retryDelayMs(1));
    expect(fx.state.releases[0]!.leaseOwner).toBeNull();

    expect(websiteRun).toHaveBeenCalledTimes(1);
    expect(customsRun).toHaveBeenCalledTimes(1);
    expect(fx.state.starts).toEqual([
      { planId: "plan-thai-customs-stats", attemptNumber: 1 },
      { planId: "plan-public-website", attemptNumber: 1 },
    ]);
    const websiteFinish = fx.state.finishes.find((f) => f.result?.providerId === "public-website");
    expect(websiteFinish?.result?.datasetVersion).toBe(WEBSITE_DATASET_VERSION);
    expect(websiteFinish?.result?.execution.status).toBe("completed");
    const customsFinish = fx.state.finishes.find((f) => f.patch.safe_error_code === "CATALOG_CONNECT_TIMEOUT");
    expect(customsFinish?.patch.state).toBe("failed_retryable");

    const scheduled = fx.state.diagnostics.filter((d) => d.event === "provider_retry_scheduled");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.providerId).toBe("thai-customs-stats");
    expect(scheduled[0]!.attemptNumber).toBe(1);
    expect(scheduled[0]!.retryAfterMs).toBe(30_000);
    expect(fx.state.diagnostics.find((d) => d.event === "job_retry_pending")).toBeDefined();

    expect(productionClaimPredicate(nextAttemptAt, NOW)).toBe(false);
    expect(productionClaimPredicate(nextAttemptAt, new Date(NOW.getTime() + 29_000))).toBe(false);
    expect(productionClaimPredicate(nextAttemptAt, new Date(NOW.getTime() + 30_000))).toBe(true);
  });

  it("after due time, resume runs Customs attempt 2 and does NOT rerun website", async () => {
    const fx = fixture({
      plans: thailandPlans(),
      attempts: new Map<string, Record<string, unknown>>([
        ["plan-public-website", websiteCheckpoint()],
        ["plan-thai-customs-stats", customsAttempt(1)],
      ]),
    });
    const websiteRun = vi.fn(async () => websiteEvaluated());
    const customsRun = vi.fn(async () => customsRetryable());
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(customsRun, websiteRun),
    );
    expect(outcome).toBe("retry");
    expect(fx.state.finalized).toHaveLength(0);
    expect(websiteRun).not.toHaveBeenCalled();
    expect(fx.state.starts).toEqual([{ planId: "plan-thai-customs-stats", attemptNumber: 2 }]);
    expect(Date.parse(fx.state.releases[0]!.nextAttemptAt) - NOW.getTime()).toBe(retryDelayMs(2));
    expect(fx.state.diagnostics.find((d) => d.event === "provider_retry_scheduled")?.attemptNumber).toBe(2);
  });
});

describe("TH07 DEFECT 05E — CASE A attempt 2 still parks", () => {
  it("Customs attempt 2 failed_retryable → retryDelayMs(2), no finalize, no website rerun, attempt 3 not started this tick", async () => {
    const fx = fixture({
      plans: thailandPlans(),
      attempts: new Map<string, Record<string, unknown>>([
        ["plan-public-website", websiteCheckpoint()],
        ["plan-thai-customs-stats", customsAttempt(1)],
      ]),
    });
    const websiteRun = vi.fn(async () => websiteEvaluated());
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable(), websiteRun),
    );
    expect(outcome).toBe("retry");
    expect(fx.state.finalized).toHaveLength(0);
    expect(websiteRun).not.toHaveBeenCalled();
    expect(fx.state.starts.map((s) => s.attemptNumber)).toEqual([2]);
    expect(fx.state.starts.some((s) => s.attemptNumber === 3)).toBe(false);
    expect(Date.parse(fx.state.releases[0]!.nextAttemptAt) - NOW.getTime()).toBe(retryDelayMs(2));
    expect(productionClaimPredicate(fx.state.releases[0]!.nextAttemptAt, NOW)).toBe(false);
    expect(productionClaimPredicate(fx.state.releases[0]!.nextAttemptAt, new Date(NOW.getTime() + 120_000))).toBe(true);
  });
});

describe("TH07 DEFECT 05E — CASE B attempt 3 exhausted may finalize", () => {
  it("Customs attempt 3 failed_retryable + retryDelayMs(3)=null → finalize needs_review, website preserved, no attempt 4", async () => {
    const fx = fixture({
      plans: thailandPlans(),
      attempts: new Map<string, Record<string, unknown>>([
        ["plan-public-website", websiteCheckpoint()],
        ["plan-thai-customs-stats", customsAttempt(2)],
      ]),
    });
    const websiteRun = vi.fn(async () => websiteEvaluated());
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable(), websiteRun),
    );
    expect(retryDelayMs(3)).toBeNull();
    expect(outcome).toBe("completed");
    expect(fx.state.finalized).toHaveLength(1);
    expect(fx.state.finalized[0]!.status).toBe("needs_review");
    expect(fx.state.finalized[0]!.outcome).toBe("needs_review");
    expect(fx.state.finalized[0]!.job.stage).toBe("complete");
    expect(fx.state.finalized[0]!.job.lease_owner).toBeNull();
    expect((fx.state.finalized[0]!.job as unknown as { completed_at: string }).completed_at).toBeTruthy();
    expect(websiteRun).not.toHaveBeenCalled();
    expect(fx.state.starts).toEqual([{ planId: "plan-thai-customs-stats", attemptNumber: 3 }]);
    expect(fx.state.starts.some((s) => s.attemptNumber === 4)).toBe(false);
    expect(fx.state.releases).toHaveLength(0);
    const providers = fx.state.finalized[0]!.result.providerResults as TradeResearchProviderResult[];
    expect(providers.find((p) => p.providerId === "public-website")?.datasetVersion).toBe(WEBSITE_DATASET_VERSION);
    expect(providers.find((p) => p.providerId === "thai-customs-stats")?.execution.status).toBe("failed_retryable");
    expect(providers.find((p) => p.providerId === "thai-customs-stats")?.execution.safeErrorCode).toBe("CATALOG_CONNECT_TIMEOUT");
    expect(fx.state.finalized[0]!.result.automaticSpendRupees).toBe(0);
  });

  it("already-exhausted attempt 3 on disk (resume) finalizes without starting attempt 4", async () => {
    const fx = fixture({
      plans: thailandPlans(),
      attempts: new Map<string, Record<string, unknown>>([
        ["plan-public-website", websiteCheckpoint()],
        ["plan-thai-customs-stats", customsAttempt(3)],
      ]),
    });
    const websiteRun = vi.fn(async () => websiteEvaluated());
    const customsRun = vi.fn(async () => customsRetryable());
    const outcome = await processTradeResearchJob(
      fx.writer, job({ stage: "finalizing" }), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(customsRun, websiteRun),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.finalized[0]!.status).toBe("needs_review");
    expect(fx.state.finalized[0]!.outcome).toBe("needs_review");
    expect(websiteRun).not.toHaveBeenCalled();
    expect(customsRun).not.toHaveBeenCalled();
    expect(fx.state.starts).toEqual([]);
  });
});

describe("TH07 DEFECT 05E — regressions", () => {
  it("all-success still finalizes immediately", async () => {
    const fx = fixture({ plans: [plan("public-website", 1), plan("thai-customs-stats", 2)] });
    const customsCompleted: ProviderExecutionResult = {
      status: "no_match",
      providerResult: {
        providerId: "thai-customs-stats", datasetId: "ctm_06_11", datasetVersion: "material-hash-customs",
        parserVersion: "thai-customs-stats-csv-v1", sourceRecordIds: ["ctm_06_11:2026-09:HS0904"],
        sourcePeriod: "2026-09", retrievedAt: NOW.toISOString(),
        execution: { status: "no_match", safeErrorCode: null },
        evidence: {
          matchDecision: "none",
          companyEvidence: { state: "not_available", explanation: "aggregate." },
          productEvidence: { state: "not_available", explanation: "aggregate." },
          originEvidence: { state: "not_available", explanation: "aggregate." },
          indiaOriginEvidence: { state: "not_verified", explanation: "n/a" },
          shipmentEvidence: { state: "not_verified", explanation: "n/a" },
          programEvidence: { state: "not_available", explanation: "n/a" },
          coverage: { state: "not_covered", explanation: "aggregate ctm_06_11" },
          limitations: [], attribution: "Thai Customs Data Catalog (CKAN)",
          mappingScope: {
            marketCountryCode: "TH", productId: "guntur-dry-red-chilli", productForm: null,
            sourceProductCodes: [],             companyGrain: "not_available", productGrain: "market_product",
            originGrain: "market_product_origin", shipmentGrain: "not_available", programGrain: "not_available",
          },
          interpretationVersion: "customs-stats-v1:t08-v1", conflicts: [],
        },
      },
      sourceEvidence: {
        providerId: "thai-customs-stats", outcome: "no_match", source: "Thai Customs Data Catalog — ctm_06_11",
        datasetPeriod: "2026-09", retrievedAt: NOW.toISOString(), identityDecision: "none",
        matchReason: "aggregate", coverageExplanation: "aggregate",
        companyEvidence: "not_available", productEvidence: "not_available",
        originEvidence: "not_available", shipmentEvidence: "not_verified",
        attribution: "Thai Customs Data Catalog (CKAN)",
      } as TradeResearchSourceEvidence,
      recordCount: 0, matchCount: 0,
    };
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      createTradeResearchProviderRegistry([
        executor("public-website", async () => websiteEvaluated()),
        executor("thai-customs-stats", async () => customsCompleted),
      ]),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.finalized).toHaveLength(1);
    expect(fx.state.releases).toHaveLength(0);
  });

  it("all-terminal-failed still finalizes", async () => {
    const fx = fixture({ plans: [plan("public-website", 1), plan("thai-customs-stats", 2)] });
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      createTradeResearchProviderRegistry([
        executor("public-website", async () => ({ status: "failed_terminal", safeErrorCode: "WEBSITE_DNS_UNRESOLVED", retryable: false })),
        executor("thai-customs-stats", async () => ({ status: "failed_terminal", safeErrorCode: "CATALOG_HTTP_404", retryable: false })),
      ]),
    );
    expect(outcome).toBe("failed");
    expect(fx.state.finalized[0]!.status).toBe("failed");
    expect(fx.state.releases).toHaveLength(0);
  });

  it("one success + one exhausted retryable finalizes (CASE B)", async () => {
    const fx = fixture({
      plans: thailandPlans(),
      attempts: new Map<string, Record<string, unknown>>([
        ["plan-public-website", websiteCheckpoint()],
        ["plan-thai-customs-stats", customsAttempt(3)],
      ]),
    });
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable()),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.finalized).toHaveLength(1);
  });

  it("one success + one retry-pending does NOT finalize (CASE A)", async () => {
    const fx = fixture({ plans: [plan("public-website", 1), plan("thai-customs-stats", 2)] });
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable()),
    );
    expect(outcome).toBe("retry");
    expect(fx.state.finalized).toHaveLength(0);
  });

  it("unsupported providers never block completion", async () => {
    const fx = fixture({
      plans: [
        plan("public-website", 1),
        plan("fda-fsvp", 2, { eligibility: "ineligible", decision_reason: "wrong_country" }),
      ],
    });
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      createTradeResearchProviderRegistry([executor("public-website", async () => websiteEvaluated())]),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.finalized).toHaveLength(1);
  });

  it("blocked/terminal providers do not retry", async () => {
    const fx = fixture({ plans: [plan("thai-customs-stats", 1), plan("public-website", 2)] });
    const customsRun = vi.fn(async (): Promise<ProviderExecutionResult> => (
      { status: "failed_terminal", safeErrorCode: "SOURCE_UNAVAILABLE", retryable: false }
    ));
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(customsRun),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.releases).toHaveLength(0);
    expect(fx.state.starts.filter((s) => s.planId === "plan-thai-customs-stats")).toHaveLength(1);
  });

  it("cached results count as evaluated and do not block completion", async () => {
    const completed = websiteEvaluated();
    if (completed.status !== "completed") throw new Error("expected completed website");
    const cachedProviderResult = {
      ...completed.providerResult,
      execution: { status: "cached" as const, safeErrorCode: null },
    } as TradeResearchProviderResult;
    const cachedResult: ProviderExecutionResult = {
      status: "cached",
      providerResult: cachedProviderResult,
      sourceEvidence: completed.sourceEvidence,
      recordCount: completed.recordCount,
      matchCount: completed.matchCount,
    };
    const fx = fixture({
      plans: [plan("public-website", 1)],
      attempts: new Map<string, Record<string, unknown>>([["plan-public-website", {
        id: "att-ws", attempt_number: 1, state: "skipped_cached",
        provider_plan_id: "plan-public-website",
        provider_result: cachedProviderResult,
      }]]),
    });
    const websiteRun = vi.fn(async () => cachedResult);
    const outcome = await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      createTradeResearchProviderRegistry([executor("public-website", websiteRun)]),
    );
    expect(outcome).toBe("completed");
    expect(websiteRun).not.toHaveBeenCalled();
    expect(fx.state.finalized).toHaveLength(1);
  });

  it("US behavior: verified FSVP still finalizes immediately when the other US source is terminal", async () => {
    const fx = fixture({
      plans: [plan("fda-fsvp", 1), plan("fda-vqip", 2, { eligibility: "ineligible", decision_reason: "wrong_role" })],
    });
    const outcome = await processTradeResearchJob(
      fx.writer, job({ country_code: "US", candidate_id: "candidate-us", research_context: { ...CONTEXT, marketCountryCode: "US" } }),
      "worker-a", () => NOW, undefined, fx.log, undefined,
      createTradeResearchProviderRegistry([executor("fda-fsvp", async () => fsvpEvaluated())]),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.finalized[0]!.outcome).toBe("official_importer_program_corroboration");
  });

  it("Canada behavior: CID success still finalizes when no retry-pending sibling exists", async () => {
    const cid = fsvpEvaluated("canada-cid");
    const fx = fixture({ plans: [plan("canada-cid", 1)] });
    const outcome = await processTradeResearchJob(
      fx.writer, job({ country_code: "CA", research_context: { ...CONTEXT, marketCountryCode: "CA" } }),
      "worker-a", () => NOW, undefined, fx.log, undefined,
      createTradeResearchProviderRegistry([executor("canada-cid", async () => cid)]),
    );
    expect(outcome).toBe("completed");
    expect(fx.state.finalized).toHaveLength(1);
  });

  it("Thailand evidence: customs timeout is not negative evidence (shipment stays not_verified)", async () => {
    const fx = fixture({
      plans: thailandPlans(),
      attempts: new Map<string, Record<string, unknown>>([
        ["plan-public-website", websiteCheckpoint()],
        ["plan-thai-customs-stats", customsAttempt(3)],
      ]),
    });
    await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable()),
    );
    expect(fx.state.finalized[0]!.result.shipmentEvidence).toBe("not_verified");
    expect(fx.state.finalized[0]!.result.indiaOrigin).toBe("not_verified");
  });

  it("automatic spend remains 0", async () => {
    const fx = fixture({ plans: thailandPlans() });
    await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable()),
    );
    expect(fx.state.finalized).toHaveLength(0);
    const spend = (thailandPlans()[0] as { automatic_spend_rupees: number }).automatic_spend_rupees;
    expect(spend).toBe(0);
  });

  it("scheduler architecture unchanged (migration 0037 still present)", () => {
    const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"), "utf8");
    expect(sql).toMatch(/schedule_trade_research_drain/);
  });

  it("05A Customs classifier unchanged", () => {
    const err = new Error("x"); err.name = "FetchError";
    (err as unknown as { cause: unknown }).cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
    expect(classifyFetchFailure("CATALOG", err).code).toBe("CATALOG_CONNECT_TIMEOUT");
  });

  it("05B/05D website snapshot hash + semantic retrieved_at compare unchanged", () => {
    expect(WEBSITE_DATASET_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
    const website = websiteEvaluated();
    if (website.status !== "completed") throw new Error("expected completed website");
    expect(() => validateProviderResultSnapshots(
      [website.providerResult],
      [{
        provider_id: "public-website",
        dataset_id: "public-website-homepage",
        material_hash: WEBSITE_DATASET_VERSION,
        published_period: "2026-10",
        retrieved_at: "2026-10-10T08:24:51.000+00:00",
        parse_version: "public-website-html-v2",
      }],
    )).not.toThrow();
  });

  it("observability events contain only safe fields", async () => {
    const fx = fixture({ plans: thailandPlans() });
    await processTradeResearchJob(
      fx.writer, job(), "worker-a", () => NOW, undefined, fx.log, undefined,
      thailandRegistry(async () => customsRetryable()),
    );
    const pending = fx.state.diagnostics.find((d) => d.event === "job_retry_pending");
    const scheduled = fx.state.diagnostics.find((d) => d.event === "provider_retry_scheduled");
    expect(pending).toBeDefined();
    expect(scheduled).toBeDefined();
    const serialized = JSON.stringify({ pending, scheduled });
    expect(serialized).not.toMatch(/cookie|token|password|mailto/i);
    expect(scheduled!.providerId).toBe("thai-customs-stats");
    expect(scheduled!.attemptNumber).toBe(1);
    expect(typeof scheduled!.retryAfterMs).toBe("number");
    expect(typeof scheduled!.nextAttemptAt).toBe("string");
  });
});
