import "server-only";

import { isRetryableProviderFailure, retryDelayMs } from "../stateMachine";
import { aggregateTradeResearchEvidence } from "../aggregation";
import { readProviderResultCheckpoint } from "../checkpoints";
import {
  providerExecutionStatusForPlan,
  unevaluatedProviderOutcome,
  type ProviderOutcomeAttempt,
  type ProviderOutcomePlan,
} from "../providerOutcomes";
import {
  AUTOMATIC_SPEND_RUPEES, PHASE_2A_STAGES,
  TRADE_RESEARCH_INTERPRETATION_VERSION,
  TRADE_RESEARCH_PLANNER_VERSION,
  type Phase2AStage,
  type ResearchContext,
  type TradeResearchAggregateSummary,
  type TradeResearchProviderResult,
  type TradeResearchResultSummary,
  type TradeResearchSourceEvidence,
} from "../types";
import {
  isTradeResearchLeaseLostError,
  TradeResearchWriter,
  type InternalJobRow,
} from "../repository";
import {
  safeTradeResearchErrorCode,
  safeTradeResearchErrorMetadata,
  type TradeResearchDiagnostic,
  type TradeResearchLogger,
} from "./diagnostics";
import {
  DEFAULT_TRADE_RESEARCH_PROVIDER_REGISTRY,
  PROVIDER_MATCH_BUDGET_MS,
  parserFailureCode,
  type ProviderDeadline,
  type ProviderExecutionResult,
  type TradeResearchProviderPlan,
  type TradeResearchProviderRegistry,
} from "./providerExecutors";

const LEASE_HEARTBEAT_MS = 15_000;

/**
 * BI4F 2A hard-deadline checkpointing. `deadlineAt` is an absolute epoch
 * millisecond wall the WORKER voluntarily respects — BEFORE each
 * expensive stage it checks whether the remaining wall time is safely
 * above `WORKER_CLEANUP_RESERVE_MS`. If not, it releases the lease with
 * a short `next_attempt_at`, logs `job_checkpointed_runtime_budget`, and
 * returns `"retry"` so the next drain iteration (or the daily cron)
 * resumes on the persisted stage + cached FDA snapshot.
 *
 * The reserve is deliberately generous: the checkpoint path still needs
 * to hit `writer.release` + `writer.appendEvent` + return through the
 * drain wrapper + revalidatePath + serialise the response body. Under
 * Vercel Hobby (60 s function ceiling, ~50 s server-action budget) 8 s
 * reserve gives comfortable headroom.
 */
const WORKER_CLEANUP_RESERVE_MS = 8_000;

/**
 * Vercel Hobby's function ceiling. Documented here as a source-of-truth
 * for the derived safe execution budget below. Do NOT depend on this
 * constant from client code — it is only referenced by server-only
 * worker entrypoints.
 */
export const VERCEL_FUNCTION_MAX_MS = 60_000;
/**
 * The safe walltime budget every serverless drain entrypoint hands to
 * the worker via `deadlineAt`. 10 s of headroom under
 * `VERCEL_FUNCTION_MAX_MS` for post-drain revalidatePath / response
 * serialisation / logging. Any drain call that does NOT provide a
 * deadline (unit tests, non-serverless resume paths) is unchanged —
 * the worker still runs; only the pre-FDA / pre-match gates become
 * no-ops.
 */
export const TRADE_RESEARCH_SAFE_EXECUTION_MS = 50_000;

/**
 * Shared helper — the single authoritative way to derive `deadlineAt`
 * for a drain call inside a Vercel serverless function. Every
 * production entrypoint (inline server action, cron, manual /drain)
 * calls this; there is no per-route magic number.
 */
export function createTradeResearchDeadline(startedAt: number = Date.now()): number {
  return startedAt + TRADE_RESEARCH_SAFE_EXECUTION_MS;
}

const PHASE_2A_STAGE_INDEX: ReadonlyMap<Phase2AStage, number> = new Map(
  PHASE_2A_STAGES.map((stage, index) => [stage, index] as const),
);

function stageIndex(stage: InternalJobRow["stage"]): number {
  return PHASE_2A_STAGE_INDEX.get(stage as Phase2AStage) ?? -1;
}

