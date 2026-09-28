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
import {
  FDA_VQIP_ATTRIBUTION,
  FDA_VQIP_DATASET_ID,
  FDA_VQIP_PARSE_VERSION,
  FDA_VQIP_SOURCE_URL,
  FdaVqipParserError,
  fetchFdaVqipDataset,
  matchFdaVqipCompany,
  parseFdaVqipHtml,
} from "../fdaVqip";
import {
  CANADA_CID_ATTRIBUTION,
  CANADA_CID_DATASET_ID,
  CANADA_CID_PARSE_VERSION,
  CanadaCidParserError,
  CanadaCidRuntimeBudgetError,
  canadaCidByHs6ByCountryUrl,
  fetchAndParseCanadaCidStream,
  matchCanadaCidCompany,
  type CanadaCidMatchResult,
} from "../canadaCid";
import { PRODUCT_TRADE_MAPPINGS } from "@/lib/marketIntelligence/product";
import { isRetryableProviderFailure, retryDelayMs } from "../stateMachine";
import {
  AUTOMATIC_SPEND_RUPEES, PHASE_2A_STAGES,
  type Phase2AStage,
  type TradeResearchAggregateSummary,
  type TradeResearchEvidenceLevel,
  type TradeResearchEvaluatedProviderResult,
  type TradeResearchProviderExecutionState,
  type TradeResearchProviderResult,
  type TradeResearchResultSummary,
  type TradeResearchSourceEvidence,
} from "../types";
import {
  isTradeResearchLeaseLostError,
  TradeResearchWriter,
  type InternalJobRow,
  type SnapshotRow,
} from "../repository";
import { CANADA_CID_DESCRIPTOR, CANADA_CID_SUPPORTED_YEAR, canonicalHs6ForProduct, FDA_FSVP_DESCRIPTOR, FDA_VQIP_DESCRIPTOR } from "../providers";
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
 * Canada CID cold-path worst-case: HTTP fetch of the "Major
 * Importers by HS6, country" XLSX (typically 4–8 MB) + unzip +
 * sheet-XML parse + snapshot save. Larger than FDA FSVP because the
 * dataset is bigger, but still fits well under the deadline given
 * the 50 s safe execution budget minus the 8 s cleanup reserve.
 */
const CANADA_CID_COLD_PATH_WORST_CASE_MS = 30_000;

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

function evaluatedProviderResult(input: {
  job: InternalJobRow;
  providerId: string;
  datasetId: string;
  parserVersion: string;
  snapshot: SnapshotRow;
  source: TradeResearchSourceEvidence;
  status: Extract<TradeResearchProviderExecutionState, "completed" | "no_match" | "cached">;
  matchCount: number;
}): TradeResearchEvaluatedProviderResult {
  const context = input.job.research_context;
  const assessment = (state: TradeResearchEvidenceLevel, explanation: string) => ({ state, explanation });
  const sourceRecordIds = Array.from(
    { length: input.matchCount },
    (_, index) => `${input.snapshot.material_hash}:match:${index + 1}`,
  );
  const isFda = input.providerId === FDA_FSVP_DESCRIPTOR.id || input.providerId === FDA_VQIP_DESCRIPTOR.id;
  return {
    providerId: input.providerId,
    datasetId: input.datasetId,
    datasetVersion: input.snapshot.material_hash,
    parserVersion: input.parserVersion,
    sourceRecordIds,
    sourcePeriod: input.snapshot.published_period,
    retrievedAt: input.snapshot.retrieved_at,
    execution: { status: input.status, safeErrorCode: null },
    evidence: {
      matchDecision: input.source.identityDecision,
      companyEvidence: assessment(input.source.companyEvidence, input.source.matchReason),
      productEvidence: assessment(input.source.productEvidence, input.source.coverageExplanation),
      originEvidence: assessment(input.source.originEvidence, input.source.coverageExplanation),
      shipmentEvidence: assessment(input.source.shipmentEvidence, "This source does not establish shipment-level activity."),
      programEvidence: assessment(
        isFda ? input.source.companyEvidence : "not_available",
        isFda ? input.source.matchReason : "This source is not an importer-program list.",
      ),
      coverage: { state: "partially_covered", explanation: input.source.coverageExplanation },
      limitations: [input.source.coverageExplanation],
      attribution: input.source.attribution,
      mappingScope: {
        marketCountryCode: context?.marketCountryCode ?? input.job.country_code,
        productId: context?.productId ?? input.job.product_id ?? "unknown",
        productForm: context?.productForm ?? null,
        sourceProductCodes: [],
        companyGrain: "company_record",
        productGrain: input.providerId === CANADA_CID_DESCRIPTOR.id ? "company_product" : "not_available",
        originGrain: input.providerId === CANADA_CID_DESCRIPTOR.id ? "company_product_origin" : "not_available",
        shipmentGrain: "not_available",
        programGrain: isFda ? "company_program" : "not_available",
      },
      interpretationVersion: `${input.parserVersion}:t08-v1`,
      conflicts: [],
    },
  };
}

function evaluatedExecutionStatus(
  previousState: string | null,
  attemptAlreadyResolved: boolean,
  cacheHit: boolean,
  decision: "exact" | "strong" | "ambiguous" | "rejected" | "none",
): Extract<TradeResearchProviderExecutionState, "completed" | "no_match" | "cached"> {
  if (attemptAlreadyResolved) {
    if (previousState === "skipped_cached") return "cached";
    if (previousState === "completed_no_match") return "no_match";
    return "completed";
  }
  if (cacheHit) return "cached";
  return decision === "none" || decision === "rejected" ? "no_match" : "completed";
}

function unevaluatedProviderResult(
  providerId: string,
  status: Exclude<TradeResearchProviderExecutionState, "completed" | "no_match" | "cached">,
  safeErrorCode: string | null = null,
): TradeResearchProviderResult {
  const datasetId = providerId === FDA_FSVP_DESCRIPTOR.id ? FDA_FSVP_DATASET_ID
    : providerId === FDA_VQIP_DESCRIPTOR.id ? FDA_VQIP_DATASET_ID
    : providerId === CANADA_CID_DESCRIPTOR.id ? CANADA_CID_DATASET_ID
    : providerId;
  return {
    providerId, datasetId, datasetVersion: null, parserVersion: null,
    sourceRecordIds: [], sourcePeriod: null, retrievedAt: null,
    execution: { status, safeErrorCode }, evidence: null,
  };
}

function completeProvisionalProviderResults(
  plans: readonly Record<string, unknown>[],
  results: readonly TradeResearchProviderResult[],
): TradeResearchProviderResult[] {
  const byProvider = new Map(results.map((result) => [result.providerId, result]));
  return plans.map((plan) => {
    const providerId = String(plan.provider_id ?? "");
    return byProvider.get(providerId) ?? unevaluatedProviderResult(providerId, "not_started");
  });
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
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      job = await writer.heartbeat(job, workerId);
      adopt(job);
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
    job = await writer.heartbeat(job, workerId);
    adopt(job);
  }
  if (workFailed) throw workError;
  return { value, job };
}

/**
 * Canada CID snapshot loader. Mirrors the FDA loader's shape:
 *  1. return the fresh cached snapshot when available,
 *  2. otherwise conditional-GET the ISED file with the last known
 *     ETag / Last-Modified,
 *  3. on 304 refresh the snapshot's expiry without re-parsing,
 *  4. on 200 parse the XLSX (bounded), compute SHA-256, save a new
 *     snapshot row keyed by (provider_id, dataset_id, material_hash).
 * FDA snapshots are never returned here — the query is scoped to
 * `provider_id = "canada-cid"`. Symmetrically, the FDA loader never
 * returns a CID snapshot.
 */
