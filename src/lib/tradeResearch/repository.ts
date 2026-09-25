import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  AUTOMATIC_SPEND_RUPEES,
  type TradeResearchBatchSnapshot,
  type TradeResearchJobSnapshot,
  type TradeResearchOutcome,
  type TradeResearchResultSummary,
  type TradeResearchStage,
  type TradeResearchStatus,
  TRADE_RESEARCH_STAGES,
} from "./types";

type Row = Record<string, unknown>;

function singleRpcRow<T extends Row>(data: unknown): T | undefined {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRADE_RESEARCH_STATUSES = new Set<TradeResearchStatus>([
  "queued", "running", "cancel_requested", "completed", "partial", "needs_review", "failed", "cancelled",
]);
const TRADE_RESEARCH_OUTCOMES = new Set<TradeResearchOutcome>([
  "trade_activity_only", "official_importer_program_corroboration", "no_verified_evidence", "unsupported_coverage",
  "needs_review", "partial", "failed", "cancelled",
]);
const TERMINAL_TRADE_RESEARCH_STATUSES = new Set<TradeResearchStatus>([
  "completed", "partial", "needs_review", "failed", "cancelled",
]);
const TRADE_RESEARCH_STAGE_SET = new Set<TradeResearchStage>(TRADE_RESEARCH_STAGES);
const PROVIDER_ATTEMPT_STATES = new Set([
  "planned", "queued", "running", "completed", "completed_no_match", "skipped_cached", "skipped_quota",
  "skipped_cost", "skipped_terms", "failed_retryable", "retry_wait", "failed_terminal", "cancelled",
]);
const TRADE_RESEARCH_EVENT_TYPES = new Set([
  "batch_created", "job_created", "job_started", "stage_changed", "provider_planned", "provider_attempt_started",
  "provider_attempt_completed", "provider_attempt_skipped", "match_resolved", "job_partial", "job_completed",
  "job_failed", "job_cancel_requested", "job_cancelled", "job_reclaimed", "batch_completed",
]);
const TRADE_RESEARCH_GOALS = new Set(["screen_trade_activity", "find_target_product", "check_india_origin"]);
const PLAN_ELIGIBILITY = new Set(["eligible", "ineligible"]);
const PLAN_COST_CLASSES = new Set(["free", "free_quota", "manual_free", "paid", "unsupported"]);

type SqlContractType = "uuid" | "bigint" | "integer" | "timestamptz" | "jsonb" | "constrained_text";

function valueCategory(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export class TradeResearchContractError extends Error {
  constructor(
    readonly fieldName: string,
    readonly expectedSqlType: SqlContractType,
    readonly suppliedCategory: string,
  ) {
    super(`TRADE_RESEARCH_CONTRACT_INVALID_${expectedSqlType.toUpperCase()}`);
    this.name = "TradeResearchContractError";
  }
}

function requireUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TradeResearchContractError(fieldName, "uuid", valueCategory(value));
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, fieldName: string, sqlType: "bigint" | "integer" = "bigint"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TradeResearchContractError(fieldName, sqlType, valueCategory(value));
  }
  return value;
}

function requireTimestamp(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TradeResearchContractError(fieldName, "timestamptz", valueCategory(value));
  }
  return value;
}

function requireJson(value: unknown, fieldName: string): void {
  try {
    if (value === undefined || JSON.stringify(value) === undefined) throw new Error("not JSON");
  } catch {
    throw new TradeResearchContractError(fieldName, "jsonb", valueCategory(value));
  }
}

function requireConstrainedText<T extends string>(value: unknown, fieldName: string, allowed: ReadonlySet<T>): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new TradeResearchContractError(fieldName, "constrained_text", valueCategory(value));
  }
  return value as T;
}

function requireText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TradeResearchContractError(fieldName, "constrained_text", valueCategory(value));
  }
  return value;
}

