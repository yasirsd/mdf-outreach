import "server-only";

import { TradeResearchContractError } from "../repository";
import { ProviderOutcomeProjectionError } from "../providerOutcomes";

export type TradeResearchDiagnostic = {
  event: "drain_started" | "drain_finished" | "route_failed" | "jobs_requested" | "jobs_claimed" | "claim_no_work" | "claim_rejected" |
    "job_claimed" | "stage_started" | "stage_completed" | "job_requeued" | "job_failed" |
    "inline_kick_started" | "inline_kick_finished" | "inline_kick_budget_exhausted" | "inline_kick_failed" |
    "job_checkpointed_runtime_budget" |
    "research_snapshot_certified" | "research_snapshot_certification_failed" |
    // TH07 DEFECT 03 — per-branch observability for createTradeResearchBatchAction.
    // Every early-return branch logs one of these so the operator can see
    // which specific gate (forbidden / invalid_input / candidate_not_found /
    // already_active / 23505 / zero_jobs_invariant) fired, instead of a
    // silent 200 with no DB row.
    "batch_action_entered" | "batch_action_forbidden" | "batch_action_invalid_input" |
    "batch_action_candidate_not_found" | "batch_action_already_active" |
    "batch_action_terminal_rerun" |
    "batch_action_duplicate_23505" | "batch_action_zero_jobs_invariant" |
    "batch_action_created" |
    // TH07 DEFECT 05C — final-settlement observability. Emitted
    // once per terminal transition from the worker so operators
    // can see the mixed-outcome aggregate without digging through
    // provider events. `job_finalize_blocked` fires if the finalize
    // path threw and the drain recovery released the lease — the
    // signal we were missing when the stuck-production job
    // reclaim-spun invisibly.
    "job_finalized" | "job_finalize_blocked" |
    // TH07 DEFECT 05E — a job parked because an eligible provider still
    // has retry budget. `provider_retry_scheduled` is per-provider;
    // `job_retry_pending` is the job-level park. Safe fields only.
    "job_retry_pending" | "provider_retry_scheduled";
  elapsedMs?: number;
  remainingBudgetMs?: number;
  remainingMs?: number;
  iteration?: number;
  jobId?: string;
  batchId?: string;
  candidateId?: string;
  status?: string;
  stage?: string;
  revision?: number;
  leaseState?: "owned" | "released" | "lost";
  jobsRequested?: number;
  jobsClaimed?: number;
  processed?: number;
  completed?: number;
  requeued?: number;
  failed?: number;
  noWork?: boolean;
  durationMs?: number;
  safeErrorCode?: string;
  fieldName?: string;
  expectedSqlType?: string;
  suppliedCategory?: string;
  validFormat?: boolean;
  // TH07 DEFECT 03 — createTradeResearchBatchAction observability.
  requestCount?: number;
  jobCount?: number;
  reason?: string;
  // TH07 DEFECT 05A — provider fetch failure classification. All
  // fields are safe-by-construction: `providerId` is an allowlisted
  // string; `hostname` is a URL host; `httpStatus` is a numeric code;
  // `errorClass` is a safe class/name (e.g. "AbortError");
  // `timeoutCategory` is a bounded enum. Never log cookies, tokens,
  // raw HTML, full response bodies, PII, or secrets.
  providerId?: string;
  hostname?: string;
  httpStatus?: number;
  errorClass?: string;
  timeoutCategory?: "abort" | "timeout" | "network" | "parse" | "unknown";
  // TH07 DEFECT 05C — final-settlement counts. Safe-by-construction:
  // these are derived from `aggregate.coverageCounts` (plain
  // integers over the provider_result[].execution.status set) and
  // from the attempt-history retry policy; they never carry
  // provider bodies, URLs, HTML, cookies, tokens, or PII.
  outcome?: string;
  sourcesEvaluated?: number;
  sourcesFailed?: number;
  retryExhaustedCount?: number;
  // TH07 DEFECT 05E — retry-park fields. `providerId` is an allowlisted
  // provider id; `attemptNumber` is 1..3; `retryAfterMs` is the
  // retryDelayMs value; `nextAttemptAt` is an ISO timestamp. Never log
  // provider bodies, tokens, secrets, or PII.
  attemptNumber?: number;
  retryAfterMs?: number;
  nextAttemptAt?: string;
};

export type TradeResearchLogger = (diagnostic: TradeResearchDiagnostic) => void;

function databaseErrorText(error: object): string {
  const safeParts = ["message", "details", "hint"]
    .map((key) => key in error ? (error as Record<string, unknown>)[key] : undefined)
    .filter((value): value is string => typeof value === "string");
  return safeParts.join(" ").toLowerCase();
}

export function safeTradeResearchErrorMetadata(error: unknown): Pick<TradeResearchDiagnostic, "fieldName" | "expectedSqlType" | "suppliedCategory" | "validFormat"> {
  if (!(error instanceof TradeResearchContractError)) return {};
  return {
    fieldName: error.fieldName,
    expectedSqlType: error.expectedSqlType,
    suppliedCategory: error.suppliedCategory,
    validFormat: false,
  };
}