/**
 * Canonical MDF HS6 set — every HS6 code the trade-research engine
 * currently supports. The Canada CID streaming loader keeps ONLY
 * these rows in the cached normalized snapshot, so a 40 MB source
 * dataset shrinks to a 70 KB cached row set that stays reusable
 * across every MDF product. The full source bytes are still
 * SHA-256-hashed for material_hash provenance.
 */
const CANONICAL_MDF_HS6: ReadonlySet<string> = new Set(
  PRODUCT_TRADE_MAPPINGS
    .filter((mapping) => mapping.hsLevel === 6)
    .map((mapping) => mapping.hsCode.padStart(6, "0")),
);

/**
 * Streaming Canada CID snapshot loader. Downloads the response body
 * incrementally, heartbeats between chunks, checks the deadline
 * before each yield, and normalizes ONLY rows whose HS6 is in
 * `CANONICAL_MDF_HS6`. Any deadline breach throws
 * `CanadaCidRuntimeBudgetError`; the caller MUST treat that as a
 * safe retryable release (never a terminal failure).
 */
export async function loadCanadaCidSnapshot(
  writer: TradeResearchWriter,
  now: Date,
  year: number,
  fetchImpl?: typeof fetch,
  deadlineAt?: number,
  onProgress?: () => void,
): Promise<{ snapshot: SnapshotRow; cacheHit: boolean }> {
  const fresh = await writer.getFreshSnapshotByProvider(CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID, now);
  if (fresh) return { snapshot: fresh, cacheHit: true };
  const latest = await writer.getLatestSnapshotByProvider(CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Canada CID fetch timeout"), FETCH_TIMEOUT_MS);
  let loaded;
  try {
    loaded = await fetchAndParseCanadaCidStream({
      year, etag: latest?.etag, lastModified: latest?.last_modified,
      fetchImpl, signal: controller.signal,
      canonicalHs6: CANONICAL_MDF_HS6,
      deadlineAt, onProgress,
    });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Canada CID request timed out."), { code: "NETWORK_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timeout); }
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CANADA_CID_DESCRIPTOR.cacheMaxAgeDays * 86_400_000).toISOString();
  if (loaded.outcome === "not_modified") {
    if (!latest) throw new CanadaCidParserError("Canada CID returned not-modified without a cached snapshot.");
    return { snapshot: await writer.refreshSnapshotExpiry(latest.id, retrievedAt, expiresAt), cacheHit: true };
  }
  const snapshot = await writer.saveSnapshot({
    provider_id: CANADA_CID_DESCRIPTOR.id, dataset_id: CANADA_CID_DATASET_ID,
    published_period: loaded.publishedPeriod, source_url: loaded.sourceUrl,
    etag: loaded.etag ?? null, last_modified: loaded.lastModified ?? null,
    material_hash: loaded.materialHash, fetched_at: retrievedAt, retrieved_at: retrievedAt, expires_at: expiresAt,
    row_count: loaded.rows.length,
    coverage: {
      fields: ["hs6", "origin_country", "importer_company", "province", "city"],
      semantics: "company_hs_origin_directory_only",
      attribution: CANADA_CID_ATTRIBUTION,
      shipmentLevel: false,
      // Provenance: we downloaded the ENTIRE CID resource (SHA-256
      // covers all `bytesConsumed`) but the cached normalized rows
      // are the MDF-canonical-HS6 subset only. Consumers must not
      // read `normalized_rows` as the complete CID dataset.
      cachedSubset: "canonical-mdf-hs6-only",
      sourceBytes: loaded.bytesConsumed,
      sourceDataRows: loaded.totalDataRows,
    },
    parse_version: CANADA_CID_PARSE_VERSION, terms_version: CANADA_CID_DESCRIPTOR.termsVersion,
    status: "ready",
    safe_metadata: {
      malformedRowCount: loaded.malformedRowCount, year,
      totalDataRows: loaded.totalDataRows, retainedRows: loaded.retainedRows,
    },
    normalized_rows: loaded.rows,
  });
  return { snapshot, cacheHit: false };
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
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await advanceStage(writer, job, workerId, "planning_sources", log);
  const plans = typeof writer.getEligiblePlans === "function"
    ? await writer.getEligiblePlans(job.id)
    : await (async () => { const p = await writer.getEligiblePlan(job.id); return p ? [p] : []; })();
  if (!plans.length) {
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
    job = await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await advanceStage(writer, job, workerId, "screening_sources", log);

  // Single-provider dispatch — byte-identical to Phase 2A/2B for
  // FSVP-only US candidates and CID-only CA candidates.
  if (plans.length === 1) {
    const plan = plans[0];
    const providerId = String((plan as { provider_id?: unknown }).provider_id ?? "");
    switch (providerId) {
      case FDA_FSVP_DESCRIPTOR.id:
        return processFdaFsvpPlan(writer, job, workerId, plan, now, fetchImpl, log, deadlineAt);
      case CANADA_CID_DESCRIPTOR.id:
        return processCanadaCidPlan(writer, job, workerId, plan, now, fetchImpl, log, deadlineAt);
      case FDA_VQIP_DESCRIPTOR.id:
        return processFdaVqipPlan(writer, job, workerId, plan, now, fetchImpl, log, deadlineAt);
      default:
        job = await advanceStage(writer, job, workerId, "finalizing", log);
        job = await writer.finalize(job, workerId, "completed", "unsupported_coverage", blankResult());
        log?.(jobDiagnostic("stage_completed", job));
        return "completed";
    }
  }

  // BI4F 2C — multi-provider execution. Each provider runs to
  // completion (or safe checkpoint) independently; per-provider
  // evidence is preserved and only aggregated at finalize.
  return processMultiProviderUsPlans(writer, job, workerId, plans, now, fetchImpl, log, deadlineAt);
}

/**
 * Phase 2A FDA FSVP execution path. Byte-identical to the pre-Phase-2B
 * behaviour: cache probe → pre-fetch deadline gate → attempt reuse →
 * fetch/parse → match → finalize. Extracted from `processTradeResearchJob`
 * so `processTradeResearchJob` can dispatch by `plan.provider_id`.
 */