function remainingBudgetMs(deadlineAt: number | undefined): number {
  if (deadlineAt === undefined || !Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

export interface TradeResearchDrainResult {
  jobsRequested: number;
  claimed: number;
  processed: number;
  completed: number;
  requeued: number;
  failed: number;
  noWork: boolean;
  durationMs: number;
  automaticSpendRupees: 0;
}

export class TradeResearchDrainExecutionError extends Error {
  constructor(
    readonly safeErrorCode: string,
    readonly result: TradeResearchDrainResult,
  ) {
    super("Trade research drain failed.");
    this.name = "TradeResearchDrainExecutionError";
  }
}

interface WorkerDependencies {
  writer: TradeResearchWriter;
  workerId: string;
  maxJobs?: number;
  timeBudgetMs?: number;
  /**
   * Absolute epoch-millisecond deadline BEYOND which the worker refuses
   * to start expensive stages (FDA fetch, matching, finalize) and
   * instead checkpoints via `writer.release(...)` so the next drain
   * resumes on persisted state / the FDA snapshot. Optional; when
   * omitted the worker has no wall-time awareness (safe for tests and
   * for the daily cron where the platform ceiling is per-function).
   */
  deadlineAt?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  log?: TradeResearchLogger;
}

function jobDiagnostic(event: TradeResearchDiagnostic["event"], job: InternalJobRow, extra: Partial<TradeResearchDiagnostic> = {}): TradeResearchDiagnostic {
  return {
    event, jobId: job.id, batchId: job.batch_id, candidateId: job.candidate_id,
    status: job.status, stage: job.stage, revision: job.revision, ...extra,
  };
}

async function advanceStage(
  writer: TradeResearchWriter,
  job: InternalJobRow,
  workerId: string,
  stage: InternalJobRow["stage"],
  log?: TradeResearchLogger,
): Promise<InternalJobRow> {
  // Resume-idempotent: if the target stage has already been reached in
  // a prior partial execution, skip the DB round-trip. This is what makes
  // a checkpointed job safely resumable — the second invocation replays
  // the whole `processTradeResearchJob` from the top, but each already-
  // completed stage advance is a no-op.
  const from = stageIndex(job.stage);
  const to = stageIndex(stage);
  if (from >= 0 && to >= 0 && from >= to) return job;
  const previousStage = job.stage;
  const advanced = await writer.advance(job, workerId, stage);
  log?.(jobDiagnostic("stage_completed", advanced, { stage: previousStage }));
  log?.(jobDiagnostic("stage_started", advanced));
  return advanced;
}

interface CheckpointDecision {
  ok: boolean;
  remainingMs: number;
  job: InternalJobRow;
}

/**
 * Voluntary checkpoint gate. Returns `{ ok: true }` when enough safe
 * wall time remains to attempt the requested-cost operation. Returns
 * `{ ok: false }` (and RELEASES the lease with a short next_attempt_at)
 * when we're too close to the platform kill. The caller MUST return
 * "retry" immediately after `ok: false` — do NOT keep working.
 */
async function checkpointIfBudgetLow(
  writer: TradeResearchWriter,
  job: InternalJobRow,
  workerId: string,
  deadlineAt: number | undefined,
  requiredMs: number,
  now: () => Date,
  log?: TradeResearchLogger,
): Promise<CheckpointDecision> {
  const remaining = remainingBudgetMs(deadlineAt);
  if (remaining >= requiredMs + WORKER_CLEANUP_RESERVE_MS) {
    return { ok: true, remainingMs: remaining, job };
  }
  // Release lease with a very short retry window so the next drain
  // (inline follow-up or daily cron) reclaims almost immediately.
  const nextAttemptAt = new Date(now().getTime() + 2_000).toISOString();
  const releasedJob = await writer.release(job, workerId, nextAttemptAt);
  log?.({
    event: "job_checkpointed_runtime_budget",
    jobId: releasedJob.id, batchId: releasedJob.batch_id, candidateId: releasedJob.candidate_id,
    stage: releasedJob.stage, remainingMs: remaining, elapsedMs: 0,
  });
  return { ok: false, remainingMs: remaining, job: releasedJob };
}

function blankResult(): TradeResearchResultSummary {
  return {
    officialProgramEvidence: "not_checked", productEvidence: "not_available",
    indiaOrigin: "not_verified", originEvidence: "not_available",
    shipmentEvidence: "not_verified", sourcesChecked: 0,
    automaticSpendRupees: AUTOMATIC_SPEND_RUPEES,
  };
}

function completeProvisionalProviderResults(
  plans: readonly Record<string, unknown>[],
  results: readonly TradeResearchProviderResult[],
): TradeResearchProviderResult[] {
  const byProvider = new Map(results.map((result) => [result.providerId, result]));
  return plans.map((plan, index) => {
    const providerId = String(plan.provider_id ?? "");
    return byProvider.get(providerId) ?? unevaluatedProviderOutcome(normalizeProviderPlan(plan, index), "not_started", null);
  });
}

interface DurableProviderProgress {
  attemptsByPlanId: Map<string, Record<string, unknown> | undefined>;
  resolvedResults: TradeResearchProviderResult[];
  allResolved: boolean;
}

function normalizeProviderPlan(plan: Record<string, unknown>, index: number): ProviderOutcomePlan {
  return {
    id: String(plan.id ?? ""),
    provider_id: String(plan.provider_id ?? ""),
    sequence: Number(plan.sequence ?? index + 1),
    eligibility: plan.eligibility === "ineligible" ? "ineligible" : "eligible",
    decision_reason: String(plan.decision_reason ?? "eligible"),
    dataset_version: typeof plan.dataset_version === "string" ? plan.dataset_version : null,
  };
}

async function loadDurableProviderProgress(
  writer: TradeResearchWriter,
  plans: readonly Record<string, unknown>[],
  jobCancelled: boolean,
): Promise<DurableProviderProgress> {
  const attemptsByPlanId = new Map<string, Record<string, unknown> | undefined>();
  const resolvedResults: TradeResearchProviderResult[] = [];
  let allResolved = true;

  for (const [index, rawPlan] of plans.entries()) {
    const plan = normalizeProviderPlan(rawPlan, index);
    const attempt = plan.eligibility === "eligible"
      ? await writer.latestAttempt(plan.id)
      : undefined;
    attemptsByPlanId.set(plan.id, attempt);
    const checkpoint = readProviderResultCheckpoint(attempt, plan.provider_id);
    if (checkpoint) {
      resolvedResults.push(checkpoint);
      continue;
    }
    const status = providerExecutionStatusForPlan(
      plan,
      attempt as ProviderOutcomeAttempt | undefined,
      jobCancelled,
    );
    if (["failed_terminal", "unsupported", "blocked", "cancelled"].includes(status)) {
      resolvedResults.push(unevaluatedProviderOutcome(
        plan,
        status as "failed_terminal" | "unsupported" | "blocked" | "cancelled",
        typeof attempt?.safe_error_code === "string" ? attempt.safe_error_code : null,
      ));
      continue;
    }
    // The schema caps attempts at three. A historical/reconciled retryable
    // third attempt is resolved for this job invocation so resume cannot
    // attempt an invalid #4 forever. Newly executed third attempts are
    // written as failed_terminal below when retryDelayMs(3) is null.
    const isRuntimeBudgetCheckpoint = attempt?.safe_error_code === "CID_RUNTIME_BUDGET_CHECKPOINT"
      || attempt?.safe_error_code === "RUNTIME_BUDGET_CHECKPOINT";
    if (!isRuntimeBudgetCheckpoint
        && status === "failed_retryable"
        && Number(attempt?.attempt_number ?? 0) >= 3
        && retryDelayMs(Number(attempt?.attempt_number)) === null) {
      resolvedResults.push(unevaluatedProviderOutcome(
        plan,
        "failed_retryable",
        typeof attempt?.safe_error_code === "string" ? attempt.safe_error_code : null,
      ));
      continue;
    }
    allResolved = false;
  }
  return { attemptsByPlanId, resolvedResults, allResolved };
}

function resultFromProviderResults(
  providerResults: readonly TradeResearchProviderResult[],
  sources: readonly TradeResearchSourceEvidence[] = [],
  includeSources = true,
): TradeResearchResultSummary {
  const aggregate = aggregateTradeResearchEvidence(providerResults);
  const officialProgramEvidence: TradeResearchResultSummary["officialProgramEvidence"] =
    aggregate.programSummary.state === "verified" ? "verified" :
    ["supporting", "needs_review", "conflicting"].includes(aggregate.programSummary.state) ? "needs_review" :
    aggregate.programSummary.state === "no_verified_match" ? "no_verified_match" :
    aggregate.productSummary.state !== "not_available" && aggregate.productSummary.state !== "not_evaluated"
      ? aggregate.identitySummary.state === "verified" ? "verified"
        : aggregate.identitySummary.state === "needs_review" ? "needs_review"
          : aggregate.identitySummary.state === "no_verified_match" || aggregate.identitySummary.state === "conflicting" ? "no_verified_match"
            : "not_checked"
      : "not_checked";
  const productEvidence: TradeResearchResultSummary["productEvidence"] =
    aggregate.productSummary.state === "verified" ? "verified" :
    ["supporting", "needs_review"].includes(aggregate.productSummary.state) ? "supporting" :
    aggregate.productSummary.state === "no_verified_match" ? "no_verified_match" : "not_available";
  const originEvidence: TradeResearchResultSummary["originEvidence"] =
    aggregate.originSummary.state === "verified" ? "verified" :
    ["supporting", "needs_review"].includes(aggregate.originSummary.state) ? "supporting" :
    aggregate.originSummary.state === "no_verified_match" ? "no_verified_match" :
    aggregate.originSummary.state === "not_verified" ? "not_verified" : "not_available";
  const indiaOrigin: TradeResearchResultSummary["indiaOrigin"] =
    aggregate.indiaOriginSummary.state === "verified" ? "verified" :
    ["supporting", "needs_review"].includes(aggregate.indiaOriginSummary.state) ? "supporting" : "not_verified";
  const primary = sources[0];
  return {
    ...blankResult(),
    officialProgramEvidence,
    productEvidence,
    originEvidence,
    indiaOrigin,
    sourcesChecked: aggregate.coverageCounts.evaluated,
    evidence: primary ? {
      source: primary.source, datasetPeriod: primary.datasetPeriod, retrievedAt: primary.retrievedAt,
      matchedSourceName: primary.matchedSourceName, matchedState: primary.matchedState,
      candidateName: primary.candidateName, candidateState: primary.candidateState,
      identityDecision: primary.identityDecision, matchReason: primary.matchReason,
      coverageExplanation: primary.coverageExplanation,
    } : undefined,
    sources: includeSources && sources.length > 0 ? [...sources] : undefined,
    aggregate,
    providerResults: [...providerResults],
  };
}

async function finalizeResolvedProviderResults(
  writer: TradeResearchWriter,
  initialJob: InternalJobRow,
  workerId: string,
  providerResults: readonly TradeResearchProviderResult[],
  log?: TradeResearchLogger,
): Promise<"completed" | "failed"> {
  let job = await advanceStage(writer, initialJob, workerId, "finalizing", log);
  let processingOutcome: "completed" | "failed" = "completed";
  const result = resultFromProviderResults(providerResults);
  const aggregate = aggregateTradeResearchEvidence(providerResults);
  if (aggregate.identitySummary.state === "conflicting" || aggregate.identitySummary.state === "needs_review") {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else if (aggregate.programSummary.state === "verified") {
    const incomplete = aggregate.coverageCounts.failed > 0 || aggregate.coverageCounts.blocked > 0
      || aggregate.coverageCounts.notStarted > 0;
    job = await writer.finalize(
      job, workerId,
      incomplete ? "partial" : "completed",
      incomplete ? "partial" : "official_importer_program_corroboration",
      result,
    );
  } else if (aggregate.programSummary.state === "supporting" || aggregate.programSummary.state === "needs_review") {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else if (aggregate.coverageCounts.evaluated === 0 && aggregate.coverageCounts.failed > 0) {
    job = await writer.finalize(job, workerId, "failed", "failed", result);
    processingOutcome = "failed";
  } else if (aggregate.coverageCounts.evaluated === 0) {
    job = await writer.finalize(job, workerId, "completed", "unsupported_coverage", result);
  } else {
    job = await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return processingOutcome;
}

async function refreshOwnedJob(
  writer: TradeResearchWriter,
  job: InternalJobRow,
  workerId: string,
): Promise<InternalJobRow> {
  // Structural worker fakes from earlier phases do not expose the read helper;
  // production TradeResearchWriter always does. The fallback preserves those
  // isolated tests while the real worker adopts cancellation's revised row.
  if (typeof writer.refreshOwnedJob !== "function") return job;
  return writer.refreshOwnedJob(job.id, workerId);
}

async function withHeartbeat<T>(
  writer: TradeResearchWriter,
  initialJob: InternalJobRow,
  workerId: string,
  work: () => Promise<T>,
  adopt: (job: InternalJobRow) => void,
): Promise<{ value: T; job: InternalJobRow }> {
  let job = initialJob;
  if (typeof writer.heartbeat !== "function") {
    return { value: await work(), job };
  }
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      const authoritative = await writer.heartbeat(job, workerId);
      if (authoritative) {
        job = authoritative;
        adopt(job);
      }
    });
  }, LEASE_HEARTBEAT_MS);
  let value!: T;
  let workFailed = false;
  let workError: unknown;
  try {
    value = await work();
  } catch (error) {
    workFailed = true;
    workError = error;
  } finally {
    clearInterval(timer);
    await pending;
    // A final CAS heartbeat closes the event-loop starvation window: even
    // if parsing blocked every interval callback past lease expiry, the
    // worker proves it still owns the current revision before mutating an
    // attempt, releasing, advancing, or finalizing.
    const authoritative = await writer.heartbeat(job, workerId);
    if (authoritative) {
      job = authoritative;
      adopt(job);
    }
  }
  if (workFailed) throw workError;
  return { value, job };
}

export async function processTradeResearchJob(
  writer: TradeResearchWriter,
  claimed: InternalJobRow,
  workerId: string,
  now: () => Date,
  fetchImpl?: typeof fetch,
  log?: TradeResearchLogger,
  deadlineAt?: number,
  registry: TradeResearchProviderRegistry = DEFAULT_TRADE_RESEARCH_PROVIDER_REGISTRY,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimed;
  log?.(jobDiagnostic("stage_started", job));
  const cancellationRequested = await writer.isCancellationRequested(job.batch_id);
  if (!cancellationRequested) {
    job = await advanceStage(writer, job, workerId, "planning_sources", log);
  }
  const loadedPlans = typeof writer.getProviderPlans === "function"
    ? await writer.getProviderPlans(job.id)
    : typeof writer.getEligiblePlans === "function"
      ? await writer.getEligiblePlans(job.id)
    : await (async () => { const p = await writer.getEligiblePlan(job.id); return p ? [p] : []; })();
  const allPlans = [...loadedPlans].sort((a, b) =>
    Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
    || String(a.provider_id ?? "").localeCompare(String(b.provider_id ?? "")),
  );
  const plans = allPlans.filter((plan) => plan.eligibility !== "ineligible");
  if (cancellationRequested) {
    job = await refreshOwnedJob(writer, job, workerId);
    const progress = await loadDurableProviderProgress(writer, allPlans, true);
    const providerResults = completeProvisionalProviderResults(allPlans, progress.resolvedResults)
      .map((result) => result.execution.status === "not_started"
        ? { ...result, execution: { status: "cancelled" as const, safeErrorCode: null } }
        : result);
    job = await writer.finalize(
      job, workerId, "cancelled", "cancelled",
      resultFromProviderResults(providerResults),
    );
    return "completed";
  }
  if (!allPlans.length) {
    job = await advanceStage(writer, job, workerId, "finalizing", log);
    job = await writer.finalize(job, workerId, "completed", "unsupported_coverage", blankResult());
    log?.(jobDiagnostic("stage_completed", job));
    return "completed";
  }
  // Every eligible plan must respect the ₹0 contract independently.
  for (const p of plans) {
    if (Number((p as { automatic_spend_rupees?: unknown }).automatic_spend_rupees) !== 0
        || (p as { cost_class?: unknown }).cost_class !== "free") {
      throw new Error("PROVIDER_COST_POLICY_VIOLATION");
    }
  }
  if (await writer.isCancellationRequested(job.batch_id)) {
    job = await refreshOwnedJob(writer, job, workerId);
    const progress = await loadDurableProviderProgress(writer, allPlans, true);
    const providerResults = completeProvisionalProviderResults(allPlans, progress.resolvedResults)
      .map((result) => result.execution.status === "not_started"
        ? { ...result, execution: { status: "cancelled" as const, safeErrorCode: null } }
        : result);
    job = await writer.finalize(job, workerId, "cancelled", "cancelled", resultFromProviderResults(providerResults));
    return "completed";
  }
  const progress = await loadDurableProviderProgress(writer, allPlans, false);
  if (progress.allResolved) {
    return finalizeResolvedProviderResults(writer, job, workerId, progress.resolvedResults, log);
  }
  job = await advanceStage(writer, job, workerId, "screening_sources", log);
  return processProviderPlans(
    writer, job, workerId, allPlans, plans, progress, now, fetchImpl, log, deadlineAt, registry,
  );
}

const SAFE_PROVIDER_ERROR_CODES = new Set([
  "HTTP_ERROR", "TRANSIENT_HTTP", "NETWORK_TIMEOUT", "CONNECTION_RESET",
  "PARSER_INCOMPATIBLE", "PARSER_INVALID_SCHEMA", "SOURCE_UNAVAILABLE",
  "UNSUPPORTED_PRODUCT_MAPPING", "CID_RUNTIME_BUDGET_CHECKPOINT",
  "CID_RUNTIME_BUDGET_EXHAUSTED", "PROVIDER_FAILURE",
]);

function immutableResearchContext(job: InternalJobRow): Readonly<ResearchContext> {
  const context = job.research_context ?? {
    // Legacy pre-T07 rows/tests have no persisted context. This compatibility
    // value uses only immutable job-owned columns; adapters never read product,
    // market, form, or goal from Candidate rows.
    workspaceId: job.workspace_id,
    candidateId: job.candidate_id,
    marketCountryCode: job.country_code,
    productId: job.product_id ?? "unknown",
    productForm: null,
    researchGoal: "screen_trade_activity" as const,
    providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
  };
  return Object.freeze({ ...context });
}

function providerDeadline(deadlineAt: number | undefined): ProviderDeadline {
  return Object.freeze({
    deadlineAt,
    remainingMs: () => remainingBudgetMs(deadlineAt),
    canStart: (requiredMs: number) => remainingBudgetMs(deadlineAt) >= requiredMs + WORKER_CLEANUP_RESERVE_MS,
  });
}

function normalizedProviderFailure(error: unknown, attemptNumber: number): Extract<ProviderExecutionResult, { status: "failed_retryable" | "failed_terminal" }> {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status?: unknown }).status) : undefined;
  const rawCode = parserFailureCode(error) ?? (typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "") : "");
  const safeErrorCode = SAFE_PROVIDER_ERROR_CODES.has(rawCode)
    ? rawCode
    : status === 429 || (status !== undefined && status >= 500)
      ? "TRANSIENT_HTTP"
      : status !== undefined
        ? "HTTP_ERROR"
        : "PROVIDER_FAILURE";
  const retryable = safeErrorCode === "CID_RUNTIME_BUDGET_CHECKPOINT"
    || safeErrorCode === "CID_RUNTIME_BUDGET_EXHAUSTED"
    || isRetryableProviderFailure({ status, code: safeErrorCode });
  return {
    status: retryable && retryDelayMs(attemptNumber) !== null ? "failed_retryable" : "failed_terminal",
    safeErrorCode,
    retryable,
  };
}

