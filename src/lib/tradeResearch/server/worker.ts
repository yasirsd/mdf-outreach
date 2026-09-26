import "server-only";

import {
  FDA_FSVP_DATASET_ID,
  FDA_FSVP_PARSE_VERSION,
  FDA_FSVP_SOURCE_URL,
  FdaFsvpParserError,
  fetchFdaFsvpDataset,
  matchFdaFsvpCompany,
  parseFdaFsvpXlsx,
  type FdaFsvpFetchResult,
} from "../fdaFsvp";
import { isRetryableProviderFailure, retryDelayMs } from "../stateMachine";
import { AUTOMATIC_SPEND_RUPEES, PHASE_2A_STAGES, type Phase2AStage, type TradeResearchResultSummary } from "../types";
import { TradeResearchWriter, type InternalJobRow, type SnapshotRow } from "../repository";
import { FDA_FSVP_DESCRIPTOR } from "../providers";
import {
  safeTradeResearchErrorCode,
  safeTradeResearchErrorMetadata,
  type TradeResearchDiagnostic,
  type TradeResearchLogger,
} from "./diagnostics";

const LEASE_HEARTBEAT_MS = 15_000;
const FETCH_TIMEOUT_MS = 25_000;

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
 * Conservative estimate of the cold FDA path (fetch + XLSX parse + save
 * snapshot). We refuse to START the FDA fetch if we can't safely fit
 * that plus the cleanup reserve into the remaining wall time.
 */
const FDA_COLD_PATH_WORST_CASE_MS = 25_000;

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
    return { ok: true, remainingMs: remaining };
  }
  // Release lease with a very short retry window so the next drain
  // (inline follow-up or daily cron) reclaims almost immediately.
  const nextAttemptAt = new Date(now().getTime() + 2_000).toISOString();
  try {
    await writer.release(job, workerId, nextAttemptAt);
  } catch {
    // If the release itself fails, the lease will still expire naturally;
    // the reclaim path handles it. Log below either way.
  }
  log?.({
    event: "job_checkpointed_runtime_budget",
    jobId: job.id, batchId: job.batch_id, candidateId: job.candidate_id,
    stage: job.stage, remainingMs: remaining, elapsedMs: 0,
  });
  return { ok: false, remainingMs: remaining };
}

function blankResult(): TradeResearchResultSummary {
  return {
    officialProgramEvidence: "not_checked", productEvidence: "not_available",
    indiaOrigin: "not_verified", shipmentEvidence: "not_verified", sourcesChecked: 0,
    automaticSpendRupees: AUTOMATIC_SPEND_RUPEES,
  };
}

async function withHeartbeat<T>(
  writer: TradeResearchWriter,
  initialJob: InternalJobRow,
  workerId: string,
  work: () => Promise<T>,
): Promise<{ value: T; job: InternalJobRow }> {
  let job = initialJob;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => { job = await writer.heartbeat(job, workerId); });
  }, LEASE_HEARTBEAT_MS);
  let value!: T;
  try {
    value = await work();
  } finally {
    clearInterval(timer);
    await pending;
  }
  return { value, job };
}