async function processFdaFsvpPlan(
  writer: TradeResearchWriter,
  claimedJob: InternalJobRow,
  workerId: string,
  plan: Record<string, unknown>,
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
  deadlineAt: number | undefined,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimedJob;
  let previous = await writer.latestAttempt(String(plan.id));
  let previousStateRaw = previous?.state;
  let previousState = typeof previousStateRaw === "string" ? previousStateRaw : null;
  // BI4F 2B stale-attempt reconciliation. A `state='running'`
  // previous attempt means a prior worker was hard-killed mid-fetch.
  // Reconcile it truthfully as `failed_retryable` with
  // `STALE_LEASE_RECOVERED` before creating a NEW attempt row.
  if (previousState === "running" && previous?.id) {
    await writer.reconcileStaleAttempt(job, workerId, String(previous.id), "STALE_LEASE_RECOVERED");
    // Force the caller to increment attemptNumber past the stale
    // row: treat the reconciled row as the previous non-resolved
    // attempt (previous.state effectively reads `failed_retryable`).
    previous = { ...previous, state: "failed_retryable" };
    previousStateRaw = "failed_retryable";
    previousState = "failed_retryable";
  }
  const attemptAlreadyResolved =
    previousState === "completed" || previousState === "completed_no_match" || previousState === "skipped_cached";

  let snapshot: SnapshotRow;
  let cacheHit = false;
  const preloadedFresh = await writer.getFreshSnapshot(now());
  if (preloadedFresh) { snapshot = preloadedFresh; cacheHit = true; }
  else { snapshot = undefined as unknown as SnapshotRow; }

  if (!snapshot) {
    const gate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, FDA_COLD_PATH_WORST_CASE_MS, now, log);
    if (!gate.ok) return "retry";
  }

  const attemptNumber = attemptAlreadyResolved && snapshot
    ? Number(previous?.attempt_number ?? 1)
    : Number(previous?.attempt_number ?? 0) + 1;
  const attempt = attemptAlreadyResolved && snapshot
    ? previous as { id: string | number }
    : await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  if (!(attemptAlreadyResolved && snapshot)) {
    await writer.appendEvent(job, "provider_attempt_started", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber });
  }
  const started = Date.now();
  try {
    if (!snapshot) {
      const heartbeat = await withHeartbeat(
        writer, job, workerId,
        () => loadFdaFsvpSnapshot(writer, now(), fetchImpl),
        (authoritativeJob) => { job = authoritativeJob; },
      );
      job = heartbeat.job;
      snapshot = heartbeat.value.snapshot;
      cacheHit = heartbeat.value.cacheHit;
    }
  } catch (error) {
    if (isTradeResearchLeaseLostError(error)) throw error;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    const delay = isRetryableProviderFailure({ status, code }) ? retryDelayMs(attemptNumber) : null;
    if (delay !== null) {
      await writer.finishAttempt(job, workerId, String(attempt.id), { state: "retry_wait", safe_error_code: code ?? "TRANSIENT_PROVIDER_ERROR", duration_ms: Date.now() - started });
      await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait" });
      job = await writer.release(job, workerId, new Date(now().getTime() + delay).toISOString());
      log?.(jobDiagnostic("job_requeued", job, { leaseState: "released", safeErrorCode: code ?? "TRANSIENT_PROVIDER_ERROR" }));
      return "retry";
    }
    await writer.finishAttempt(job, workerId, String(attempt.id), { state: "failed_terminal", safe_error_code: code ?? (error instanceof FdaFsvpParserError ? error.code : "PROVIDER_FAILURE"), duration_ms: Date.now() - started });
    job = await writer.finalize(job, workerId, "failed", "failed", blankResult());
    log?.(jobDiagnostic("job_failed", job, { leaseState: "released", safeErrorCode: code ?? (error instanceof FdaFsvpParserError ? error.code : "PROVIDER_FAILURE") }));
    return "failed";
  }
  if (await writer.isCancellationRequested(job.batch_id)) {
    if (!attemptAlreadyResolved) {
      await writer.finishAttempt(job, workerId, String(attempt.id), { state: "cancelled", duration_ms: Date.now() - started });
    }
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  if (!attemptAlreadyResolved && remainingBudgetMs(deadlineAt) < 5_000 + WORKER_CLEANUP_RESERVE_MS) {
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: "retry_wait", safe_error_code: "RUNTIME_BUDGET_CHECKPOINT", duration_ms: Date.now() - started,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait" });
  }
  const matchGate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, 5_000, now, log);
  if (!matchGate.ok) return "retry";
  job = await advanceStage(writer, job, workerId, "resolving_company_matches", log);
  const candidate = await writer.getCandidate(job);
  const match = matchFdaFsvpCompany({ companyName: candidate.companyName, address: candidate.address, city: candidate.city, rows: snapshot.normalized_rows });
  await writer.appendEvent(job, "match_resolved", { providerId: FDA_FSVP_DESCRIPTOR.id, identityResult: match.decision, matchCount: match.matchedRows.length, datasetWatermark: snapshot.material_hash });
  const providerStatus = evaluatedExecutionStatus(previousState, attemptAlreadyResolved, cacheHit, match.decision);
  if (!attemptAlreadyResolved) {
    const attemptState = cacheHit ? "skipped_cached" : providerStatus === "no_match" ? "completed_no_match" : "completed";
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: attemptState, duration_ms: Date.now() - started,
      record_count: snapshot.row_count, match_count: match.matchedRows.length,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber, state: attemptState, recordCount: snapshot.row_count, matchCount: match.matchedRows.length });
  }
  job = await advanceStage(writer, job, workerId, "checking_trade_activity", log);
  const source: TradeResearchSourceEvidence = {
    providerId: "fda-fsvp", outcome: cacheHit ? "cache_hit" : providerStatus === "no_match" ? "no_match" : "completed",
    source: "FDA FSVP", datasetPeriod: snapshot.published_period, retrievedAt: snapshot.retrieved_at,
    matchedSourceName: match.matchedRows[0]?.companyName, matchedState: match.matchedRows[0]?.stateCode,
    candidateName: candidate.companyName, candidateState: match.candidateState,
    identityDecision: match.decision, matchReason: match.reason,
    coverageExplanation: "The official list contains participant name and U.S. state only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status.",
    companyEvidence: match.decision === "strong" ? "verified" : match.decision === "ambiguous" ? "supporting" : "no_verified_match",
    productEvidence: "not_available", originEvidence: "not_available", shipmentEvidence: "not_verified",
    attribution: "Source: U.S. Food & Drug Administration — Foreign Supplier Verification Programs participant list.",
  };
  const result: TradeResearchResultSummary = {
    ...blankResult(),
    officialProgramEvidence: match.decision === "strong" ? "verified" : match.decision === "ambiguous" ? "needs_review" : "no_verified_match",
    sourcesChecked: 1,
    evidence: source,
    providerResults: [evaluatedProviderResult({
      job, providerId: FDA_FSVP_DESCRIPTOR.id, datasetId: FDA_FSVP_DATASET_ID,
      parserVersion: FDA_FSVP_PARSE_VERSION, snapshot, source,
      status: providerStatus, matchCount: match.matchedRows.length,
    })],
  };
  job = await advanceStage(writer, job, workerId, "finalizing", log);
  if (await writer.isCancellationRequested(job.batch_id)) {
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "partial", "partial", result);
  } else if (match.decision === "strong") {
    job = await writer.finalize(job, workerId, "completed", "official_importer_program_corroboration", result);
  } else if (match.decision === "ambiguous") {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else {
    job = await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return "completed";
}

export interface CanadaCidEvidenceProjection {
  productEvidence: TradeResearchResultSummary["productEvidence"];
  originEvidence: TradeResearchResultSummary["originEvidence"];
  indiaOrigin: TradeResearchResultSummary["indiaOrigin"];
}

/**
 * Project company-scoped CID evidence only after resolving identity.
 *
 * Identity is the outer gate: a same-name CID row for a conflicting
 * province remains useful review provenance, but none of its product or
 * origin fields may be attributed to the candidate. Ambiguous identity is
 * intentionally capped at supporting. Exact/strong identity may use only
 * the rows returned by the matcher for that accepted identity.
 */
export function projectCanadaCidEvidence(input: {
  decision: CanadaCidMatchResult["decision"];
  originCountries: readonly string[];
  mappingKind: "exact" | "proxy" | "composite";
}): CanadaCidEvidenceProjection {
  const identityAccepted = input.decision === "exact" || input.decision === "strong";
  const identityAmbiguous = input.decision === "ambiguous";

  if (!identityAccepted && !identityAmbiguous) {
    return {
      productEvidence: "no_verified_match",
      originEvidence: "no_verified_match",
      indiaOrigin: "not_verified",
    };
  }

  const hasOrigin = input.originCountries.length > 0;
  const indiaPresent = input.originCountries.includes("IN");
  return {
    productEvidence:
      identityAccepted && input.mappingKind === "exact" ? "verified" : "supporting",
    originEvidence:
      !hasOrigin ? "not_verified" : identityAccepted ? "verified" : "supporting",
    indiaOrigin:
      !indiaPresent ? "not_verified" : identityAccepted ? "verified" : "supporting",
  };
}

function canadaCidOriginCoverage(
  match: CanadaCidMatchResult,
  hs6: string,
): string {
  if (match.decision === "rejected") {
    return `A similar company name exists in CID at HS6 ${hs6}, but its source province conflicts with the candidate's known province. Product and origin fields from those rows are not attributed to this candidate.`;
  }
  if (match.decision === "none") {
    return `No company identity match was found in CID at HS6 ${hs6}; no product or origin fields are attributed to this candidate.`;
  }
  if (match.decision === "ambiguous") {
    return `Origin countries observed on the similar-name rows at HS6 ${hs6}: ${match.originCountries.length ? match.originCountries.join(", ") : "none"}. Candidate province is unavailable, so company-scoped evidence is capped at supporting.`;
  }
  return `Origin countries observed for the accepted company identity at HS6 ${hs6}: ${match.originCountries.length ? match.originCountries.join(", ") : "none"}.`;
}

/**
 * Phase 2B Canada CID execution path. Mirrors the FDA path's shape
 * (cache → deadline gate → attempt → fetch/parse → match → finalize)
 * but uses the joined "Major Importers by HS6, country" resource and
 * emits company-specific product + origin evidence honestly labelled
 * by the target HS6's `mappingKind` (exact/proxy/composite).
 *
 * Evidence-join safety: origin countries are read from the SAME rows
 * that matched the target HS6 and normalized company — never from a
 * separate CID resource, never from market-level aggregates.
 */
async function processCanadaCidPlan(
  writer: TradeResearchWriter,
  claimedJob: InternalJobRow,
  workerId: string,
  plan: Record<string, unknown>,
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
  deadlineAt: number | undefined,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimedJob;
  const productId = typeof job.product_id === "string" && job.product_id ? job.product_id : undefined;
  const hs = canonicalHs6ForProduct(productId);
  if (!hs) {
    job = await advanceStage(writer, job, workerId, "finalizing", log);
    job = await writer.finalize(job, workerId, "completed", "unsupported_coverage", { ...blankResult(), sourcesChecked: 0 });
    log?.(jobDiagnostic("stage_completed", job));
    return "completed";
  }

  let previous = await writer.latestAttempt(String(plan.id));
  let previousStateRaw = previous?.state;
  let previousState = typeof previousStateRaw === "string" ? previousStateRaw : null;
  // BI4F 2B stale-attempt reconciliation — same contract as the FDA
  // path. A prior hard-kill leaves the attempt row `running`; the
  // job-level claim RPC doesn't touch attempts, so we reconcile it
  // truthfully here before creating a new attempt row.
  if (previousState === "running" && previous?.id) {
    await writer.reconcileStaleAttempt(job, workerId, String(previous.id), "STALE_LEASE_RECOVERED");
    previous = { ...previous, state: "failed_retryable" };
    previousStateRaw = "failed_retryable";
    previousState = "failed_retryable";
  }
  const attemptAlreadyResolved =
    previousState === "completed" || previousState === "completed_no_match" || previousState === "skipped_cached";

  let snapshot: SnapshotRow;
  let cacheHit = false;
  const preloadedFresh = await writer.getFreshSnapshotByProvider(CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID, now());
  if (preloadedFresh) { snapshot = preloadedFresh; cacheHit = true; }
  else { snapshot = undefined as unknown as SnapshotRow; }

  if (!snapshot) {
    const gate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, CANADA_CID_COLD_PATH_WORST_CASE_MS, now, log);
    if (!gate.ok) return "retry";
  }

  const attemptNumber = attemptAlreadyResolved && snapshot
    ? Number(previous?.attempt_number ?? 1)
    : Number(previous?.attempt_number ?? 0) + 1;

  // Bounded retry protection. Migration 0025's
  // `check (attempt_number between 1 and 3)` gives us a hard DB
  // ceiling; if we tried to `startAttempt` with number = 4 the
  // CHECK constraint would violate and the job would silently loop
  // in the reclaim path. Instead, when the previous attempt was a
  // runtime-budget checkpoint AND we've exhausted the 3 attempts
  // the schema allows, finalize the job as failed with a specific
  // safe error code. Cache-hits (`attemptAlreadyResolved && snapshot`)
  // bypass this — we're not starting a new attempt.
  const MAX_CID_ATTEMPTS = 3;
  const previousSafeErrorCode = typeof previous?.safe_error_code === "string" ? previous.safe_error_code : "";
  const previousExhaustedBudget = previousSafeErrorCode === "CID_RUNTIME_BUDGET_CHECKPOINT";
  if (!(attemptAlreadyResolved && snapshot) && !snapshot && attemptNumber > MAX_CID_ATTEMPTS && previousExhaustedBudget) {
    job = await advanceStage(writer, job, workerId, "finalizing", log);
    job = await writer.finalize(job, workerId, "failed", "failed", { ...blankResult(), sourcesChecked: 0 });
    log?.(jobDiagnostic("job_failed", job, {
      leaseState: "released", safeErrorCode: "CID_RUNTIME_BUDGET_EXHAUSTED",
    }));
    return "failed";
  }
  const attempt = attemptAlreadyResolved && snapshot
    ? previous as { id: string | number }
    : await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  if (!(attemptAlreadyResolved && snapshot)) {
    await writer.appendEvent(job, "provider_attempt_started", { providerId: CANADA_CID_DESCRIPTOR.id, attempt: attemptNumber });
  }
  const started = Date.now();
  try {
    if (!snapshot) {
      const heartbeat = await withHeartbeat(writer, job, workerId, async () => {
        // The streaming loader heartbeats between chunks. We also
        // pass `deadlineAt` so it can voluntarily abort with
        // `CanadaCidRuntimeBudgetError` before Vercel kills us.
        // `onProgress` is a no-op because withHeartbeat's setInterval
        // already covers periodic heartbeat writes; we could route
        // manual heartbeat pings here in the future if a very slow
        // download proves to need them.
        return loadCanadaCidSnapshot(writer, now(), CANADA_CID_SUPPORTED_YEAR, fetchImpl, deadlineAt);
      }, (authoritativeJob) => { job = authoritativeJob; });
      job = heartbeat.job;
      snapshot = heartbeat.value.snapshot;
      cacheHit = heartbeat.value.cacheHit;
    }
  } catch (error) {
    if (isTradeResearchLeaseLostError(error)) throw error;
    // Runtime-budget checkpoint: we voluntarily aborted before
    // Vercel's kill. Never finalize as "failed" — release the lease
    // with a short retry window so the next drain reclaims cleanly.
    if (error instanceof CanadaCidRuntimeBudgetError) {
      await writer.finishAttempt(job, workerId, String(attempt.id), {
        state: "retry_wait", safe_error_code: error.code, duration_ms: Date.now() - started,
      });
      await writer.appendEvent(job, "provider_attempt_completed", {
        providerId: CANADA_CID_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait",
      });
      job = await writer.release(job, workerId, new Date(now().getTime() + 2_000).toISOString());
      log?.(jobDiagnostic("job_requeued", job, { leaseState: "released", safeErrorCode: error.code }));
      return "retry";
    }
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    const delay = isRetryableProviderFailure({ status, code }) ? retryDelayMs(attemptNumber) : null;
    if (delay !== null) {
      await writer.finishAttempt(job, workerId, String(attempt.id), { state: "retry_wait", safe_error_code: code ?? "TRANSIENT_PROVIDER_ERROR", duration_ms: Date.now() - started });
      await writer.appendEvent(job, "provider_attempt_completed", { providerId: CANADA_CID_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait" });
      job = await writer.release(job, workerId, new Date(now().getTime() + delay).toISOString());
      log?.(jobDiagnostic("job_requeued", job, { leaseState: "released", safeErrorCode: code ?? "TRANSIENT_PROVIDER_ERROR" }));
      return "retry";
    }
    await writer.finishAttempt(job, workerId, String(attempt.id), { state: "failed_terminal", safe_error_code: code ?? (error instanceof CanadaCidParserError ? error.code : "PROVIDER_FAILURE"), duration_ms: Date.now() - started });
    job = await writer.finalize(job, workerId, "failed", "failed", blankResult());
    log?.(jobDiagnostic("job_failed", job, { leaseState: "released", safeErrorCode: code ?? (error instanceof CanadaCidParserError ? error.code : "PROVIDER_FAILURE") }));
    return "failed";
  }
  if (await writer.isCancellationRequested(job.batch_id)) {
    if (!attemptAlreadyResolved) {
      await writer.finishAttempt(job, workerId, String(attempt.id), { state: "cancelled", duration_ms: Date.now() - started });
    }
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  if (!attemptAlreadyResolved && remainingBudgetMs(deadlineAt) < 5_000 + WORKER_CLEANUP_RESERVE_MS) {
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: "retry_wait", safe_error_code: "RUNTIME_BUDGET_CHECKPOINT", duration_ms: Date.now() - started,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: CANADA_CID_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait" });
  }
  const matchGate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, 5_000, now, log);
  if (!matchGate.ok) return "retry";
  job = await advanceStage(writer, job, workerId, "resolving_company_matches", log);
  const candidate = await writer.getCandidate(job);
  const cidRows = (snapshot.normalized_rows as unknown as Parameters<typeof matchCanadaCidCompany>[0]["rows"]);
  const match = matchCanadaCidCompany({
    companyName: candidate.companyName,
    address: candidate.address,
    city: candidate.city,
    targetHs6: hs.hs6,
    rows: cidRows,
  });
  await writer.appendEvent(job, "match_resolved", {
    providerId: CANADA_CID_DESCRIPTOR.id, identityResult: match.decision,
    matchCount: match.matchedRows.length, datasetWatermark: snapshot.material_hash,
  });
  const providerStatus = evaluatedExecutionStatus(previousState, attemptAlreadyResolved, cacheHit, match.decision);
  if (!attemptAlreadyResolved) {
    const attemptState = cacheHit ? "skipped_cached" : providerStatus === "no_match" ? "completed_no_match" : "completed";
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: attemptState, duration_ms: Date.now() - started,
      record_count: snapshot.row_count, match_count: match.matchedRows.length,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: CANADA_CID_DESCRIPTOR.id, attempt: attemptNumber, state: attemptState, recordCount: snapshot.row_count, matchCount: match.matchedRows.length });
  }
  job = await advanceStage(writer, job, workerId, "checking_trade_activity", log);

  // Identity gates every company-scoped product/origin projection before
  // the same-row HS/origin fields are interpreted. Rejected/none rows are
  // retained below as conflict/no-match provenance only.
  const strong = match.decision === "strong";
  const ambiguous = match.decision === "ambiguous";
  const { productEvidence, originEvidence, indiaOrigin } = projectCanadaCidEvidence({
    decision: match.decision,
    originCountries: match.originCountries,
    mappingKind: hs.kind,
  });

  const matchedRow = match.matchedRows[0];
  const coverageExplanation = [
    `Canada CID is a major-importer directory joined at (HS6, origin country, importer company).`,
    `HS6 ${hs.hs6} mapping quality: ${hs.kind}${hs.kind === "exact" ? "" : ` — product evidence capped at "supporting"`}.`,
    canadaCidOriginCoverage(match, hs.hs6),
    `Dataset does not carry shipment date, per-company quantity, per-company value, or supplier.`,
    CANADA_CID_ATTRIBUTION,
  ].join(" ");
  const source: TradeResearchSourceEvidence = {
    providerId: "canada-cid", outcome: cacheHit ? "cache_hit" : providerStatus === "no_match" ? "no_match" : "completed",
    source: "Canadian Importers Database", datasetPeriod: snapshot.published_period, retrievedAt: snapshot.retrieved_at,
    matchedSourceName: matchedRow?.companyName, matchedState: matchedRow?.province,
    candidateName: candidate.companyName, candidateState: match.candidateProvince,
    identityDecision: match.decision, matchReason: match.reason, coverageExplanation,
    companyEvidence: strong ? "verified" : ambiguous ? "supporting" : "no_verified_match",
    productEvidence, originEvidence, shipmentEvidence: "not_verified", attribution: CANADA_CID_ATTRIBUTION,
  };
  const result: TradeResearchResultSummary = {
    ...blankResult(),
    officialProgramEvidence: strong ? "verified" : ambiguous ? "needs_review" : "no_verified_match",
    productEvidence,
    originEvidence,
    indiaOrigin,
    shipmentEvidence: "not_verified",
    sourcesChecked: 1,
    evidence: source,
    providerResults: [evaluatedProviderResult({
      job, providerId: CANADA_CID_DESCRIPTOR.id, datasetId: CANADA_CID_DATASET_ID,
      parserVersion: CANADA_CID_PARSE_VERSION, snapshot, source,
      status: providerStatus, matchCount: match.matchedRows.length,
    })],
  };
  job = await advanceStage(writer, job, workerId, "finalizing", log);
  if (await writer.isCancellationRequested(job.batch_id)) {
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "partial", "partial", result);
  } else if (strong && productEvidence === "verified") {
    // Only an EXACT HS mapping + STRONG identity can produce the
    // company-level corroboration outcome. Proxy / composite HS
    // mappings finalize as `needs_review` even under strong identity.
    job = await writer.finalize(job, workerId, "completed", "official_importer_program_corroboration", result);
  } else if (strong || ambiguous) {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else {
    job = await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return "completed";
}

/**
 * BI4F Phase 2C — FDA VQIP snapshot loader. HTML page, ~40 KB,
 * fully in-memory (no streaming needed at this size). Fetch → SHA-256
 * → parse → save snapshot.
 */
export async function loadFdaVqipSnapshot(
  writer: TradeResearchWriter,
  now: Date,
  fetchImpl?: typeof fetch,
): Promise<{ snapshot: SnapshotRow; cacheHit: boolean }> {
  const fresh = await writer.getFreshSnapshotByProvider(FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID, now);
  if (fresh) return { snapshot: fresh, cacheHit: true };
  const latest = await writer.getLatestSnapshotByProvider(FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("FDA VQIP fetch timeout"), FETCH_TIMEOUT_MS);
  let fetched;
  try {
    fetched = await fetchFdaVqipDataset({
      etag: latest?.etag, lastModified: latest?.last_modified,
      fetchImpl, signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("FDA VQIP request timed out."), { code: "NETWORK_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timeout); }
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + FDA_VQIP_DESCRIPTOR.cacheMaxAgeDays * 86_400_000).toISOString();
  if (fetched.outcome === "not_modified") {
    if (!latest) throw new FdaVqipParserError("FDA VQIP returned not-modified without a cached snapshot.");
    return { snapshot: await writer.refreshSnapshotExpiry(latest.id, retrievedAt, expiresAt), cacheHit: true };
  }
  if (!fetched.bytes || !fetched.materialHash) throw new FdaVqipParserError("FDA VQIP response was incomplete.");
  const parsed = parseFdaVqipHtml(fetched.bytes);
  const snapshot = await writer.saveSnapshot({
    provider_id: FDA_VQIP_DESCRIPTOR.id, dataset_id: FDA_VQIP_DATASET_ID,
    published_period: parsed.publishedPeriod, source_url: FDA_VQIP_SOURCE_URL,
    etag: fetched.etag ?? null, last_modified: fetched.lastModified ?? null,
    material_hash: fetched.materialHash, fetched_at: retrievedAt, retrieved_at: retrievedAt, expires_at: expiresAt,
    row_count: parsed.rows.length,
    coverage: {
      fields: ["firm_name", "address", "state_code"],
      semantics: "voluntary_importer_program_participation_only",
      attribution: FDA_VQIP_ATTRIBUTION,
      shipmentLevel: false,
    },
    parse_version: FDA_VQIP_PARSE_VERSION, terms_version: FDA_VQIP_DESCRIPTOR.termsVersion,
    status: "ready", safe_metadata: { malformedRowCount: parsed.malformedRowCount },
    normalized_rows: parsed.rows,
  });
  return { snapshot, cacheHit: false };
}

/**
 * Single-provider VQIP path — mirrors FSVP and CID shape.
 */
async function processFdaVqipPlan(
  writer: TradeResearchWriter,
  claimedJob: InternalJobRow,
  workerId: string,
  plan: Record<string, unknown>,
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
  deadlineAt: number | undefined,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimedJob;
  let previous = await writer.latestAttempt(String(plan.id));
  let previousStateRaw = previous?.state;
  let previousState = typeof previousStateRaw === "string" ? previousStateRaw : null;
  if (previousState === "running" && previous?.id) {
    await writer.reconcileStaleAttempt(job, workerId, String(previous.id), "STALE_LEASE_RECOVERED");
    previous = { ...previous, state: "failed_retryable" };
    previousStateRaw = "failed_retryable";
    previousState = "failed_retryable";
  }
  const attemptAlreadyResolved = previousState === "completed" || previousState === "completed_no_match" || previousState === "skipped_cached";

  let snapshot: SnapshotRow;
  let cacheHit = false;
  const preloadedFresh = await writer.getFreshSnapshotByProvider(FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID, now());
  if (preloadedFresh) { snapshot = preloadedFresh; cacheHit = true; }
  else { snapshot = undefined as unknown as SnapshotRow; }

  if (!snapshot) {
    const gate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, 5_000, now, log);
    if (!gate.ok) return "retry";
  }

  const attemptNumber = attemptAlreadyResolved && snapshot
    ? Number(previous?.attempt_number ?? 1)
    : Number(previous?.attempt_number ?? 0) + 1;
  const attempt = attemptAlreadyResolved && snapshot
    ? previous as { id: string | number }
    : await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  if (!(attemptAlreadyResolved && snapshot)) {
    await writer.appendEvent(job, "provider_attempt_started", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber });
  }
  const started = Date.now();
  try {
    if (!snapshot) {
      const heartbeat = await withHeartbeat(
        writer, job, workerId,
        () => loadFdaVqipSnapshot(writer, now(), fetchImpl),
        (authoritativeJob) => { job = authoritativeJob; },
      );
      job = heartbeat.job;
      snapshot = heartbeat.value.snapshot;
      cacheHit = heartbeat.value.cacheHit;
    }
  } catch (error) {
    if (isTradeResearchLeaseLostError(error)) throw error;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    const delay = isRetryableProviderFailure({ status, code }) ? retryDelayMs(attemptNumber) : null;
    if (delay !== null) {
      await writer.finishAttempt(job, workerId, String(attempt.id), { state: "retry_wait", safe_error_code: code ?? "TRANSIENT_PROVIDER_ERROR", duration_ms: Date.now() - started });
      await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait" });
      job = await writer.release(job, workerId, new Date(now().getTime() + delay).toISOString());
      log?.(jobDiagnostic("job_requeued", job, { leaseState: "released", safeErrorCode: code ?? "TRANSIENT_PROVIDER_ERROR" }));
      return "retry";
    }
    await writer.finishAttempt(job, workerId, String(attempt.id), { state: "failed_terminal", safe_error_code: code ?? (error instanceof FdaVqipParserError ? error.code : "PROVIDER_FAILURE"), duration_ms: Date.now() - started });
    job = await writer.finalize(job, workerId, "failed", "failed", blankResult());
    log?.(jobDiagnostic("job_failed", job, { leaseState: "released", safeErrorCode: code ?? (error instanceof FdaVqipParserError ? error.code : "PROVIDER_FAILURE") }));
    return "failed";
  }
  if (await writer.isCancellationRequested(job.batch_id)) {
    if (!attemptAlreadyResolved) {
      await writer.finishAttempt(job, workerId, String(attempt.id), { state: "cancelled", duration_ms: Date.now() - started });
    }
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  if (!attemptAlreadyResolved && remainingBudgetMs(deadlineAt) < 5_000 + WORKER_CLEANUP_RESERVE_MS) {
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: "retry_wait", safe_error_code: "RUNTIME_BUDGET_CHECKPOINT", duration_ms: Date.now() - started,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber, state: "retry_wait" });
  }
  const matchGate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, 5_000, now, log);
  if (!matchGate.ok) return "retry";
  job = await advanceStage(writer, job, workerId, "resolving_company_matches", log);
  const candidate = await writer.getCandidate(job);
  const match = matchFdaVqipCompany({
    companyName: candidate.companyName, address: candidate.address, city: candidate.city,
    rows: snapshot.normalized_rows as unknown as Parameters<typeof matchFdaVqipCompany>[0]["rows"],
  });
  await writer.appendEvent(job, "match_resolved", {
    providerId: FDA_VQIP_DESCRIPTOR.id, identityResult: match.decision,
    matchCount: match.matchedRows.length, datasetWatermark: snapshot.material_hash,
  });
  const providerStatus = evaluatedExecutionStatus(previousState, attemptAlreadyResolved, cacheHit, match.decision);
  if (!attemptAlreadyResolved) {
    const attemptState = cacheHit ? "skipped_cached" : providerStatus === "no_match" ? "completed_no_match" : "completed";
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: attemptState, duration_ms: Date.now() - started,
      record_count: snapshot.row_count, match_count: match.matchedRows.length,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber, state: attemptState, recordCount: snapshot.row_count, matchCount: match.matchedRows.length });
  }
  job = await advanceStage(writer, job, workerId, "checking_trade_activity", log);
  const source: TradeResearchSourceEvidence = {
    providerId: "fda-vqip", outcome: cacheHit ? "cache_hit" : providerStatus === "no_match" ? "no_match" : "completed",
    source: "FDA VQIP", datasetPeriod: snapshot.published_period, retrievedAt: snapshot.retrieved_at,
    matchedSourceName: match.matchedRows[0]?.firmName, matchedState: match.matchedRows[0]?.stateCode,
    candidateName: candidate.companyName, candidateState: match.candidateState,
    identityDecision: match.decision, matchReason: match.reason,
    coverageExplanation: "The FDA VQIP public list contains firm name, address, email, website only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status.",
    companyEvidence: match.decision === "strong" ? "verified" : match.decision === "ambiguous" ? "supporting" : "no_verified_match",
    productEvidence: "not_available", originEvidence: "not_available", shipmentEvidence: "not_verified",
    attribution: FDA_VQIP_ATTRIBUTION,
  };
  const result: TradeResearchResultSummary = {
    ...blankResult(),
    officialProgramEvidence: match.decision === "strong" ? "verified" : match.decision === "ambiguous" ? "needs_review" : "no_verified_match",
    sourcesChecked: 1,
    evidence: source,
    providerResults: [evaluatedProviderResult({
      job, providerId: FDA_VQIP_DESCRIPTOR.id, datasetId: FDA_VQIP_DATASET_ID,
      parserVersion: FDA_VQIP_PARSE_VERSION, snapshot, source,
      status: providerStatus, matchCount: match.matchedRows.length,
    })],
  };
  job = await advanceStage(writer, job, workerId, "finalizing", log);
  if (await writer.isCancellationRequested(job.batch_id)) {
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "partial", "partial", result);
  } else if (match.decision === "strong") {
    job = await writer.finalize(job, workerId, "completed", "official_importer_program_corroboration", result);
  } else if (match.decision === "ambiguous") {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else {
    job = await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return "completed";
}

/**
 * BI4F Phase 2C — multi-provider orchestrator.
 *
 * Runs each eligible provider sequentially, allocating deadline
 * budget across them. Per-provider evidence is preserved verbatim
 * in `evidence.sources[]`. The top-level `officialProgramEvidence`,
 * `productEvidence`, `originEvidence`, and `indiaOrigin` fields are
 * derived deterministically WITHOUT overwriting per-source facts.
 *
 * Failure isolation: if one provider transient-fails or budget-times
 * out, the other provider's evidence is preserved and the job
 * finalizes as `partial` / `needs_review` / `completed` per the
 * documented matrix.
 */
async function processMultiProviderUsPlans(
  writer: TradeResearchWriter,
  claimedJob: InternalJobRow,
  workerId: string,
  plans: readonly Record<string, unknown>[],
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
  deadlineAt: number | undefined,
): Promise<"completed" | "retry" | "failed"> {
  let job = claimedJob;
  const perProvider: TradeResearchSourceEvidence[] = [];
  const typedProviderResults: TradeResearchProviderResult[] = [];
  let anyEvaluated = false;
  let anyProviderFailed = false;

  for (const plan of plans) {
    const providerId = String((plan as { provider_id?: unknown }).provider_id ?? "");
    // Deadline gate BEFORE starting the provider — skip if budget too low.
    const providerRequiredMs = providerId === FDA_FSVP_DESCRIPTOR.id ? FDA_COLD_PATH_WORST_CASE_MS : 5_000;
    const gate = await checkpointIfBudgetLow(writer, job, workerId, deadlineAt, providerRequiredMs, now, log);
    if (!gate.ok) return "retry";
    // Cancellation gate.
    if (await writer.isCancellationRequested(job.batch_id)) {
      job = await refreshOwnedJob(writer, job, workerId);
      const aggregate = aggregateProviderEvidence(perProvider);
      const primary = perProvider[0];
      job = await writer.finalize(job, workerId, "cancelled", "cancelled", {
        ...blankResult(),
        sourcesChecked: perProvider.length,
        evidence: primary ? {
          source: primary.source, datasetPeriod: primary.datasetPeriod, retrievedAt: primary.retrievedAt,
          matchedSourceName: primary.matchedSourceName, matchedState: primary.matchedState,
          candidateName: primary.candidateName, candidateState: primary.candidateState,
          identityDecision: primary.identityDecision, matchReason: primary.matchReason,
          coverageExplanation: primary.coverageExplanation,
        } : undefined,
        sources: perProvider,
        aggregate,
        providerResults: completeProvisionalProviderResults(plans, typedProviderResults),
      });
      return "completed";
    }
    // Reconcile stale attempts for THIS provider only.
    let previous = await writer.latestAttempt(String(plan.id));
    if (previous?.state === "running" && previous?.id) {
      await writer.reconcileStaleAttempt(job, workerId, String(previous.id), "STALE_LEASE_RECOVERED");
      previous = { ...previous, state: "failed_retryable" };
    }
    // Run per-provider execution.
    let providerResult: { job: InternalJobRow; evidence?: TradeResearchSourceEvidence; typed?: TradeResearchProviderResult; failed: boolean } = { job, failed: false };
    try {
      if (providerId === FDA_FSVP_DESCRIPTOR.id) {
        providerResult = await runFdaFsvpProviderOnly(writer, job, workerId, plan, previous, now, fetchImpl, log);
      } else if (providerId === FDA_VQIP_DESCRIPTOR.id) {
        providerResult = await runFdaVqipProviderOnly(writer, job, workerId, plan, previous, now, fetchImpl, log);
      } else {
        typedProviderResults.push(unevaluatedProviderResult(providerId, "unsupported"));
        continue;
      }
    } catch (error) {
      // Expected provider failures are converted to a result inside each
      // provider runner. Any thrown error is a repository/control-flow
      // failure and must reach the drain instead of continuing with a
      // potentially stale job revision.
      throw error;
    }
    job = providerResult.job;
    if (providerResult.evidence) {
      anyEvaluated = true;
      perProvider.push(providerResult.evidence);
    }
    if (providerResult.typed) typedProviderResults.push(providerResult.typed);
    if (providerResult.failed) anyProviderFailed = true;
  }

  // Aggregate + finalize once.
  const aggregate = aggregateProviderEvidence(perProvider);
  const sourcesChecked = perProvider.length;

  // Top-level projection (backwards-compatible for single-source UI):
  const strongCount = perProvider.filter((s) => s.companyEvidence === "verified").length;
  const supportingCount = perProvider.filter((s) => s.companyEvidence === "supporting").length;
  const noMatchCount = perProvider.filter((s) => s.companyEvidence === "no_verified_match").length;
  const officialProgramEvidence: TradeResearchResultSummary["officialProgramEvidence"] =
    aggregate.identity === "conflicting_evidence" ? "needs_review" :
    strongCount > 0 ? "verified" :
    supportingCount > 0 ? "needs_review" :
    noMatchCount > 0 ? "no_verified_match" :
    "not_checked";

  const primary = perProvider[0];
  const result: TradeResearchResultSummary = {
    ...blankResult(),
    officialProgramEvidence,
    sourcesChecked,
    evidence: primary ? {
      source: primary.source, datasetPeriod: primary.datasetPeriod, retrievedAt: primary.retrievedAt,
      matchedSourceName: primary.matchedSourceName, matchedState: primary.matchedState,
      candidateName: primary.candidateName, candidateState: primary.candidateState,
      identityDecision: primary.identityDecision, matchReason: primary.matchReason,
      coverageExplanation: primary.coverageExplanation,
    } : undefined,
    sources: perProvider,
    aggregate,
    providerResults: completeProvisionalProviderResults(plans, typedProviderResults),
  };

  job = await advanceStage(writer, job, workerId, "finalizing", log);
  if (await writer.isCancellationRequested(job.batch_id)) {
    job = await refreshOwnedJob(writer, job, workerId);
    job = await writer.finalize(job, workerId, "partial", "partial", result);
  } else if (!anyEvaluated) {
    job = await writer.finalize(job, workerId, "failed", "failed", result);
  } else if (aggregate.identity === "conflicting_evidence") {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else if (strongCount > 0) {
    // Any strong identity match finalizes as corroboration.
    const outcome = anyProviderFailed ? "partial" : "official_importer_program_corroboration";
    const status = anyProviderFailed ? "partial" : "completed";
    job = await writer.finalize(job, workerId, status, outcome, result);
  } else if (supportingCount > 0) {
    job = await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else {
    job = await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  log?.(jobDiagnostic("stage_completed", job));
  return "completed";
}

/**
 * Per-provider FSVP runner used by the multi-provider orchestrator.
 * Does NOT finalize — returns per-source evidence for aggregation.
 */
async function runFdaFsvpProviderOnly(
  writer: TradeResearchWriter,
  job: InternalJobRow,
  workerId: string,
  plan: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
): Promise<{ job: InternalJobRow; evidence?: TradeResearchSourceEvidence; typed?: TradeResearchProviderResult; failed: boolean }> {
  const previousState = typeof previous?.state === "string" ? previous.state as string : null;
  const attemptAlreadyResolved = previousState === "completed" || previousState === "completed_no_match" || previousState === "skipped_cached";
  const preloadedFresh = await writer.getFreshSnapshot(now());
  let snapshot = preloadedFresh;
  let cacheHit = Boolean(preloadedFresh);
  const attemptNumber = attemptAlreadyResolved && snapshot
    ? Number(previous?.attempt_number ?? 1)
    : Number(previous?.attempt_number ?? 0) + 1;
  const attempt = attemptAlreadyResolved && snapshot
    ? previous as { id: string | number }
    : await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  if (!(attemptAlreadyResolved && snapshot)) {
    await writer.appendEvent(job, "provider_attempt_started", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber });
  }
  const started = Date.now();
  try {
    if (!snapshot) {
      const heartbeat = await withHeartbeat(
        writer, job, workerId,
        () => loadFdaFsvpSnapshot(writer, now(), fetchImpl),
        (authoritativeJob) => { job = authoritativeJob; },
      );
      job = heartbeat.job;
      snapshot = heartbeat.value.snapshot; cacheHit = heartbeat.value.cacheHit;
    }
  } catch (error) {
    if (isTradeResearchLeaseLostError(error)) throw error;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : (error instanceof FdaFsvpParserError ? error.code : "PROVIDER_FAILURE");
    const failureState = isRetryableProviderFailure({ status, code }) ? "failed_retryable" : "failed_terminal";
    await writer.finishAttempt(job, workerId, String(attempt.id), { state: failureState, safe_error_code: code, duration_ms: Date.now() - started });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber, state: failureState });
    log?.(jobDiagnostic("job_failed", job, { safeErrorCode: code }));
    return { job, failed: true, typed: unevaluatedProviderResult(FDA_FSVP_DESCRIPTOR.id, failureState, code) };
  }
  const candidate = await writer.getCandidate(job);
  const match = matchFdaFsvpCompany({ companyName: candidate.companyName, address: candidate.address, city: candidate.city, rows: snapshot!.normalized_rows });
  await writer.appendEvent(job, "match_resolved", { providerId: FDA_FSVP_DESCRIPTOR.id, identityResult: match.decision, matchCount: match.matchedRows.length, datasetWatermark: snapshot!.material_hash });
  const companyEvidence: TradeResearchSourceEvidence["companyEvidence"] =
    match.decision === "strong" ? "verified" :
    match.decision === "ambiguous" ? "supporting" :
    match.decision === "none" || match.decision === "rejected" ? "no_verified_match" : "not_available";
  const evidence: TradeResearchSourceEvidence = {
      providerId: "fda-fsvp",
      outcome: cacheHit ? "cache_hit" : "completed",
      source: "FDA FSVP",
      datasetPeriod: snapshot!.published_period, retrievedAt: snapshot!.retrieved_at,
      matchedSourceName: match.matchedRows[0]?.companyName, matchedState: match.matchedRows[0]?.stateCode,
      candidateName: candidate.companyName, candidateState: match.candidateState,
      identityDecision: match.decision, matchReason: match.reason,
      coverageExplanation: "The FDA FSVP participant list contains name and U.S. state only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status.",
      companyEvidence, productEvidence: "not_available", originEvidence: "not_available",
      shipmentEvidence: "not_verified",
      attribution: "Source: U.S. Food & Drug Administration — Foreign Supplier Verification Programs participant list.",
  };
  const status = evaluatedExecutionStatus(previousState, attemptAlreadyResolved, cacheHit, match.decision);
  if (!attemptAlreadyResolved) {
    const attemptState = cacheHit ? "skipped_cached" : status === "no_match" ? "completed_no_match" : "completed";
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: attemptState, duration_ms: Date.now() - started,
      record_count: snapshot!.row_count, match_count: match.matchedRows.length,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_FSVP_DESCRIPTOR.id, attempt: attemptNumber, state: attemptState, recordCount: snapshot!.row_count, matchCount: match.matchedRows.length });
  }
  return {
    job,
    failed: false,
    evidence,
    typed: evaluatedProviderResult({
      job, providerId: FDA_FSVP_DESCRIPTOR.id, datasetId: FDA_FSVP_DATASET_ID,
      parserVersion: FDA_FSVP_PARSE_VERSION, snapshot: snapshot!, source: evidence,
      status, matchCount: match.matchedRows.length,
    }),
  };
}