export function safeTradeResearchErrorCode(error: unknown): string {
  if (error instanceof TradeResearchContractError) {
    if (error.expectedSqlType === "uuid") return "CONTRACT_INVALID_UUID";
    if (error.expectedSqlType === "bigint" || error.expectedSqlType === "integer") return "CONTRACT_INVALID_INTEGER";
    if (error.expectedSqlType === "timestamptz") return "CONTRACT_INVALID_TIMESTAMP";
    if (error.expectedSqlType === "constrained_text") return "CONTRACT_INVALID_STATE";
    if (error.expectedSqlType === "jsonb") return "CONTRACT_INVALID_JSON";
  }
  // TH07 DEFECT 05D — classify `ProviderOutcomeProjectionError`
  // subcodes to safe bounded `FINALIZE_*` codes. Prior to this,
  // every projection/invariant throw collapsed to the opaque
  // `WORKER_INTERNAL_ERROR` fallback, which hid the real
  // finalization blocker (`PROVIDER_SNAPSHOT_METADATA_CONFLICT`)
  // behind an operator-useless label on every production drain.
  //
  // All codes below are safe-by-construction — bounded enum values,
  // no SQL text, no identifiers, no provider body, no PII.
  if (error instanceof ProviderOutcomeProjectionError) {
    switch (error.code) {
      case "EVALUATED_PROVIDER_SNAPSHOT_REQUIRED":
      case "PROVIDER_SNAPSHOT_METADATA_CONFLICT":
        return "FINALIZE_SNAPSHOT_INVARIANT";
      case "EVALUATED_PROVIDER_RESULT_REQUIRED":
        return "FINALIZE_RESULT_CONTRACT_INVALID";
      case "DUPLICATE_PROVIDER_PLAN":
      case "UNPLANNED_PROVIDER_RESULT":
      case "DUPLICATE_PROVIDER_RESULT":
      case "ATTEMPT_FOR_UNPLANNED_PROVIDER":
      case "UNKNOWN_PROVIDER_ATTEMPT_STATE":
        return "FINALIZE_PROJECTION_FAILED";
      default:
        return "FINALIZE_PROJECTION_FAILED";
    }
  }
  if (error instanceof Error) {
    if (error.name === "TradeResearchServiceRoleConfigError") return "SERVICE_ROLE_CONFIGURATION_ERROR";
    if (error.message === "JOB_LEASE_LOST") return "JOB_LEASE_LOST";
    if (error.message === "PROVIDER_COST_POLICY_VIOLATION") return "PROVIDER_COST_POLICY_VIOLATION";
    if (error.message === "AUTOMATIC_SPEND_MUST_REMAIN_ZERO") return "AUTOMATIC_SPEND_POLICY_VIOLATION";
  }
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "P0001") {
      // TH07 DEFECT 05D — map known finalize_buyer_trade_research_job_v2
      // raise-exception messages to bounded FINALIZE_* codes. Inspect
      // only the documented exception text (already lowercased); never
      // emit SQL, identifiers, or payload contents.
      const detail = databaseErrorText(error);
      if (detail.includes("stale_job_revision") || detail.includes("attempt_state_conflict")) {
        return "FINALIZE_CAS_CONFLICT";
      }
      if (detail.includes("result_context_conflict") || detail.includes("legacy_job_context_forbidden")) {
        return "FINALIZE_RPC_REJECTED";
      }
      if (
        detail.includes("invalid terminal status")
        || detail.includes("invalid trade research outcome")
        || detail.includes("result summary must be a json object")
      ) {
        return "FINALIZE_RESULT_CONTRACT_INVALID";
      }
      if (detail.includes("automatic trade research spend must remain zero")) {
        return "AUTOMATIC_SPEND_POLICY_VIOLATION";
      }
    }
    if (code === "22P02") {
      const detail = databaseErrorText(error);
      if (/\buuid\b/.test(detail)) return "DATABASE_22P02_INVALID_UUID";
      if (/\benum\b/.test(detail)) return "DATABASE_22P02_INVALID_ENUM";
      if (/\b(?:smallint|integer|bigint|numeric|decimal)\b/.test(detail)) return "DATABASE_22P02_INVALID_INTEGER";
      if (/\b(?:timestamp|timestamptz|date|time)\b/.test(detail)) return "DATABASE_22P02_INVALID_TIMESTAMP";
      return "DATABASE_22P02_OTHER";
    }
    if (code === "42501") {
      // Classify 42501 into safe sub-codes WITHOUT emitting any
      // table, function, or schema identifiers. We inspect only the
      // Postgres object-kind noun in the error message ("function",
      // "sequence", "schema", "table"/"relation") — never the actual
      // object name. If the message shape is ambiguous, we fall back
      // to _OTHER rather than leak SQL.
      const detail = databaseErrorText(error);
      if (/permission denied for function\b/.test(detail)) return "DATABASE_42501_RPC_EXECUTE";
      if (/permission denied for sequence\b/.test(detail)) return "DATABASE_42501_SEQUENCE";
      if (/permission denied for schema\b/.test(detail)) return "DATABASE_42501_SCHEMA";
      if (/permission denied for (?:table|relation)\b/.test(detail)) return "DATABASE_42501_TABLE";
      return "DATABASE_42501_OTHER";
    }
    if (/^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code)) return `DATABASE_${code}`;
  }
  return "WORKER_INTERNAL_ERROR";
}

export const logTradeResearchDiagnostic: TradeResearchLogger = (diagnostic) => {
  const payload = JSON.stringify({ scope: "trade_research", ...diagnostic });
  if (diagnostic.event === "route_failed" || diagnostic.event === "claim_rejected" || diagnostic.event === "job_failed") console.error(payload);
  else console.info(payload);
};
