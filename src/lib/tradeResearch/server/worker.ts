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
import { AUTOMATIC_SPEND_RUPEES, type TradeResearchResultSummary } from "../types";
import { TradeResearchWriter, type InternalJobRow, type SnapshotRow } from "../repository";
import { FDA_FSVP_DESCRIPTOR } from "../providers";

const LEASE_HEARTBEAT_MS = 15_000;
const FETCH_TIMEOUT_MS = 25_000;

export interface TradeResearchDrainResult {
  claimed: number;
  completed: number;
  releasedForRetry: number;
  failed: number;
  automaticSpendRupees: 0;
}

interface WorkerDependencies {
  writer: TradeResearchWriter;
  workerId: string;
  maxJobs?: number;
  timeBudgetMs?: number;
  now?: () => Date;
  fetchImpl?: typeof fetch;
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
): Promise<"completed" | "retry" | "failed"> {
  let job = claimed;
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await writer.advance(job, workerId, "planning_sources");
  const plan = await writer.getEligiblePlan(job.id);
  if (!plan) {
    job = await writer.advance(job, workerId, "finalizing");
    await writer.finalize(job, workerId, "completed", "unsupported_coverage", blankResult());
    return "completed";
  }
  if (Number(plan.automatic_spend_rupees) !== 0 || plan.cost_class !== "free") throw new Error("PROVIDER_COST_POLICY_VIOLATION");
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await writer.advance(job, workerId, "screening_sources");
  const previous = await writer.latestAttempt(String(plan.id));
  const attemptNumber = Number(previous?.attempt_number ?? 0) + 1;
  const attempt = await writer.startAttempt(job, String(plan.id), attemptNumber, workerId);
  await writer.appendEvent(job, "provider_attempt_started", { providerId: "fda-fsvp", attempt: attemptNumber });
  const started = Date.now();
  let snapshot: SnapshotRow;
  let cacheHit = false;
  try {
    const heartbeat = await withHeartbeat(writer, job, workerId, () => loadFdaFsvpSnapshot(writer, now(), fetchImpl));
    job = heartbeat.job;
    snapshot = heartbeat.value.snapshot;
    cacheHit = heartbeat.value.cacheHit;
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    const delay = isRetryableProviderFailure({ status, code }) ? retryDelayMs(attemptNumber) : null;
    if (delay !== null) {
      await writer.finishAttempt(String(attempt.id), { state: "retry_wait", safe_error_code: code ?? "TRANSIENT_PROVIDER_ERROR", duration_ms: Date.now() - started });
      await writer.appendEvent(job, "provider_attempt_completed", { providerId: "fda-fsvp", attempt: attemptNumber, state: "retry_wait" });
      await writer.release(job, workerId, new Date(now().getTime() + delay).toISOString());
      return "retry";
    }
    await writer.finishAttempt(String(attempt.id), { state: "failed_terminal", safe_error_code: code ?? (error instanceof FdaFsvpParserError ? error.code : "PROVIDER_FAILURE"), duration_ms: Date.now() - started });
    await writer.finalize(job, workerId, "failed", "failed", blankResult());
    return "failed";
  }
  await writer.finishAttempt(String(attempt.id), {
    state: cacheHit ? "skipped_cached" : "completed", duration_ms: Date.now() - started,
    record_count: snapshot.row_count, match_count: 0,
  });
  await writer.appendEvent(job, "provider_attempt_completed", { providerId: "fda-fsvp", attempt: attemptNumber, state: cacheHit ? "skipped_cached" : "completed", recordCount: snapshot.row_count });
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "cancelled", "cancelled", blankResult());
    return "completed";
  }
  job = await writer.advance(job, workerId, "resolving_company_matches");
  const candidate = await writer.getCandidate(job);
  const match = matchFdaFsvpCompany({ companyName: candidate.companyName, address: candidate.address, city: candidate.city, rows: snapshot.normalized_rows });
  await writer.appendEvent(job, "match_resolved", { providerId: "fda-fsvp", identityResult: match.decision, matchCount: match.matchedRows.length, datasetWatermark: snapshot.material_hash });
  job = await writer.advance(job, workerId, "checking_trade_activity");
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
  job = await writer.advance(job, workerId, "finalizing");
  if (await writer.isCancellationRequested(job.batch_id)) {
    await writer.finalize(job, workerId, "partial", "partial", result);
  } else if (match.decision === "strong") {
    await writer.finalize(job, workerId, "completed", "official_importer_program_corroboration", result);
  } else if (match.decision === "ambiguous") {
    await writer.finalize(job, workerId, "needs_review", "needs_review", result);
  } else {
    await writer.finalize(job, workerId, "completed", "no_verified_evidence", result);
  }
  return "completed";
}

export async function drainTradeResearch(deps: WorkerDependencies): Promise<TradeResearchDrainResult> {
  const maxJobs = Math.max(1, Math.min(2, deps.maxJobs ?? 2));
  const budget = Math.max(5_000, Math.min(50_000, deps.timeBudgetMs ?? 45_000));
  const started = Date.now();
  const result: TradeResearchDrainResult = { claimed: 0, completed: 0, releasedForRetry: 0, failed: 0, automaticSpendRupees: 0 };
  while (result.claimed < maxJobs && Date.now() - started < budget) {
    const job = await deps.writer.claim(deps.workerId);
    if (!job) break;
    result.claimed += 1;
    const outcome = await processTradeResearchJob(deps.writer, job, deps.workerId, deps.now ?? (() => new Date()), deps.fetchImpl);
    if (outcome === "retry") result.releasedForRetry += 1;
    else if (outcome === "failed") result.failed += 1;
    else result.completed += 1;
  }
  return result;
}