async function runFdaVqipProviderOnly(
  writer: TradeResearchWriter,
  job: InternalJobRow,
  workerId: string,
  plan: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  now: () => Date,
  fetchImpl: typeof fetch | undefined,
  log: TradeResearchLogger | undefined,
): Promise<{ job: InternalJobRow; evidence?: TradeResearchSourceEvidence; typed?: TradeResearchProviderResult; failed: boolean }> {
  const previousState = typeof previous?.state === "string" ? previous.state as string : null;
  const attemptAlreadyResolved = previousState === "completed" || previousState === "completed_no_match" || previousState === "skipped_cached";
  const preloadedFresh = await writer.getFreshSnapshotByProvider(FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID, now());
  let snapshot = preloadedFresh;
  let cacheHit = Boolean(preloadedFresh);
  const attemptNumber = attemptAlreadyResolved && snapshot
    ? Number(previous?.attempt_number ?? 1)
    : Number(previous?.attempt_number ?? 0) + 1;
  const attempt = attemptAlreadyResolved && snapshot
    ? previous as { id: string | number }
    : await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  if (!(attemptAlreadyResolved && snapshot)) {
    await writer.appendEvent(job, "provider_attempt_started", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber });
  }
  const started = Date.now();
  try {
    if (!snapshot) {
      const heartbeat = await withHeartbeat(
        writer, job, workerId,
        () => loadFdaVqipSnapshot(writer, now(), fetchImpl),
        (authoritativeJob) => { job = authoritativeJob; },
      );
      job = heartbeat.job;
      snapshot = heartbeat.value.snapshot; cacheHit = heartbeat.value.cacheHit;
    }
  } catch (error) {
    if (isTradeResearchLeaseLostError(error)) throw error;
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : (error instanceof FdaVqipParserError ? error.code : "PROVIDER_FAILURE");
    const failureState = isRetryableProviderFailure({ status, code }) ? "failed_retryable" : "failed_terminal";
    await writer.finishAttempt(job, workerId, String(attempt.id), { state: failureState, safe_error_code: code, duration_ms: Date.now() - started });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber, state: failureState });
    log?.(jobDiagnostic("job_failed", job, { safeErrorCode: code }));
    return { job, failed: true, typed: unevaluatedProviderResult(FDA_VQIP_DESCRIPTOR.id, failureState, code) };
  }
  const candidate = await writer.getCandidate(job);
  const match = matchFdaVqipCompany({
    companyName: candidate.companyName, address: candidate.address, city: candidate.city,
    rows: snapshot!.normalized_rows as unknown as Parameters<typeof matchFdaVqipCompany>[0]["rows"],
  });
  await writer.appendEvent(job, "match_resolved", { providerId: FDA_VQIP_DESCRIPTOR.id, identityResult: match.decision, matchCount: match.matchedRows.length, datasetWatermark: snapshot!.material_hash });
  const companyEvidence: TradeResearchSourceEvidence["companyEvidence"] =
    match.decision === "strong" ? "verified" :
    match.decision === "ambiguous" ? "supporting" :
    match.decision === "none" || match.decision === "rejected" ? "no_verified_match" : "not_available";
  const evidence: TradeResearchSourceEvidence = {
      providerId: "fda-vqip",
      outcome: cacheHit ? "cache_hit" : "completed",
      source: "FDA VQIP",
      datasetPeriod: snapshot!.published_period, retrievedAt: snapshot!.retrieved_at,
      matchedSourceName: match.matchedRows[0]?.firmName, matchedState: match.matchedRows[0]?.stateCode,
      candidateName: candidate.companyName, candidateState: match.candidateState,
      identityDecision: match.decision, matchReason: match.reason,
      coverageExplanation: "The FDA VQIP public list contains firm name, address, email, website only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status.",
      companyEvidence, productEvidence: "not_available", originEvidence: "not_available",
      shipmentEvidence: "not_verified",
      attribution: FDA_VQIP_ATTRIBUTION,
  };
  const status = evaluatedExecutionStatus(previousState, attemptAlreadyResolved, cacheHit, match.decision);
  if (!attemptAlreadyResolved) {
    const attemptState = cacheHit ? "skipped_cached" : status === "no_match" ? "completed_no_match" : "completed";
    await writer.finishAttempt(job, workerId, String(attempt.id), {
      state: attemptState, duration_ms: Date.now() - started,
      record_count: snapshot!.row_count, match_count: match.matchedRows.length,
    });
    await writer.appendEvent(job, "provider_attempt_completed", { providerId: FDA_VQIP_DESCRIPTOR.id, attempt: attemptNumber, state: attemptState, recordCount: snapshot!.row_count, matchCount: match.matchedRows.length });
  }
  return {
    job,
    failed: false,
    evidence,
    typed: evaluatedProviderResult({
      job, providerId: FDA_VQIP_DESCRIPTOR.id, datasetId: FDA_VQIP_DATASET_ID,
      parserVersion: FDA_VQIP_PARSE_VERSION, snapshot: snapshot!, source: evidence,
      status, matchCount: match.matchedRows.length,
    }),
  };
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