function attemptStateFor(result: Extract<ProviderExecutionResult, { providerResult: TradeResearchProviderResult }>): "completed" | "completed_no_match" | "skipped_cached" {
  if (result.status === "cached") return "skipped_cached";
  if (result.status === "no_match") return "completed_no_match";
  return "completed";
}

async function finalizeGenericResults(
  writer: TradeResearchWriter,
  initialJob: InternalJobRow,
  workerId: string,
  providerResults: readonly TradeResearchProviderResult[],
  sources: readonly TradeResearchSourceEvidence[],
  eligibleCount: number,
  log?: TradeResearchLogger,
): Promise<"completed" | "failed"> {
  let job = await advanceStage(writer, initialJob, workerId, "finalizing", log);
  const result = resultFromProviderResults(providerResults, sources, eligibleCount > 1);
  const aggregate = aggregateTradeResearchEvidence(providerResults);
  let processingOutcome: "completed" | "failed" = "completed";
  if (aggregate.identitySummary.state === "conflicting" || aggregate.identitySummary.state === "needs_review") {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else if (aggregate.programSummary.state === "verified"
      || (aggregate.identitySummary.state === "verified" && aggregate.productSummary.state === "verified")) {
    const incomplete = aggregate.coverageCounts.failed > 0 || aggregate.coverageCounts.blocked > 0
      || aggregate.coverageCounts.notStarted > 0;
    job = await writer.finalize(job, workerId, incomplete ? "partial" : "completed", incomplete ? "partial" : "official_importer_program_corroboration", result);
  } else if (aggregate.programSummary.state === "supporting" || aggregate.programSummary.state === "needs_review"
      || (aggregate.identitySummary.state === "verified" && aggregate.productSummary.state === "supporting")) {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else if (aggregate.coverageCounts.evaluated === 0 && aggregate.coverageCounts.failed > 0) {
    job = await writer.finalize(job, workerId, "failed", "failed", result);
    processingOutcome = "failed";
  } else if (aggregate.coverageCounts.evaluated === 0) {
    job = await writer.finalize(job, workerId, "completed", "unsupported_coverage", result);
  } else {
    job = await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return processingOutcome;
}

/**
 * T11 provider-count-independent orchestration. Provider IDs are data here:
 * the registry supplies all source-specific behavior.
 */
async function processProviderPlans(
  writer: TradeResearchWriter,
  claimedJob: InternalJobRow,
  workerId: string,
  allPlans: readonly Record<string, unknown>[],
  eligiblePlans: readonly Record<string, unknown>[],
  initialProgress: DurableProviderProgress,
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
  deadlineAt: number | undefined,
  registry: TradeResearchProviderRegistry,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimedJob;
  const context = immutableResearchContext(job);
  const results = new Map(initialProgress.resolvedResults.map((result) => [result.providerId, result]));
  const sources: TradeResearchSourceEvidence[] = [];
  const deadline = providerDeadline(deadlineAt);

  for (const rawPlan of eligiblePlans) {
    const plan: TradeResearchProviderPlan = {
      ...rawPlan,
      id: String(rawPlan.id ?? ""),
      provider_id: String(rawPlan.provider_id ?? ""),
    };
    const providerId = plan.provider_id;
    let previous = initialProgress.attemptsByPlanId.get(plan.id);
    const checkpoint = readProviderResultCheckpoint(previous, providerId);
    if (checkpoint) {
      results.set(providerId, checkpoint);
      continue;
    }
    if (previous?.state === "failed_terminal") continue;

    if (await writer.isCancellationRequested(job.batch_id)) {
      job = await refreshOwnedJob(writer, job, workerId);
      const durable = await loadDurableProviderProgress(writer, allPlans, true);
      const cancelled = completeProvisionalProviderResults(allPlans, durable.resolvedResults)
        .map((result) => result.execution.status === "not_started"
          ? { ...result, execution: { status: "cancelled" as const, safeErrorCode: null } }
          : result);
      await writer.finalize(job, workerId, "cancelled", "cancelled", resultFromProviderResults(cancelled, sources, eligiblePlans.length > 1));
      return "completed";
    }

    if (previous?.state === "running" && previous.id) {
      await writer.reconcileStaleAttempt(job, workerId, String(previous.id), "STALE_LEASE_RECOVERED");
      previous = { ...previous, state: "failed_retryable" };
    }
    const legacyResolved = previous?.state === "completed"
      || previous?.state === "completed_no_match"
      || previous?.state === "skipped_cached";
    const attemptNumber = legacyResolved
      ? Number(previous?.attempt_number ?? 1)
      : Number(previous?.attempt_number ?? 0) + 1;
    if (attemptNumber > 3) {
      const exhaustedCode = previous?.safe_error_code === "CID_RUNTIME_BUDGET_CHECKPOINT"
        ? "CID_RUNTIME_BUDGET_EXHAUSTED"
        : "PROVIDER_RETRY_EXHAUSTED";
      results.set(providerId, unevaluatedProviderOutcome(normalizeProviderPlan(rawPlan, 0), "failed_terminal", exhaustedCode));
      continue;
    }

    const executor = registry.resolve(providerId);
    const freshSnapshot = executor ? await executor.hasFreshSnapshot({ writer, now }) : false;
    if (executor && !freshSnapshot && !legacyResolved) {
      const gate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, executor.requiredStartBudgetMs, now, log);
      if (!gate.ok) return "retry";
    }

    const attempt = legacyResolved
      ? previous as { id: string | number }
      : await writer.startAttempt(job, plan.id, attemptNumber, workerId);
    if (!legacyResolved) {
      await writer.appendEvent(job, "provider_attempt_started", { providerId, attempt: attemptNumber });
    }
    const started = Date.now();
    if (executor && !legacyResolved && !deadline.canStart(PROVIDER_MATCH_BUDGET_MS)) {
        await writer.finishAttempt(job, workerId, String(attempt.id), {
          state: "retry_wait", safe_error_code: "RUNTIME_BUDGET_CHECKPOINT", duration_ms: Date.now() - started,
        });
        await writer.appendEvent(job, "provider_attempt_completed", { providerId, attempt: attemptNumber, state: "retry_wait" });
        const remaining = deadline.remainingMs();
        job = await writer.release(job, workerId, new Date(now().getTime() + 2_000).toISOString());
        log?.(jobDiagnostic("job_checkpointed_runtime_budget", job, { remainingMs: remaining, elapsedMs: 0 }));
        return "retry";
    }
    let execution: ProviderExecutionResult;
    if (!executor) {
      execution = { status: "failed_terminal", safeErrorCode: "UNKNOWN_PROVIDER", retryable: false };
    } else {
      try {
        const heartbeat = await withHeartbeat(
          writer,
          job,
          workerId,
          () => executor.execute({
            context, plan, attempt: { attemptId: String(attempt.id), attemptNumber, previousState: typeof previous?.state === "string" ? previous.state : null },
            deadline, checkpointState: { previousAttempt: previous }, writer, job, now, fetchImpl,
          }),
          (authoritativeJob) => { job = authoritativeJob; },
        );
        job = heartbeat.job;
        execution = heartbeat.value;
      } catch (error) {
        if (isTradeResearchLeaseLostError(error)) throw error;
        const errorCode = typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "") : "";
        // Repository/PostgREST failures belong to the drain recovery boundary;
        // treating them as provider failures would hide authorization or CAS
        // faults and could continue with a stale lease.
        if (/^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(errorCode)
            && !SAFE_PROVIDER_ERROR_CODES.has(errorCode)) throw error;
        execution = normalizedProviderFailure(error, attemptNumber);
      }
    }

    if (legacyResolved && (execution.status === "completed" || execution.status === "no_match" || execution.status === "cached")) {
      const status = previous?.state === "completed_no_match" ? "no_match" as const
        : previous?.state === "skipped_cached" ? "cached" as const : "completed" as const;
      execution = {
        ...execution,
        status,
        providerResult: { ...execution.providerResult, execution: { status, safeErrorCode: null } } as TradeResearchProviderResult,
      };
    }

    if (!legacyResolved
        && (execution.status === "completed" || execution.status === "no_match" || execution.status === "cached")
        && !deadline.canStart(PROVIDER_MATCH_BUDGET_MS)) {
      await writer.finishAttempt(job, workerId, String(attempt.id), {
        state: "retry_wait", safe_error_code: "RUNTIME_BUDGET_CHECKPOINT", duration_ms: Date.now() - started,
      });
      await writer.appendEvent(job, "provider_attempt_completed", { providerId, attempt: attemptNumber, state: "retry_wait" });
      const remaining = deadline.remainingMs();
      job = await writer.release(job, workerId, new Date(now().getTime() + 2_000).toISOString());
      log?.(jobDiagnostic("job_checkpointed_runtime_budget", job, { remainingMs: remaining, elapsedMs: 0 }));
      return "retry";
    }

    if (execution.status === "completed" || execution.status === "no_match" || execution.status === "cached") {
      job = await advanceStage(writer, job, workerId, "resolving_company_matches", log);
      await writer.appendEvent(job, "match_resolved", {
        providerId, identityResult: execution.sourceEvidence.identityDecision,
        matchCount: execution.matchCount, datasetWatermark: execution.providerResult.datasetVersion,
      });
      job = await advanceStage(writer, job, workerId, "checking_trade_activity", log);
      if (!legacyResolved) {
        const state = attemptStateFor(execution);
        await writer.finishAttemptWithCheckpoint(job, workerId, String(attempt.id), {
          state, duration_ms: Date.now() - started,
          record_count: execution.recordCount, match_count: execution.matchCount,
        }, execution.providerResult);
        await writer.appendEvent(job, "provider_attempt_completed", { providerId, attempt: attemptNumber, state, recordCount: execution.recordCount, matchCount: execution.matchCount });
      }
      results.set(providerId, execution.providerResult);
      sources.push(execution.sourceEvidence);
      continue;
    }

    if (!("safeErrorCode" in execution)) throw new Error("INVALID_PROVIDER_EXECUTION_RESULT");
    const retryDelay = execution.retryable ? retryDelayMs(attemptNumber) : null;
    const failureState = retryDelay !== null && eligiblePlans.length === 1 ? "retry_wait"
      : execution.status;
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: failureState,
      safe_error_code: execution.safeErrorCode,
      duration_ms: Date.now() - started,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId, attempt: attemptNumber, state: failureState });
    const failureResult = unevaluatedProviderOutcome(normalizeProviderPlan(rawPlan, 0), execution.status, execution.safeErrorCode);
    results.set(providerId, failureResult);
    log?.(jobDiagnostic("job_failed", job, { safeErrorCode: execution.safeErrorCode }));
    if (retryDelay !== null && eligiblePlans.length === 1) {
      job = await writer.release(job, workerId, new Date(now().getTime() + retryDelay).toISOString());
      log?.(jobDiagnostic("job_requeued", job, { leaseState: "released", safeErrorCode: execution.safeErrorCode }));
      return "retry";
    }
  }

  const providerResults = completeProvisionalProviderResults(allPlans, [...results.values()]);
  if (providerResults.length === 1
      && providerResults[0]?.execution.status === "failed_terminal"
      && providerResults[0].execution.safeErrorCode === "UNSUPPORTED_PRODUCT_MAPPING") {
    job = await advanceStage(writer, job, workerId, "finalizing", log);
    await writer.finalize(job, workerId, "completed", "unsupported_coverage", resultFromProviderResults(providerResults));
    return "completed";
  }
  return finalizeGenericResults(writer, job, workerId, providerResults, sources, eligiblePlans.length, log);
}