function validateAttemptPatch(patch: Row): void {
  if (patch.state !== undefined) requireConstrainedText(patch.state, "attempt.state", PROVIDER_ATTEMPT_STATES);
  for (const field of ["duration_ms", "record_count", "match_count"] as const) {
    if (patch[field] !== undefined && patch[field] !== null) requireNonNegativeInteger(patch[field], `attempt.${field}`, "integer");
  }
}

function validateSnapshotInput(input: Row): void {
  requireText(input.provider_id, "snapshot.provider_id");
  requireText(input.dataset_id, "snapshot.dataset_id");
  requireText(input.published_period, "snapshot.published_period");
  requireText(input.source_url, "snapshot.source_url");
  requireText(input.material_hash, "snapshot.material_hash");
  requireTimestamp(input.fetched_at, "snapshot.fetched_at");
  requireTimestamp(input.retrieved_at, "snapshot.retrieved_at");
  requireTimestamp(input.expires_at, "snapshot.expires_at");
  requireNonNegativeInteger(input.row_count, "snapshot.row_count", "integer");
  requireJson(input.coverage, "snapshot.coverage");
  requireJson(input.safe_metadata, "snapshot.safe_metadata");
  requireJson(input.normalized_rows, "snapshot.normalized_rows");
  requireConstrainedText(input.status, "snapshot.status", new Set(["ready", "failed"]));
}