export async function loadFdaFsvpSnapshot(
  writer: TradeResearchWriter,
  now: Date,
  fetchImpl?: typeof fetch,
): Promise<{ snapshot: SnapshotRow; cacheHit: boolean; fetchResult?: FdaFsvpFetchResult }> {
  const fresh = await writer.getFreshSnapshot(now);
  if (fresh) return { snapshot: fresh, cacheHit: true };
  const latest = await writer.getLatestSnapshot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("FDA dataset fetch timeout"), FETCH_TIMEOUT_MS);
  let fetched: FdaFsvpFetchResult;
  try {
    fetched = await fetchFdaFsvpDataset({ etag: latest?.etag, lastModified: latest?.last_modified, fetchImpl, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("FDA dataset request timed out."), { code: "NETWORK_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timeout); }
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + FDA_FSVP_DESCRIPTOR.cacheMaxAgeDays * 86_400_000).toISOString();
  if (fetched.outcome === "not_modified") {
    if (!latest) throw new FdaFsvpParserError("FDA returned not-modified without a cached snapshot.");
    return { snapshot: await writer.refreshSnapshotExpiry(latest.id, retrievedAt, expiresAt), cacheHit: true, fetchResult: fetched };
  }
  if (!fetched.bytes || !fetched.materialHash) throw new FdaFsvpParserError("FDA dataset response was incomplete.");
  const parsed = parseFdaFsvpXlsx(fetched.bytes);
  const snapshot = await writer.saveSnapshot({
    provider_id: FDA_FSVP_DESCRIPTOR.id, dataset_id: FDA_FSVP_DATASET_ID,
    published_period: parsed.publishedPeriod, source_url: FDA_FSVP_SOURCE_URL,
    etag: fetched.etag ?? null, last_modified: fetched.lastModified ?? null,
    material_hash: fetched.materialHash, fetched_at: retrievedAt, retrieved_at: retrievedAt, expires_at: expiresAt,
    row_count: parsed.rows.length, coverage: { fields: ["firm_legal_name", "state_code"], semantics: "official_program_corroboration_only" },
    parse_version: FDA_FSVP_PARSE_VERSION, terms_version: FDA_FSVP_DESCRIPTOR.termsVersion,
    status: "ready", safe_metadata: { malformedRowCount: parsed.malformedRowCount }, normalized_rows: parsed.rows,
  });
  return { snapshot, cacheHit: false, fetchResult: fetched };
}

export async function processTradeResearchJob(
  writer: TradeResearchWriter,
  claimed: InternalJobRow,
  workerId: string,
  now: () => Date,
  fetchImpl?: typeof fetch,
  log?: TradeResearchLogger,
  deadlineAt?: number,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimed;
  log?.(jobDiagnostic("stage_started", job));
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await advanceStage(writer, job, workerId, "planning_sources", log);
  const plan = await writer.getEligiblePlan(job.id);
  if (!plan) {
    job = await advanceStage(writer, job, workerId, "finalizing", log);
    await writer.finalize(job, workerId, "completed", "unsupported_coverage", blankResult());
    log?.(jobDiagnostic("stage_completed", job));
    return "completed";
  }
  if (Number(plan.automatic_spend_rupees) !== 0 || plan.cost_class !== "free") throw new Error("PROVIDER_COST_POLICY_VIOLATION");
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await advanceStage(writer, job, workerId, "screening_sources", log);

  // Resume-idempotent attempt handling. If the previous execution
  // already finished a successful attempt (completed or skipped_cached)
  // AND a fresh FDA snapshot exists, DO NOT start a new attempt or
  // re-fetch the workbook — reuse the existing attempt row and the
  // cached snapshot, jump straight to matching.
  const previous = await writer.latestAttempt(String(plan.id));
  const previousStateRaw = previous?.state;
  const previousState = typeof previousStateRaw === "string" ? previousStateRaw : null;
  const attemptAlreadyResolved =
    previousState === "completed" || previousState === "skipped_cached";

  let snapshot: SnapshotRow;
  let cacheHit = false;

  // Cheap probe first — if a fresh FDA snapshot already exists, we can
  // avoid the pre-FDA cold-path deadline gate entirely because the FDA
  // step will be effectively free (one Supabase read).
  const preloadedFresh = await writer.getFreshSnapshot(now());
  if (preloadedFresh) {
    snapshot = preloadedFresh;
    cacheHit = true;
  } else if (attemptAlreadyResolved) {
    // The previous partial run reported a completed attempt but the
    // snapshot has aged out between checkpointed run and resume — fall
    // through to a fresh fetch. A NEW attempt row is created.
    snapshot = undefined as unknown as SnapshotRow;
  } else {
    snapshot = undefined as unknown as SnapshotRow;
  }

  // Deadline gate BEFORE the potentially expensive FDA cold-fetch path.
  // Only relevant when we haven't already got the snapshot in hand.
  if (!snapshot) {
    const gate = await checkpointIfBudgetLow(
      writer, job, workerId, deadlineAt, FDA_COLD_PATH_WORST_CASE_MS, now, log,
    );
    if (!gate.ok) return "retry";
  }

  const attemptNumber = attemptAlreadyResolved && snapshot
    ? Number(previous?.attempt_number ?? 1)
    : Number(previous?.attempt_number ?? 0) + 1;
  const attempt = attemptAlreadyResolved && snapshot
    ? previous as { id: string | number }
    : await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  if (!(attemptAlreadyResolved && snapshot)) {
    await writer.appendEvent(job, "provider_attempt_started", { providerId: "fda-fsvp", attempt: attemptNumber });
  }
  const started = Date.now();
  if (snapshot) {
    // Reused snapshot path — no fetch, no attempt writes needed.
  }
  try {
    if (!snapshot) {
      const heartbeat = await withHeartbeat(writer, job, workerId, () => loadFdaFsvpSnapshot(writer, now(), fetchImpl));
      job = heartbeat.job;
      snapshot = heartbeat.value.snapshot;
      cacheHit = heartbeat.value.cacheHit;
    }
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    const delay = isRetryableProviderFailure({ status, code }) ? retryDelayMs(attemptNumber) : null;
    if (delay !== null) {
      await writer.finishAttempt(String(attempt.id), { state: "retry_wait", safe_error_code: code ?? "TRANSIENT_PROVIDER_ERROR", duration_ms: Date.now() - started });
      await writer.appendEvent(job, "provider_attempt_completed", { providerId: "fda-fsvp", attempt: attemptNumber, state: "retry_wait" });
      await writer.release(job, workerId, new Date(now().getTime() + delay).toISOString());
      log?.(jobDiagnostic("job_requeued", job, { leaseState: "released", safeErrorCode: code ?? "TRANSIENT_PROVIDER_ERROR" }));
      return "retry";
    }
    await writer.finishAttempt(String(attempt.id), { state: "failed_terminal", safe_error_code: code ?? (error instanceof FdaFsvpParserError ? error.code : "PROVIDER_FAILURE"), duration_ms: Date.now() - started });
    await writer.finalize(job, workerId, "failed", "failed", blankResult());
    log?.(jobDiagnostic("job_failed", job, { leaseState: "released", safeErrorCode: code ?? (error instanceof FdaFsvpParserError ? error.code : "PROVIDER_FAILURE") }));
    return "failed";
  }
  if (!attemptAlreadyResolved) {
    await writer.finishAttempt(String(attempt.id), {
      state: cacheHit ? "skipped_cached" : "completed", duration_ms: Date.now() - started,
      record_count: snapshot.row_count, match_count: 0,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: "fda-fsvp", attempt: attemptNumber, state: cacheHit ? "skipped_cached" : "completed", recordCount: snapshot.row_count });
  }
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  // Deadline gate BEFORE matching — matching + finalize + downstream
  // writes together need enough headroom to run to completion. Assume
  // ~5 s worst case for matching (large row set) + finalize + writes.
  const matchGate = await checkpointIfBudgetLow(
    writer, job, workerId, deadlineAt, 5_000, now, log,
  );
  if (!matchGate.ok) return "retry";
  job = await advanceStage(writer, job, workerId, "resolving_company_matches", log);
  const candidate = await writer.getCandidate(job);
  const match = matchFdaFsvpCompany({ companyName: candidate.companyName, address: candidate.address, city: candidate.city, rows: snapshot.normalized_rows });
  await writer.appendEvent(job, "match_resolved", { providerId: "fda-fsvp", identityResult: match.decision, matchCount: match.matchedRows.length, datasetWatermark: snapshot.material_hash });
  job = await advanceStage(writer, job, workerId, "checking_trade_activity", log);
  const result: TradeResearchResultSummary = {
    ...blankResult(),
    officialProgramEvidence: match.decision === "strong" ? "verified" : match.decision === "ambiguous" ? "needs_review" : "no_verified_match",
    sourcesChecked: 1,
    evidence: {
      source: "FDA FSVP", datasetPeriod: snapshot.published_period, retrievedAt: snapshot.retrieved_at,
      matchedSourceName: match.matchedRows[0]?.companyName, matchedState: match.matchedRows[0]?.stateCode,
      candidateName: candidate.companyName, candidateState: match.candidateState,
      identityDecision: match.decision, matchReason: match.reason,
      coverageExplanation: "The official list contains participant name and U.S. state only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status.",
    },
  };
  job = await advanceStage(writer, job, workerId, "finalizing", log);
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "partial", "partial", result);
  } else if (match.decision === "strong") {
    await writer.finalize(job, workerId, "completed", "official_importer_program_corroboration", result);
  } else if (match.decision === "ambiguous") {
    await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else {
    await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return "completed";
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