/**
 * BI4F 2C — deterministic aggregation. Per-source facts are NEVER
 * overwritten. Aggregate identity is derived conservatively:
 *   • ≥2 sources verified & no geography conflict → verified_identity
 *   • 1 source verified, others no_match/supporting → single_source_support
 *   • ≥2 sources supporting → multi_source_support
 *   • Verified sources with conflicting matched-state → conflicting_evidence
 *   • Only no_match across all sources → no_evidence
 *   • Any supporting-only combo → needs_review
 */
export function aggregateProviderEvidence(sources: readonly TradeResearchSourceEvidence[]): TradeResearchAggregateSummary {
  const evaluated = sources.filter((s) => s.outcome === "completed" || s.outcome === "cache_hit" || s.outcome === "no_match");
  const sourcesEvaluated = evaluated.length;
  const verifiedSources = sources.filter((s) => s.companyEvidence === "verified");
  const supportingSources = sources.filter((s) => s.companyEvidence === "supporting");
  const noMatchSources = sources.filter((s) => s.companyEvidence === "no_verified_match");

  // Conflict check: verified rows disagree on matchedState.
  const verifiedStates = new Set(verifiedSources.map((s) => s.matchedState).filter((s): s is string => Boolean(s)));
  if (verifiedSources.length >= 2 && verifiedStates.size >= 2) {
    return {
      identity: "conflicting_evidence",
      reason: "Multiple providers verified identity but reported conflicting geography — flagged for review.",
      sourcesEvaluated, sourcesCorroborating: verifiedSources.length,
    };
  }
  if (verifiedSources.length >= 2) {
    return {
      identity: "verified_identity",
      reason: "Multiple official sources independently verified company identity.",
      sourcesEvaluated, sourcesCorroborating: verifiedSources.length,
    };
  }
  if (verifiedSources.length === 1 && (supportingSources.length + noMatchSources.length) > 0) {
    return {
      identity: "single_source_support",
      reason: "One official source verified identity; other providers did not corroborate.",
      sourcesEvaluated, sourcesCorroborating: 1,
    };
  }
  if (verifiedSources.length === 1) {
    return {
      identity: "single_source_support",
      reason: "One official source verified identity.",
      sourcesEvaluated, sourcesCorroborating: 1,
    };
  }
  if (supportingSources.length >= 2) {
    return {
      identity: "multi_source_support",
      reason: "Two or more sources matched by name only; identity requires review.",
      sourcesEvaluated, sourcesCorroborating: supportingSources.length,
    };
  }
  if (supportingSources.length === 1) {
    return {
      identity: "needs_review",
      reason: "One source matched by name only; identity requires review.",
      sourcesEvaluated, sourcesCorroborating: 1,
    };
  }
  if (noMatchSources.length > 0) {
    return {
      identity: "no_evidence",
      reason: "No official source verified identity in the checked datasets. This is not evidence that the company does not import.",
      sourcesEvaluated, sourcesCorroborating: 0,
    };
  }
  return {
    identity: "no_evidence",
    reason: "No provider produced evaluated evidence.",
    sourcesEvaluated, sourcesCorroborating: 0,
  };
}

