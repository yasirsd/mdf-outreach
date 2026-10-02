import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { canonicalizeResearchContext, fingerprintResearchContext } from "./context";

/** TH06 Step 0D — lookup-basis values the aggregator trusts for authoritative not_found. */
export type ThaiManualEvidenceLookupBasis =
  | "juristic_number"
  | "license_number"
  | "exact_legal_name"
  | "name_search"
  | "other";
import { aggregateTradeResearchEvidence } from "./aggregation";
import { assertProviderResultCheckpoint } from "./checkpoints";
import {
  projectProviderOutcomes,
  validateProviderResultSnapshots,
  withProviderOutcomeProjection,
  type ProviderOutcomeAttempt,
  type ProviderOutcomePlan,
  type ProviderOutcomeSnapshot,
} from "./providerOutcomes";
import {
  AUTOMATIC_SPEND_RUPEES,
  type ResearchContext,
  type TradeResearchBatchSnapshot,
  type TradeResearchJobSnapshot,
  type TradeResearchOutcome,
  type TradeResearchProviderResult,
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
const CONTEXT_FINGERPRINT_PATTERN = /^trctx-v1:[0-9a-f]{64}$/;
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

export class TradeResearchLeaseLostError extends Error {
  readonly code = "STALE_JOB_REVISION";

  constructor(readonly databaseError?: unknown) {
    super("JOB_LEASE_LOST");
    this.name = "TradeResearchLeaseLostError";
  }
}

export function isTradeResearchLeaseLostError(error: unknown): error is TradeResearchLeaseLostError {
  return error instanceof TradeResearchLeaseLostError;
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
  const plannerVersion = requireText(input.plannerVersion, "p_input.plannerVersion");
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
    if (!job.productId.trim()) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].productId`, "constrained_text", "empty_string");
    }
    if (typeof job.countryCode !== "string" || !/^[A-Z]{2}$/.test(job.countryCode)) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].countryCode`, "constrained_text", valueCategory(job.countryCode));
    }
    if (!Array.isArray(job.plans)) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].plans`, "jsonb", valueCategory(job.plans));
    }
    if (!job.context || typeof job.context !== "object" || Array.isArray(job.context)) {
      throw new TradeResearchContractError(`p_input.jobs[${jobIndex}].context`, "jsonb", valueCategory(job.context));
    }
    const context = canonicalizeResearchContext(job.context as ResearchContext);
    const contextFingerprint = requireText(
      job.contextFingerprint,
      `p_input.jobs[${jobIndex}].contextFingerprint`,
    );
    if (!CONTEXT_FINGERPRINT_PATTERN.test(contextFingerprint)
        || fingerprintResearchContext(context) !== contextFingerprint) {
      throw new TradeResearchContractError(
        `p_input.jobs[${jobIndex}].contextFingerprint`,
        "constrained_text",
        "invalid_fingerprint",
      );
    }
    if (context.workspaceId !== input.workspaceId
        || context.candidateId !== job.candidateId
        || context.productId !== job.productId
        || context.marketCountryCode !== job.countryCode
        || context.researchGoal !== input.requestedGoal
        || context.providerPlanVersion !== plannerVersion) {
      throw new TradeResearchContractError(
        `p_input.jobs[${jobIndex}].context`,
        "jsonb",
        "authoritative_field_mismatch",
      );
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

function persistedResearchContext(row: Row): {
  context?: ResearchContext;
  contextFingerprint?: string;
} {
  const rawContext = row.research_context;
  const rawFingerprint = row.context_fingerprint;
  const contextMissing = rawContext === null || rawContext === undefined;
  const fingerprintMissing = rawFingerprint === null || rawFingerprint === undefined;
  if (contextMissing && fingerprintMissing) return {};
  if (contextMissing !== fingerprintMissing
      || !rawContext || typeof rawContext !== "object" || Array.isArray(rawContext)
      || typeof rawFingerprint !== "string" || !CONTEXT_FINGERPRINT_PATTERN.test(rawFingerprint)) {
    throw new TradeResearchContractError("job.research_context", "jsonb", "invalid_context_pair");
  }
  try {
    const context = canonicalizeResearchContext(rawContext as ResearchContext);
    if (fingerprintResearchContext(context) !== rawFingerprint) {
      throw new Error("fingerprint mismatch");
    }
    return { context, contextFingerprint: rawFingerprint };
  } catch {
    throw new TradeResearchContractError("job.research_context", "jsonb", "invalid_context");
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
  persistedResearchContext(row);
  return row as InternalJobRow;
}

function requireInternalJobRow(job: InternalJobRow): void {
  if (!mapInternalJobRow(job)) {
    throw new TradeResearchContractError("job.id", "uuid", "null_composite");
  }
}

function isStaleMutationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const combined = `${String(candidate.message ?? "")} ${String(candidate.details ?? "")}`;
  return candidate.code === "P0001"
    && (combined.includes("STALE_JOB_REVISION") || combined.includes("ATTEMPT_STATE_CONFLICT"));
}

function authoritativeJobMutation(data: unknown, error: unknown): InternalJobRow {
  if (error) {
    if (isStaleMutationError(error)) throw new TradeResearchLeaseLostError(error);
    throw error;
  }
  const row = mapInternalJobRow(data);
  if (!row) throw new TradeResearchLeaseLostError();
  return row;
}

const EMPTY_RESULT: TradeResearchResultSummary = {
  officialProgramEvidence: "not_checked",
  productEvidence: "not_available",
  indiaOrigin: "not_verified",
  originEvidence: "not_available",
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
  const { context: _untrustedContext, contextFingerprint: _untrustedFingerprint, ...compatibleRaw } = raw;
  const stored = persistedResearchContext(row);
  return {
    id: String(row.id), batchId: String(row.batch_id), candidateId: String(row.candidate_id),
    productId: row.product_id ? String(row.product_id) : undefined, countryCode: String(row.country_code),
    requestedGoal: row.requested_goal as TradeResearchJobSnapshot["requestedGoal"], status: row.status as TradeResearchStatus,
    stage: row.stage as TradeResearchStage, outcome: row.outcome ? row.outcome as TradeResearchOutcome : undefined,
    revision: Number(row.revision), automaticSpendRupees: zero(row.automatic_spend_rupees),
    context: stored.context,
    contextFingerprint: stored.contextFingerprint,
    result: {
      ...EMPTY_RESULT,
      ...compatibleRaw,
      ...(stored.context ? {
        context: stored.context,
        contextFingerprint: stored.contextFingerprint,
      } : {}),
      automaticSpendRupees: zero(raw.automaticSpendRupees ?? 0),
    },
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
    async getLatestJobForContext(candidateId: string, contextFingerprint: string): Promise<TradeResearchJobSnapshot | undefined> {
      requireUuid(candidateId, "buyer_trade_research_jobs.candidate_id");
      if (!CONTEXT_FINGERPRINT_PATTERN.test(contextFingerprint)) {
        throw new TradeResearchContractError(
          "buyer_trade_research_jobs.context_fingerprint",
          "constrained_text",
          valueCategory(contextFingerprint),
        );
      }
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*")
        .eq("workspace_id", workspaceId)
        .eq("candidate_id", candidateId)
        .eq("context_fingerprint", contextFingerprint)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchJob(data as Row) : undefined;
    },
    async getLatestJobsForContexts(
      contexts: readonly { candidateId: string; contextFingerprint: string }[],
    ): Promise<Map<string, TradeResearchJobSnapshot>> {
      if (!contexts.length) return new Map();
      for (const item of contexts) {
        requireUuid(item.candidateId, "buyer_trade_research_jobs.candidate_id");
        if (!CONTEXT_FINGERPRINT_PATTERN.test(item.contextFingerprint)) {
          throw new TradeResearchContractError(
            "buyer_trade_research_jobs.context_fingerprint",
            "constrained_text",
            valueCategory(item.contextFingerprint),
          );
        }
      }
      const candidateIds = [...new Set(contexts.map((item) => item.candidateId))];
      const fingerprints = [...new Set(contexts.map((item) => item.contextFingerprint))];
      const requestedPairs = new Set(contexts.map((item) => `${item.candidateId}:${item.contextFingerprint}`));
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*")
        .eq("workspace_id", workspaceId)
        .in("candidate_id", candidateIds)
        .in("context_fingerprint", fingerprints)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const result = new Map<string, TradeResearchJobSnapshot>();
      for (const row of data ?? []) {
        const mapped = mapTradeResearchJob(row as Row);
        if (!mapped.contextFingerprint) continue;
        if (!requestedPairs.has(`${mapped.candidateId}:${mapped.contextFingerprint}`)) continue;
        if (!result.has(mapped.contextFingerprint)) result.set(mapped.contextFingerprint, mapped);
      }
      return result;
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
  id: string; batch_id: string; workspace_id: string; candidate_id: string; product_id?: string | null;
  country_code: string; status: TradeResearchStatus; stage: TradeResearchStage; revision: number;
  research_context?: ResearchContext | null;
  context_fingerprint?: string | null;
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
    return authoritativeJobMutation(data, error);
  }
  async heartbeat(job: InternalJobRow, worker: string): Promise<InternalJobRow> {
    requireInternalJobRow(job);
    const { data, error } = await this.client.rpc("heartbeat_buyer_trade_research_job", {
      p_job_id: job.id, p_worker: worker, p_revision: job.revision,
    });
    return authoritativeJobMutation(data, error);
  }
  async release(job: InternalJobRow, worker: string, nextAttemptAt: string): Promise<InternalJobRow> {
    requireInternalJobRow(job);
    requireTimestamp(nextAttemptAt, "p_next_attempt_at");
    const { data, error } = await this.client.rpc("release_buyer_trade_research_job", { p_job_id: job.id, p_worker: worker, p_revision: job.revision, p_next_attempt_at: nextAttemptAt });
    return authoritativeJobMutation(data, error);
  }
  /**
   * T12 reconciliation reader — surfaces terminal research jobs that
   * have NO row in `buyer_trade_research_certifications` for the
   * CURRENT classifier version, so
   * `reconcilePendingResearchCertifications` can heal transient
   * certification-write losses AND allow the v2 remediation to
   * re-classify jobs that only have historical v1 rows.
   *
   * Delegates to the
   * `select_terminal_research_jobs_missing_current_certification`
   * RPC (migration 0033), which performs a Postgres NOT EXISTS
   * anti-join on `(job_id, workspace_id, classifier_version)`:
   *
   *   * LIMIT applies to MISSING rows, not to arbitrary terminal
   *     rows. There is no application-side "scan cap" to starve
   *     older uncertified jobs behind a large pool of newer
   *     certified ones — every missing row is discoverable in one
   *     bounded invocation.
   *
   *   * Ordering is `completed_at DESC, id DESC`, a total
   *     deterministic key that never skips rows across page
   *     boundaries even when timestamps repeat.
   *
   *   * Workspace safety uses the `(job_id, workspace_id)` pair.
   *     Reconciliation is intentionally a service-role, cross-
   *     workspace internal worker. Row ownership is preserved: the
   *     RPC returns each job's own workspace_id, and the certify
   *     write downstream inserts that same value verbatim (never a
   *     substituted one). Authenticated-user RLS on the
   *     certifications table is unchanged.
   *
   * Never reopens or mutates the terminal job.
   */
  async listTerminalJobsMissingCertification(limit: number): Promise<Array<{
    job: InternalJobRow;
    resultSummary: TradeResearchResultSummary;
  }>> {
    requireNonNegativeInteger(limit, "limit", "integer");
    if (limit === 0) return [];
    const clamped = Math.max(1, Math.min(50, limit));
    const { CERTIFICATION_SCHEMA_VERSION } = await import("./certification");
    const { data, error } = await this.client.rpc(
      "select_terminal_research_jobs_missing_current_certification",
      { p_limit: clamped, p_classifier_version: CERTIFICATION_SCHEMA_VERSION },
    );
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => {
      const job = row as unknown as InternalJobRow;
      const resultSummary = ((row as Row).result_summary ?? {}) as TradeResearchResultSummary;
      return { job, resultSummary };
    });
  }

  /**
   * T12 — certify a finalized research job. Idempotent: repeated calls
   * for the same material state collapse to a single row via the
   * (job_id, snapshot_fingerprint) unique constraint. Never mutates
   * the finalized job itself.
   *
   * Authoritative context: the classifier consumes the row-level
   * `research_context` and `context_fingerprint` columns directly
   * (fix for the v1 missing-context bug where the classifier read
   * only the `result_summary` JSON blob). Every persisted row emits
   * the CURRENT `classifier_version` (migration 0033) so v2 rows
   * co-exist with historical v1 rows without violating the
   * append-only identity guard.
   */
  async certifyResearchJob(job: InternalJobRow, result: TradeResearchResultSummary): Promise<{
    outcome: "inserted" | "already_certified";
    status: "certified" | "legacy_unverified" | "quarantined";
    snapshotFingerprint: string;
    classifierVersion: string;
  }> {
    requireInternalJobRow(job);
    // Local imports to avoid a repository→certification cycle at load
    // time; the certification module has no runtime dependencies here.
    const { classifyResearchJobForCertification, CERTIFICATION_SCHEMA_VERSION } = await import("./certification");
    const jobLike = {
      status: job.status as string,
      outcome: (job.outcome ?? null) as string | null,
      workspaceId: job.workspace_id,
      candidateId: job.candidate_id,
      productId: (job.product_id ?? null) as string | null,
      marketCountryCode: job.country_code,
      researchGoal: (job.requested_goal ?? "screen_trade_activity") as "screen_trade_activity" | "find_target_product" | "check_india_origin",
      // Row-level authoritative context columns (fix for BUG 1). The
      // classifier prefers these over the result_summary JSON blob.
      research_context: (job.research_context ?? null) as ResearchContext | null,
      context_fingerprint: (job.context_fingerprint ?? null) as string | null,
      result_summary: result,
    };
    const decision = classifyResearchJobForCertification(jobLike);
    const nowIso = new Date().toISOString();
    const row = {
      workspace_id: job.workspace_id,
      job_id: job.id,
      candidate_id: job.candidate_id,
      product_id: decision.identity.productId,
      market_country_code: decision.identity.marketCountryCode,
      research_goal: decision.identity.researchGoal,
      provider_plan_version: decision.identity.providerPlanVersion,
      interpretation_version: decision.identity.interpretationVersion,
      context_fingerprint: decision.identity.contextFingerprint,
      provider_results_digest: decision.identity.providerResultsDigest,
      result_summary_digest: decision.identity.resultSummaryDigest,
      snapshot_fingerprint: decision.identity.snapshotFingerprint,
      status: decision.status,
      status_reason: decision.reason,
      certified_at: decision.status === "certified" ? nowIso : null,
      classifier_version: CERTIFICATION_SCHEMA_VERSION,
      automatic_spend_rupees: 0,
    };
    const { data, error } = await this.client
      .from("buyer_trade_research_certifications")
      .upsert(row, { onConflict: "job_id,snapshot_fingerprint", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return {
      outcome: data ? "inserted" : "already_certified",
      status: decision.status,
      snapshotFingerprint: decision.identity.snapshotFingerprint,
      classifierVersion: CERTIFICATION_SCHEMA_VERSION,
    };
  }

  /**
   * T12 remediation — read the "current" (highest classifier version)
   * certification row for a given job in a workspace. When a v2 row
   * exists it is preferred; otherwise the historical v1 row is
   * returned. Consumers picking a trusted certification for read use
   * this method so a known-bad v1 row does not shadow the corrected
   * v2 row.
   */
  async getCurrentCertificationForJob(jobId: string, workspaceId: string): Promise<Row | undefined> {
    requireUuid(jobId, "buyer_trade_research_certifications.job_id");
    requireUuid(workspaceId, "buyer_trade_research_certifications.workspace_id");
    const { data, error } = await this.client
      .from("buyer_trade_research_certifications")
      .select("*")
      .eq("job_id", jobId)
      .eq("workspace_id", workspaceId)
      .order("classifier_version", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data ?? undefined) as Row | undefined;
  }
  async finalize(job: InternalJobRow, worker: string, status: TradeResearchStatus, outcome: TradeResearchOutcome, result: TradeResearchResultSummary): Promise<InternalJobRow> {
    requireInternalJobRow(job);
    requireConstrainedText(status, "p_status", TERMINAL_TRADE_RESEARCH_STATUSES);
    requireConstrainedText(outcome, "p_outcome", TRADE_RESEARCH_OUTCOMES);
    requireJson(result, "p_result");
    if (result.automaticSpendRupees !== 0) throw new Error("AUTOMATIC_SPEND_MUST_REMAIN_ZERO");
    const [plansResponse, attemptsResponse] = await Promise.all([
      this.client.from("buyer_trade_research_provider_plans").select("*")
        .eq("job_id", job.id).eq("workspace_id", job.workspace_id).order("sequence"),
      this.client.from("buyer_trade_research_attempts").select("*")
        .eq("job_id", job.id).eq("workspace_id", job.workspace_id).order("attempt_number"),
    ]);
    if (plansResponse.error) throw plansResponse.error;
    if (attemptsResponse.error) throw attemptsResponse.error;
    const submitted = result.providerResults ?? [];
    const evaluated = submitted.filter((provider) =>
      provider.execution.status === "completed"
      || provider.execution.status === "no_match"
      || provider.execution.status === "cached",
    );
    if (evaluated.length > 0) {
      const versions = evaluated.map((provider) => provider.datasetVersion).filter((value): value is string => Boolean(value));
      if (versions.length !== evaluated.length) validateProviderResultSnapshots(evaluated, []);
      const { data: snapshots, error: snapshotsError } = await this.client
        .from("buyer_trade_source_snapshots")
        .select("provider_id,dataset_id,material_hash,published_period,retrieved_at,parse_version")
        .in("provider_id", [...new Set(evaluated.map((provider) => provider.providerId))])
        .in("material_hash", [...new Set(versions)]);
      if (snapshotsError) throw snapshotsError;
      validateProviderResultSnapshots(evaluated, (snapshots ?? []) as ProviderOutcomeSnapshot[]);
    }
    const projection = projectProviderOutcomes({
      plans: (plansResponse.data ?? []) as ProviderOutcomePlan[],
      attempts: (attemptsResponse.data ?? []) as ProviderOutcomeAttempt[],
      submitted,
      jobCancelled: status === "cancelled" || job.status === "cancel_requested",
    });
    const projectedResult = withProviderOutcomeProjection(result, projection);
    const authoritativeResult: TradeResearchResultSummary = {
      ...projectedResult,
      aggregate: aggregateTradeResearchEvidence(projection.providerResults),
    };
    const { data, error } = await this.client.rpc("finalize_buyer_trade_research_job_v2", {
      p_job_id: job.id, p_worker_id: worker, p_revision: job.revision,
      p_status: status, p_outcome: outcome, p_result_summary: authoritativeResult,
    });
    return authoritativeJobMutation(data, error);
  }
  async recoverClaimedJob(jobId: string, worker: string, nextAttemptAt: string, safeErrorCode: string): Promise<"requeued" | "cancelled" | "lease_lost"> {
    requireUuid(jobId, "job_id");
    requireTimestamp(nextAttemptAt, "next_attempt_at");
    const { data, error } = await this.client.from("buyer_trade_research_jobs").select("*")
      .eq("id", jobId).eq("lease_owner", worker).in("status", ["running", "cancel_requested"]).maybeSingle();
    if (error) throw error;
    let job = mapInternalJobRow(data);
    if (!job) return "lease_lost";
    const { data: attempt, error: attemptError } = await this.client.from("buyer_trade_research_attempts").select("id")
      .eq("job_id", jobId).eq("lease_owner", worker).eq("state", "running").maybeSingle();
    if (attemptError) throw attemptError;
    if (attempt) {
      await this.finishAttempt(job, worker, requireUuid(attempt.id, "attempt.id"), { state: "failed_retryable", safe_error_code: safeErrorCode });
    }
    if (job.status === "cancel_requested") {
      job = await this.finalize(job, worker, "cancelled", "cancelled", EMPTY_RESULT);
      return "cancelled";
    }
    job = await this.release(job, worker, nextAttemptAt);
    return "requeued";
  }
  async refreshOwnedJob(jobId: string, worker: string): Promise<InternalJobRow> {
    requireUuid(jobId, "job_id");
    requireText(worker, "lease_owner");
    const { data, error } = await this.client.from("buyer_trade_research_jobs").select("*")
      .eq("id", jobId).eq("lease_owner", worker).in("status", ["running", "cancel_requested"]).maybeSingle();
    if (error) throw error;
    const job = mapInternalJobRow(data);
    if (!job) throw new TradeResearchLeaseLostError();
    return job;
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
  /**
   * BI4F Phase 2C — plural-safe version. Returns ALL eligible
   * provider plans for a job in deterministic (sequence) order. The
   * worker iterates providers in this order, allocating deadline
   * budget across them.
   */
  async getEligiblePlans(jobId: string): Promise<Row[]> {
    requireUuid(jobId, "buyer_trade_research_provider_plans.job_id");
    const { data, error } = await this.client
      .from("buyer_trade_research_provider_plans").select("*")
      .eq("job_id", jobId).eq("eligibility", "eligible")
      .order("sequence");
    if (error) throw error;
    return (data ?? []) as Row[];
  }
  async getProviderPlans(jobId: string): Promise<Row[]> {
    requireUuid(jobId, "buyer_trade_research_provider_plans.job_id");
    const { data, error } = await this.client
      .from("buyer_trade_research_provider_plans").select("*")
      .eq("job_id", jobId)
      .order("sequence")
      .order("provider_id");
    if (error) throw error;
    return (data ?? []) as Row[];
  }
  async latestAttemptForPlan(planId: string): Promise<Row | undefined> {
    return this.latestAttempt(planId);
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
  async finishAttempt(job: InternalJobRow, worker: string, id: string, patch: Row): Promise<void> {
    requireInternalJobRow(job);
    requireText(worker, "p_worker_id");
    requireUuid(id, "buyer_trade_research_attempts.id");
    requireJson(patch, "attempt_patch");
    validateAttemptPatch(patch);
    const state = requireConstrainedText(patch.state, "attempt.state", PROVIDER_ATTEMPT_STATES);
    const { data, error } = await this.client.rpc("finish_buyer_trade_research_attempt", {
      p_attempt_id: id,
      p_job_id: job.id,
      p_worker_id: worker,
      p_revision: job.revision,
      p_state: state,
      p_safe_error_code: patch.safe_error_code ?? null,
      p_duration_ms: patch.duration_ms ?? null,
      p_record_count: patch.record_count ?? null,
      p_match_count: patch.match_count ?? null,
    });
    if (error) {
      if (isStaleMutationError(error)) throw new TradeResearchLeaseLostError(error);
      throw error;
    }
    const attempt = singleRpcRow<Row>(data);
    if (!attempt || isNullComposite(attempt)) throw new TradeResearchLeaseLostError();
  }
  async finishAttemptWithCheckpoint(
    job: InternalJobRow,
    worker: string,
    id: string,
    patch: Row,
    providerResult: TradeResearchProviderResult,
  ): Promise<void> {
    requireInternalJobRow(job);
    requireText(worker, "p_worker_id");
    requireUuid(id, "buyer_trade_research_attempts.id");
    requireJson(patch, "attempt_patch");
    requireJson(providerResult, "p_provider_result");
    validateAttemptPatch(patch);
    const state = requireConstrainedText(patch.state, "attempt.state", PROVIDER_ATTEMPT_STATES);
    assertProviderResultCheckpoint(state, providerResult.providerId, providerResult);
    const { data, error } = await this.client.rpc("finish_buyer_trade_research_attempt_v2", {
      p_attempt_id: id,
      p_job_id: job.id,
      p_worker_id: worker,
      p_revision: job.revision,
      p_state: state,
      p_provider_result: providerResult,
      p_safe_error_code: patch.safe_error_code ?? null,
      p_duration_ms: patch.duration_ms ?? null,
      p_record_count: patch.record_count ?? null,
      p_match_count: patch.match_count ?? null,
    });
    if (error) {
      if (isStaleMutationError(error)) throw new TradeResearchLeaseLostError(error);
      throw error;
    }
    const attempt = singleRpcRow<Row>(data);
    if (!attempt || isNullComposite(attempt)) throw new TradeResearchLeaseLostError();
  }

  /**
   * BI4F 2B — truthful reconciliation of a stale `state='running'`
   * attempt row left behind by a previous serverless hard-kill.
   *
   * When Vercel kills a function mid-fetch, the row inserted by
   * `startAttempt` remains `running` forever — the job-level claim
   * RPC only reclaims JOBS, not ATTEMPTS. When a subsequent worker
   * observes `latestAttempt.state === "running"` on a job that was
   * reclaimed from the outside, this method transitions that row to
   * `failed_retryable` with `safe_error_code = 'STALE_LEASE_RECOVERED'`.
   * The state is not fabricated as completed — the attempt truly did
   * not finish. History (attempt_number, started_at) is preserved;
   * only lease + state + safe_error_code + finished_at + updated_at
   * are touched.
   *
   * Idempotent: the WHERE clause pins `state='running'`, so a second
   * concurrent reconcile is a no-op.
   */
  async reconcileStaleAttempt(job: InternalJobRow, worker: string, id: string, safeErrorCode: string): Promise<void> {
    requireInternalJobRow(job);
    requireText(worker, "p_worker_id");
    requireUuid(id, "buyer_trade_research_attempts.id");
    requireText(safeErrorCode, "safe_error_code");
    const { error } = await this.client.rpc("reconcile_buyer_trade_research_attempt", {
      p_attempt_id: id,
      p_job_id: job.id,
      p_worker_id: worker,
      p_revision: job.revision,
      p_safe_error_code: safeErrorCode,
    });
    if (error) {
      if (isStaleMutationError(error)) throw new TradeResearchLeaseLostError(error);
      throw error;
    }
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
    return this.getFreshSnapshotByProvider("fda-fsvp", "fsvp-participant-list", now);
  }
  async getLatestSnapshot(): Promise<SnapshotRow | undefined> {
    return this.getLatestSnapshotByProvider("fda-fsvp", "fsvp-participant-list");
  }
  async getFreshSnapshotByProvider(providerId: string, datasetId: string, now = new Date()): Promise<SnapshotRow | undefined> {
    requireText(providerId, "buyer_trade_source_snapshots.provider_id");
    requireText(datasetId, "buyer_trade_source_snapshots.dataset_id");
    const { data, error } = await this.client
      .from("buyer_trade_source_snapshots").select("*")
      .eq("provider_id", providerId).eq("dataset_id", datasetId).eq("status", "ready")
      .gte("expires_at", now.toISOString()).order("retrieved_at", { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw error;
    return data as SnapshotRow | undefined;
  }
  async getLatestSnapshotByProvider(providerId: string, datasetId: string): Promise<SnapshotRow | undefined> {
    requireText(providerId, "buyer_trade_source_snapshots.provider_id");
    requireText(datasetId, "buyer_trade_source_snapshots.dataset_id");
    const { data, error } = await this.client
      .from("buyer_trade_source_snapshots").select("*")
      .eq("provider_id", providerId).eq("dataset_id", datasetId).eq("status", "ready")
      .order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as SnapshotRow | undefined;
  }
  async saveSnapshot(input: Row): Promise<SnapshotRow> {
    validateSnapshotInput(input);
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").upsert(input, { onConflict: "provider_id,dataset_id,material_hash" }).select("*").single();
    if (error) throw error;
    return data as SnapshotRow;
  }
  /**
   * TH04C — Insert a Thailand MANUAL_ONLY evidence row. Append-only;
   * never updates in place (corrections use `supersedeThaiManualEvidence`).
   * Writer validates the source-URL allowlist, requires a
   * server-derived `capturedByUserId`, and enforces
   * `automatic_spend_rupees = 0`.
   */
  /**
   * TH06 Step 0 — Create a ROOT Thailand manual-evidence row
   * atomically. Delegates to the `create_thai_manual_evidence` RPC
   * (migration 0036) which acquires a `(workspace, candidate,
   * provider)` advisory lock, verifies no active chain-leaf exists,
   * then inserts. Rejects concurrent root creates with
   * `MANUAL_EVIDENCE_ACTIVE_EXISTS`.
   *
   * The pre-TH06 non-RPC insert path has been removed so callers
   * cannot bypass the chain-integrity invariants.
   */
  async insertThaiManualEvidence(input: {
    workspaceId: string;
    candidateId: string;
    providerId: "thai-dbd" | "thai-customs-operator" | "thai-fda-importer";
    capturedByUserId: string;
    sourceUrl: string;
    sourceLabel: string;
    evidencePayload: unknown;
    evidenceStatus: "verified" | "not_found" | "inconclusive";
    lookupBasis?: ThaiManualEvidenceLookupBasis | null;
    lookupBasisDetail?: string | null;
    /** @deprecated — supersession goes through `supersedeThaiManualEvidence`. */
    supersedesId?: string;
  }): Promise<Row> {
    if (input.supersedesId !== undefined) {
      throw new Error("Use supersedeThaiManualEvidence for correction flows; this entrypoint creates ROOT rows only.");
    }
    requireUuid(input.workspaceId, "thai_manual_evidence.workspace_id");
    requireUuid(input.candidateId, "thai_manual_evidence.candidate_id");
    requireUuid(input.capturedByUserId, "thai_manual_evidence.captured_by_user_id");
    requireText(input.sourceLabel, "thai_manual_evidence.source_label");
    requireJson(input.evidencePayload, "thai_manual_evidence.evidence_payload");
    requireConstrainedText(input.evidenceStatus, "thai_manual_evidence.evidence_status",
      new Set(["verified", "not_found", "inconclusive"]));
    requireConstrainedText(input.providerId, "thai_manual_evidence.provider_id",
      new Set(["thai-dbd", "thai-customs-operator", "thai-fda-importer"]));
    if (input.lookupBasis != null) {
      requireConstrainedText(input.lookupBasis, "thai_manual_evidence.lookup_basis",
        new Set(["juristic_number", "license_number", "exact_legal_name", "name_search", "other"]));
    }
    const { requireAllowedManualEvidenceSourceUrl } = await import("./thailand/manualEvidenceSourceAllowlist");
    const normalizedUrl = requireAllowedManualEvidenceSourceUrl(input.providerId, input.sourceUrl);
    const { data, error } = await this.client.rpc("create_thai_manual_evidence", {
      p_workspace_id: input.workspaceId,
      p_candidate_id: input.candidateId,
      p_provider_id: input.providerId,
      p_captured_by_user_id: input.capturedByUserId,
      p_source_url: normalizedUrl,
      p_source_label: input.sourceLabel,
      p_evidence_payload: input.evidencePayload,
      p_evidence_status: input.evidenceStatus,
      p_lookup_basis: input.lookupBasis ?? null,
      p_lookup_basis_detail: input.lookupBasisDetail ?? null,
    });
    if (error) throw error;
    const row = singleRpcRow<Row>(data);
    if (!row) throw new Error("MANUAL_EVIDENCE_CREATE_FAILED");
    return row;
  }

  /**
   * TH05 Step 0 — ATOMIC supersession of a Thailand MANUAL_ONLY
   * evidence row.
   *
   * Delegates to the transactional `supersede_thai_manual_evidence`
   * RPC (migration 0035). The RPC locks the previous row FOR
   * UPDATE, verifies it is still a leaf AND not withdrawn, then
   * inserts the replacement with `supersedes_id = previousId` in
   * one transaction. Either both land or neither does — the
   * previous leaf stays current on any failure.
   *
   * Append-only history preserved by migration 0031's triggers;
   * the chain-integrity unique index (0035) prevents fork races.
   */
  async supersedeThaiManualEvidence(
    previousId: string,
    replacement: Omit<Parameters<TradeResearchWriter["insertThaiManualEvidence"]>[0], "supersedesId">,
  ): Promise<Row> {
    requireUuid(previousId, "thai_manual_evidence.supersedes_id");
    requireUuid(replacement.workspaceId, "thai_manual_evidence.workspace_id");
    requireUuid(replacement.candidateId, "thai_manual_evidence.candidate_id");
    requireUuid(replacement.capturedByUserId, "thai_manual_evidence.captured_by_user_id");
    requireText(replacement.sourceLabel, "thai_manual_evidence.source_label");
    requireJson(replacement.evidencePayload, "thai_manual_evidence.evidence_payload");
    requireConstrainedText(replacement.evidenceStatus, "thai_manual_evidence.evidence_status",
      new Set(["verified", "not_found", "inconclusive"]));
    requireConstrainedText(replacement.providerId, "thai_manual_evidence.provider_id",
      new Set(["thai-dbd", "thai-customs-operator", "thai-fda-importer"]));
    if (replacement.lookupBasis != null) {
      requireConstrainedText(replacement.lookupBasis, "thai_manual_evidence.lookup_basis",
        new Set(["juristic_number", "license_number", "exact_legal_name", "name_search", "other"]));
    }
    const { requireAllowedManualEvidenceSourceUrl } = await import("./thailand/manualEvidenceSourceAllowlist");
    const normalizedUrl = requireAllowedManualEvidenceSourceUrl(replacement.providerId, replacement.sourceUrl);
    const { data, error } = await this.client.rpc("supersede_thai_manual_evidence", {
      p_previous_id: previousId,
      p_workspace_id: replacement.workspaceId,
      p_candidate_id: replacement.candidateId,
      p_provider_id: replacement.providerId,
      p_captured_by_user_id: replacement.capturedByUserId,
      p_source_url: normalizedUrl,
      p_source_label: replacement.sourceLabel,
      p_evidence_payload: replacement.evidencePayload,
      p_evidence_status: replacement.evidenceStatus,
      p_lookup_basis: replacement.lookupBasis ?? null,
      p_lookup_basis_detail: replacement.lookupBasisDetail ?? null,
    });
    if (error) throw error;
    const row = singleRpcRow<Row>(data);
    if (!row) throw new Error("MANUAL_EVIDENCE_SUPERSESSION_FAILED");
    return row;
  }

  /**
   * TH04C — Mark an active Thailand MANUAL_ONLY evidence row as
   * `withdrawn`. The trigger permits this specific transition
   * in-place (no new row created); every other identity field stays
   * immutable.
   */
  async withdrawThaiManualEvidence(id: string, workspaceId: string): Promise<void> {
    requireUuid(id, "thai_manual_evidence.id");
    requireUuid(workspaceId, "thai_manual_evidence.workspace_id");
    const { error } = await this.client
      .from("buyer_trade_research_thai_manual_evidence")
      .update({ evidence_status: "withdrawn" })
      .eq("id", id).eq("workspace_id", workspaceId);
    if (error) throw error;
  }

  async listThaiManualEvidenceForCandidate(workspaceId: string, candidateId: string): Promise<Row[]> {
    requireUuid(workspaceId, "thai_manual_evidence.workspace_id");
    requireUuid(candidateId, "thai_manual_evidence.candidate_id");
    const { data, error } = await this.client
      .from("buyer_trade_research_thai_manual_evidence")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Row[];
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