function validateCreateBatchInput(input: Row): void {
  requireUuid(input.workspaceId, "p_input.workspaceId");
  requireUuid(input.createdBy, "p_input.createdBy");
  requireConstrainedText(input.requestedGoal, "p_input.requestedGoal", TRADE_RESEARCH_GOALS);
  requireJson(input, "p_input");
  if (!Array.isArray(input.jobs) || input.jobs.length === 0) {
    throw new TradeResearchContractError("p_input.jobs", "jsonb", valueCategory(input.jobs));
  }
  for (const [jobIndex, candidate] of input.jobs.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}]`, "jsonb", valueCategory(candidate));
    }
    const job = candidate as Row;
    requireUuid(job.candidateId, `p_input.jobs[${jobIndex}].candidateId`);
    if (job.supersedesJobId !== "" && job.supersedesJobId !== null && job.supersedesJobId !== undefined) {
      requireUuid(job.supersedesJobId, `p_input.jobs[${jobIndex}].supersedesJobId`);
    }
    if (typeof job.productId !== "string") {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].productId`, "constrained_text", valueCategory(job.productId));
    }
    if (typeof job.countryCode !== "string" || !/^[A-Z]{2}$/.test(job.countryCode)) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].countryCode`, "constrained_text", valueCategory(job.countryCode));
    }
    if (!Array.isArray(job.plans)) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].plans`, "jsonb", valueCategory(job.plans));
    }
    for (const [planIndex, item] of job.plans.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].plans[${planIndex}]`, "jsonb", valueCategory(item));
      }
      const plan = item as Row;
      requireText(plan.providerId, `p_input.jobs[${jobIndex}].plans[${planIndex}].providerId`);
      requireConstrainedText(plan.eligibility, `p_input.jobs[${jobIndex}].plans[${planIndex}].eligibility`, PLAN_ELIGIBILITY);
      requireConstrainedText(plan.costClass, `p_input.jobs[${jobIndex}].plans[${planIndex}].costClass`, PLAN_COST_CLASSES);
      requireNonNegativeInteger(plan.sequence, `p_input.jobs[${jobIndex}].plans[${planIndex}].sequence`, "integer");
    }
  }
}

function isNullComposite(row: Row): boolean {
  const values = Object.values(row);
  return values.length > 0 && values.every((value) => value === null);
}

function mapInternalJobRow(data: unknown): InternalJobRow | undefined {
  const row = singleRpcRow<Row>(data);
  // A scalar PostgreSQL composite that is SQL NULL is represented by
  // PostgREST as one object whose attributes are all null. It means no row.
  if (!row || isNullComposite(row)) return undefined;
  requireUuid(row.id, "job.id");
  requireUuid(row.batch_id, "job.batch_id");
  requireUuid(row.workspace_id, "job.workspace_id");
  requireUuid(row.candidate_id, "job.candidate_id");
  if (row.product_id !== null && row.product_id !== undefined && typeof row.product_id !== "string") {
    throw new TradeResearchContractError("job.product_id", "constrained_text", valueCategory(row.product_id));
  }
  if (typeof row.country_code !== "string" || !/^[A-Z]{2}$/.test(row.country_code)) {
    throw new TradeResearchContractError("job.country_code", "constrained_text", valueCategory(row.country_code));
  }
  requireConstrainedText(row.status, "job.status", TRADE_RESEARCH_STATUSES);
  requireConstrainedText(row.stage, "job.stage", TRADE_RESEARCH_STAGE_SET);
  requireNonNegativeInteger(row.revision, "job.revision");
  return row as InternalJobRow;
}

function requireInternalJobRow(job: InternalJobRow): void {
  if (!mapInternalJobRow(job)) {
    throw new TradeResearchContractError("job.id", "uuid", "null_composite");
  }
}

const EMPTY_RESULT: TradeResearchResultSummary = {
  officialProgramEvidence: "not_checked",
  productEvidence: "not_available",
  indiaOrigin: "not_verified",
  shipmentEvidence: "not_verified",
  sourcesChecked: 0,
  automaticSpendRupees: AUTOMATIC_SPEND_RUPEES,
};

function zero(value: unknown): 0 {
  if (Number(value) !== 0) throw new Error("PERSISTED_AUTOMATIC_SPEND_NONZERO");
  return 0;
}

export function mapTradeResearchBatch(row: Row): TradeResearchBatchSnapshot {
  return {
    id: String(row.id), status: row.status as TradeResearchStatus,
    requestedGoal: row.requested_goal as TradeResearchBatchSnapshot["requestedGoal"],
    totalJobs: Number(row.total_jobs), queuedCount: Number(row.queued_count), runningCount: Number(row.running_count),
    completedCount: Number(row.completed_count), partialCount: Number(row.partial_count),
    needsReviewCount: Number(row.needs_review_count), failedCount: Number(row.failed_count), cancelledCount: Number(row.cancelled_count),
    corroboratedCount: Number(row.corroborated_count),
    automaticSpendRupees: zero(row.automatic_spend_rupees), createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export function mapTradeResearchJob(row: Row): TradeResearchJobSnapshot {
  const raw = row.result_summary && typeof row.result_summary === "object" ? row.result_summary as Partial<TradeResearchResultSummary> : {};
  return {
    id: String(row.id), batchId: String(row.batch_id), candidateId: String(row.candidate_id),
    productId: row.product_id ? String(row.product_id) : undefined, countryCode: String(row.country_code),
    requestedGoal: row.requested_goal as TradeResearchJobSnapshot["requestedGoal"], status: row.status as TradeResearchStatus,
    stage: row.stage as TradeResearchStage, outcome: row.outcome ? row.outcome as TradeResearchOutcome : undefined,
    revision: Number(row.revision), automaticSpendRupees: zero(row.automatic_spend_rupees),
    result: { ...EMPTY_RESULT, ...raw, automaticSpendRupees: zero(raw.automaticSpendRupees ?? 0) },
    createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export function createTradeResearchReadRepository(client: SupabaseClient, workspaceId: string) {
  return {
    async getBatch(id: string): Promise<TradeResearchBatchSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_batches").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchBatch(data as Row) : undefined;
    },
    async getLatestBatch(): Promise<TradeResearchBatchSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_batches").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchBatch(data as Row) : undefined;
    },
    async getJob(id: string): Promise<TradeResearchJobSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchJob(data as Row) : undefined;
    },
    async getLatestJobForCandidate(candidateId: string): Promise<TradeResearchJobSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchJob(data as Row) : undefined;
    },
    async getLatestJobsForCandidates(candidateIds: readonly string[]): Promise<Map<string, TradeResearchJobSnapshot>> {
      if (!candidateIds.length) return new Map();
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).in("candidate_id", [...candidateIds]).order("created_at", { ascending: false });
      if (error) throw error;
      const result = new Map<string, TradeResearchJobSnapshot>();
      for (const row of data ?? []) {
        const mapped = mapTradeResearchJob(row as Row);
        if (!result.has(mapped.candidateId)) result.set(mapped.candidateId, mapped);
      }
      return result;
    },
    async listJobs(batchId: string): Promise<TradeResearchJobSnapshot[]> {
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).eq("batch_id", batchId).order("created_at");
      if (error) throw error;
      return (data ?? []).map((row) => mapTradeResearchJob(row as Row));
    },
  };
}

export interface InternalJobRow extends Row {
  id: string; batch_id: string; workspace_id: string; candidate_id: string; product_id?: string;
  country_code: string; status: TradeResearchStatus; stage: TradeResearchStage; revision: number;
}

export interface SnapshotRow extends Row {
  id: string; provider_id: string; dataset_id: string; published_period: string; source_url: string;
  etag?: string; last_modified?: string; material_hash: string; retrieved_at: string; expires_at: string;
  row_count: number; normalized_rows: Array<{ companyName: string; stateCode: string }>;
}

export class TradeResearchWriter {
  constructor(private readonly client: SupabaseClient) {}

  async createBatch(input: Row): Promise<TradeResearchBatchSnapshot> {
    validateCreateBatchInput(input);
    const { data, error } = await this.client.rpc("create_buyer_trade_research_batch", { p_input: input });
    const row = singleRpcRow<Row>(data);
    if (error || !row) throw error ?? new Error("TRADE_RESEARCH_BATCH_CREATE_FAILED");
    return mapTradeResearchBatch(row);
  }
  async cancelBatch(batchId: string, workspaceId: string): Promise<TradeResearchBatchSnapshot | undefined> {
    requireUuid(batchId, "p_batch_id");
    requireUuid(workspaceId, "p_workspace_id");
    const { data, error } = await this.client.rpc("request_buyer_trade_research_batch_cancel", { p_batch_id: batchId, p_workspace_id: workspaceId });
    if (error) throw error;
    const row = singleRpcRow<Row>(data);
    return row ? mapTradeResearchBatch(row) : undefined;
  }
  async claim(worker: string): Promise<InternalJobRow | undefined> {
    requireText(worker, "p_worker");
    const { data, error } = await this.client.rpc("claim_buyer_trade_research_job", { p_worker: worker });
    if (error) throw error;
    const row = mapInternalJobRow(data);
    if (!row) return undefined;
    if (row.status !== "running" || row.lease_owner !== worker) {
      throw new TradeResearchContractError("claim.status_or_lease", "constrained_text", "invalid_state");
    }
    return row;
  }
  async advance(job: InternalJobRow, worker: string, stage: TradeResearchStage): Promise<InternalJobRow> {
    requireInternalJobRow(job);
    requireConstrainedText(stage, "p_stage", TRADE_RESEARCH_STAGE_SET);
    const { data, error } = await this.client.rpc("advance_buyer_trade_research_job", {
      p_job_id: job.id, p_worker: worker, p_revision: job.revision, p_stage: stage,
    });
    const row = mapInternalJobRow(data);
    if (error || !row) throw error ?? new Error("JOB_LEASE_LOST");
    return row;
  }
  async heartbeat(job: InternalJobRow, worker: string): Promise<InternalJobRow> {
    requireInternalJobRow(job);
    const { data, error } = await this.client.rpc("heartbeat_buyer_trade_research_job", {
      p_job_id: job.id, p_worker: worker, p_revision: job.revision,
    });
    const row = mapInternalJobRow(data);
    if (error || !row) throw error ?? new Error("JOB_LEASE_LOST");
    return row;
  }
  async release(job: InternalJobRow, worker: string, nextAttemptAt: string): Promise<void> {
    requireInternalJobRow(job);
    requireTimestamp(nextAttemptAt, "p_next_attempt_at");
    const { data, error } = await this.client.rpc("release_buyer_trade_research_job", { p_job_id: job.id, p_worker: worker, p_revision: job.revision, p_next_attempt_at: nextAttemptAt });
    if (error || !mapInternalJobRow(data)) throw error ?? new Error("JOB_LEASE_LOST");
  }
  async finalize(job: InternalJobRow, worker: string, status: TradeResearchStatus, outcome: TradeResearchOutcome, result: TradeResearchResultSummary): Promise<void> {
    requireInternalJobRow(job);
    requireConstrainedText(status, "p_status", TERMINAL_TRADE_RESEARCH_STATUSES);
    requireConstrainedText(outcome, "p_outcome", TRADE_RESEARCH_OUTCOMES);
    requireJson(result, "p_result");
    if (result.automaticSpendRupees !== 0) throw new Error("AUTOMATIC_SPEND_MUST_REMAIN_ZERO");
    const { data, error } = await this.client.rpc("finalize_buyer_trade_research_job", {
      p_job_id: job.id, p_worker: worker, p_status: status, p_outcome: outcome, p_result: result,
    });
    if (error || !mapInternalJobRow(data)) throw error ?? new Error("JOB_LEASE_LOST");
  }
  async recoverClaimedJob(jobId: string, worker: string, nextAttemptAt: string, safeErrorCode: string): Promise<"requeued" | "cancelled" | "lease_lost"> {
    requireUuid(jobId, "job_id");
    requireTimestamp(nextAttemptAt, "next_attempt_at");
    const { data, error } = await this.client.from("buyer_trade_research_jobs").select("*")
      .eq("id", jobId).eq("lease_owner", worker).in("status", ["running", "cancel_requested"]).maybeSingle();
    if (error) throw error;
    const job = mapInternalJobRow(data);
    if (!job) return "lease_lost";
    const { data: attempt, error: attemptError } = await this.client.from("buyer_trade_research_attempts").select("id")
      .eq("job_id", jobId).eq("lease_owner", worker).eq("state", "running").maybeSingle();
    if (attemptError) throw attemptError;
    if (attempt) {
      await this.finishAttempt(requireUuid(attempt.id, "attempt.id"), { state: "failed_retryable", safe_error_code: safeErrorCode });
    }
    if (job.status === "cancel_requested") {
      await this.finalize(job, worker, "cancelled", "cancelled", EMPTY_RESULT);
      return "cancelled";
    }
    await this.release(job, worker, nextAttemptAt);
    return "requeued";
  }
  async isCancellationRequested(batchId: string): Promise<boolean> {
    requireUuid(batchId, "buyer_trade_research_batches.id");
    const { data, error } = await this.client.from("buyer_trade_research_batches").select("cancel_requested_at").eq("id", batchId).single();
    if (error) throw error;
    return Boolean(data.cancel_requested_at);
  }
  async getCandidate(job: InternalJobRow): Promise<BuyerCandidate> {
    requireInternalJobRow(job);
    const { data, error } = await this.client.from("buyer_candidates").select("*").eq("id", job.candidate_id).eq("workspace_id", job.workspace_id).single();
    if (error) throw error;
    return {
      id: data.id, companyName: data.company_name, website: data.website ?? undefined, domain: data.domain ?? undefined,
      country: data.country, city: data.city ?? undefined, address: data.address ?? undefined, industry: data.industry ?? undefined,
      buyerType: data.buyer_type ?? undefined, isImporter: data.is_importer ?? undefined, isDistributor: data.is_distributor ?? undefined,
      discoveryStatus: data.discovery_status, reviewStatus: data.review_status,
    };
  }
  async getEligiblePlan(jobId: string): Promise<Row | undefined> {
    requireUuid(jobId, "buyer_trade_research_provider_plans.job_id");
    const { data, error } = await this.client.from("buyer_trade_research_provider_plans").select("*").eq("job_id", jobId).eq("eligibility", "eligible").order("sequence").limit(1).maybeSingle();
    if (error) throw error;
    return data as Row | undefined;
  }
  async latestAttempt(planId: string): Promise<Row | undefined> {
    requireUuid(planId, "buyer_trade_research_attempts.provider_plan_id");
    const { data, error } = await this.client.from("buyer_trade_research_attempts").select("*").eq("provider_plan_id", planId).order("attempt_number", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as Row | undefined;
  }
  async startAttempt(job: InternalJobRow, planId: string, attemptNumber: number, worker: string): Promise<Row> {
    requireInternalJobRow(job);
    requireUuid(planId, "provider_plan_id");
    requireNonNegativeInteger(attemptNumber, "attempt_number", "integer");
    if (attemptNumber < 1 || attemptNumber > 3) {
      throw new TradeResearchContractError("attempt_number", "integer", "out_of_range");
    }
    const now = new Date();
    const { data, error } = await this.client.from("buyer_trade_research_attempts").insert({
      provider_plan_id: planId, job_id: job.id, workspace_id: job.workspace_id, attempt_number: attemptNumber,
      state: "running", lease_owner: worker, lease_expires_at: new Date(now.getTime() + 60_000).toISOString(), heartbeat_at: now.toISOString(), started_at: now.toISOString(), automatic_spend_rupees: 0,
    }).select("*").single();
    if (error) throw error;
    return data as Row;
  }
  async finishAttempt(id: string, patch: Row): Promise<void> {
    requireUuid(id, "buyer_trade_research_attempts.id");
    requireJson(patch, "attempt_patch");
    validateAttemptPatch(patch);
    const { error } = await this.client.from("buyer_trade_research_attempts").update({ ...patch, automatic_spend_rupees: 0, lease_owner: null, lease_expires_at: null, finished_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }
  async appendEvent(job: InternalJobRow, eventType: string, safeDetails: Row = {}): Promise<void> {
    requireInternalJobRow(job);
    requireConstrainedText(eventType, "event_type", TRADE_RESEARCH_EVENT_TYPES);
    requireJson(safeDetails, "safe_details");
    const { error } = await this.client.from("buyer_trade_research_events").insert({
      workspace_id: job.workspace_id, batch_id: job.batch_id, job_id: job.id,
      event_type: eventType, safe_details: safeDetails, automatic_spend_rupees: 0,
    });
    if (error) throw error;
  }
  async getFreshSnapshot(now = new Date()): Promise<SnapshotRow | undefined> {
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").select("*").eq("provider_id", "fda-fsvp").eq("dataset_id", "fsvp-participant-list").eq("status", "ready").gte("expires_at", now.toISOString()).order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as SnapshotRow | undefined;
  }
  async getLatestSnapshot(): Promise<SnapshotRow | undefined> {
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").select("*").eq("provider_id", "fda-fsvp").eq("dataset_id", "fsvp-participant-list").eq("status", "ready").order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as SnapshotRow | undefined;
  }
  async saveSnapshot(input: Row): Promise<SnapshotRow> {
    validateSnapshotInput(input);
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").upsert(input, { onConflict: "provider_id,dataset_id,material_hash" }).select("*").single();
    if (error) throw error;
    return data as SnapshotRow;
  }
  async refreshSnapshotExpiry(id: string, retrievedAt: string, expiresAt: string): Promise<SnapshotRow> {
    requireUuid(id, "buyer_trade_source_snapshots.id");
    requireTimestamp(retrievedAt, "retrieved_at");
    requireTimestamp(expiresAt, "expires_at");
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").update({ retrieved_at: retrievedAt, expires_at: expiresAt }).eq("id", id).select("*").single();
    if (error) throw error;
    return data as SnapshotRow;
  }
}