export async function drainTradeResearch(deps: WorkerDependencies): Promise<TradeResearchDrainResult> {
  const maxJobs = Math.max(1, Math.min(2, deps.maxJobs ?? 2));
  const budget = Math.max(5_000, Math.min(50_000, deps.timeBudgetMs ?? 45_000));
  const started = Date.now();
  const result: TradeResearchDrainResult = {
    jobsRequested: maxJobs, claimed: 0, processed: 0, completed: 0, requeued: 0,
    failed: 0, noWork: true, durationMs: 0, automaticSpendRupees: 0,
  };
  deps.log?.({ event: "drain_started", jobsRequested: maxJobs });
  deps.log?.({ event: "jobs_requested", jobsRequested: maxJobs });
  while (result.claimed < maxJobs && Date.now() - started < budget) {
    let job: InternalJobRow | undefined;
    try {
      job = await deps.writer.claim(deps.workerId);
    } catch (error) {
      const safeErrorCode = safeTradeResearchErrorCode(error);
      const safeMetadata = safeTradeResearchErrorMetadata(error);
      result.durationMs = Date.now() - started;
      result.noWork = false;
      deps.log?.({ event: "claim_rejected", jobsClaimed: result.claimed, durationMs: result.durationMs, safeErrorCode, ...safeMetadata });
      deps.log?.({ event: "drain_finished", jobsRequested: maxJobs, jobsClaimed: result.claimed, processed: result.processed, completed: result.completed, requeued: result.requeued, failed: result.failed, noWork: false, durationMs: result.durationMs, safeErrorCode, ...safeMetadata });
      throw new TradeResearchDrainExecutionError(safeErrorCode, result);
    }
    if (!job) {
      deps.log?.({ event: "claim_no_work", jobsClaimed: result.claimed });
      break;
    }
    result.claimed += 1;
    result.noWork = false;
    deps.log?.({ event: "jobs_claimed", jobsClaimed: result.claimed });
    deps.log?.(jobDiagnostic("job_claimed", job, { leaseState: "owned" }));
    try {
      const outcome = await processTradeResearchJob(deps.writer, job, deps.workerId, deps.now ?? (() => new Date()), deps.fetchImpl, deps.log, deps.deadlineAt);
      result.processed += 1;
      if (outcome === "retry") result.requeued += 1;
      else if (outcome === "failed") result.failed += 1;
      else result.completed += 1;
    } catch (error) {
      const safeErrorCode = safeTradeResearchErrorCode(error);
      const safeMetadata = safeTradeResearchErrorMetadata(error);
      if (isTradeResearchLeaseLostError(error)) {
        deps.log?.(jobDiagnostic("job_failed", job, {
          leaseState: "lost", safeErrorCode, ...safeMetadata,
        }));
        // Another worker owns the authoritative revision. Do not reconcile
        // attempts, release, or finalize from this stale execution.
        continue;
      }
      let leaseState: "released" | "lost" = "lost";
      try {
        const recovery = await deps.writer.recoverClaimedJob(
          job.id,
          deps.workerId,
          new Date((deps.now ?? (() => new Date()))().getTime() + 30_000).toISOString(),
          safeErrorCode,
        );
        if (recovery === "requeued") {
          result.requeued += 1;
          leaseState = "released";
          deps.log?.(jobDiagnostic("job_requeued", job, { leaseState, safeErrorCode, ...safeMetadata }));
        } else if (recovery === "cancelled") {
          result.processed += 1;
          result.completed += 1;
          leaseState = "released";
        } else {
          deps.log?.(jobDiagnostic("job_failed", job, { leaseState, safeErrorCode, ...safeMetadata }));
        }
      } catch {
        deps.log?.(jobDiagnostic("job_failed", job, { leaseState, safeErrorCode, ...safeMetadata }));
      }
      result.durationMs = Date.now() - started;
      deps.log?.({ event: "drain_finished", jobsRequested: maxJobs, jobsClaimed: result.claimed, processed: result.processed, completed: result.completed, requeued: result.requeued, failed: result.failed, noWork: false, durationMs: result.durationMs, safeErrorCode, ...safeMetadata });
      throw new TradeResearchDrainExecutionError(safeErrorCode, result);
    }
  }
  result.durationMs = Date.now() - started;
  result.noWork = result.claimed === 0;
  deps.log?.({ event: "drain_finished", jobsRequested: maxJobs, jobsClaimed: result.claimed, processed: result.processed, completed: result.completed, requeued: result.requeued, failed: result.failed, noWork: result.noWork, durationMs: result.durationMs });
  return result;
}
