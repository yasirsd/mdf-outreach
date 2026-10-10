import type {
  TradeResearchProviderExecutionState,
  TradeResearchProviderResult,
  TradeResearchResultSummary,
} from "./types";

export interface ProviderOutcomePlan {
  id: string;
  provider_id: string;
  sequence: number;
  eligibility: "eligible" | "ineligible";
  decision_reason: string;
  dataset_version?: string | null;
}

export interface ProviderOutcomeAttempt {
  provider_plan_id: string;
  attempt_number: number;
  state: string;
  safe_error_code?: string | null;
}

export interface ProviderOutcomeCounts {
  sourcesPlanned: number;
  sourcesAttempted: number;
  sourcesEvaluated: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  sourcesCached: number;
}

export interface ProviderOutcomeSnapshot {
  provider_id: string;
  dataset_id: string;
  material_hash: string;
  published_period: string;
  retrieved_at: string;
  parse_version: string;
}

export class ProviderOutcomeProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProviderOutcomeProjectionError";
  }
}

const DATASET_IDS: Readonly<Record<string, string>> = {
  "fda-fsvp": "fsvp-participant-list",
  "fda-vqip": "fda-vqip-participant-list",
  "canada-cid": "cid-major-importers-by-hs6-by-country",
};

export function unevaluatedProviderOutcome(
  plan: ProviderOutcomePlan,
  status: Exclude<TradeResearchProviderExecutionState, "completed" | "no_match" | "cached">,
  safeErrorCode: string | null,
): TradeResearchProviderResult {
  const safeCode = safeErrorCode && /^[A-Z0-9_]{1,80}$/.test(safeErrorCode)
    ? safeErrorCode
    : safeErrorCode ? "PROVIDER_FAILURE" : null;
  return {
    providerId: plan.provider_id,
    datasetId: DATASET_IDS[plan.provider_id] ?? plan.provider_id,
    datasetVersion: plan.dataset_version ?? null,
    parserVersion: null,
    sourceRecordIds: [],
    sourcePeriod: null,
    retrievedAt: null,
    execution: { status, safeErrorCode: safeCode },
    evidence: null,
  };
}

function latestAttempts(attempts: readonly ProviderOutcomeAttempt[]): Map<string, ProviderOutcomeAttempt> {
  const latest = new Map<string, ProviderOutcomeAttempt>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.provider_plan_id);
    if (!current || attempt.attempt_number > current.attempt_number) {
      latest.set(attempt.provider_plan_id, attempt);
    }
  }
  return latest;
}

export function providerExecutionStatusForPlan(
  plan: ProviderOutcomePlan,
  attempt: ProviderOutcomeAttempt | undefined,
  jobCancelled: boolean,
): TradeResearchProviderExecutionState {
  if (!attempt) {
    if (plan.eligibility === "eligible") return "not_started";
    return ["unsupported", "wrong_country", "wrong_role", "not_food_import_relevant"].includes(plan.decision_reason)
      ? "unsupported"
      : "blocked";
  }
  switch (attempt.state) {
    case "completed": return "completed";
    case "completed_no_match": return "no_match";
    case "skipped_cached": return "cached";
    case "failed_retryable":
    case "retry_wait": return "failed_retryable";
    case "failed_terminal": return "failed_terminal";
    case "cancelled": return "cancelled";
    case "skipped_quota":
    case "skipped_cost":
    case "skipped_terms": return "blocked";
    case "running": return jobCancelled ? "cancelled" : "failed_retryable";
    case "planned":
    case "queued": return "not_started";
    default: throw new ProviderOutcomeProjectionError("UNKNOWN_PROVIDER_ATTEMPT_STATE");
  }
}

/**
 * Builds one authoritative result per plan. Plan membership/order and the
 * execution state come only from durable plans and attempts. Submitted
 * evaluated results contribute source-local evidence, but cannot add a plan,
 * omit an evaluated plan, duplicate a provider, or override durable status.
 */
export function projectProviderOutcomes(input: {
  plans: readonly ProviderOutcomePlan[];
  attempts: readonly ProviderOutcomeAttempt[];
  submitted: readonly TradeResearchProviderResult[];
  jobCancelled?: boolean;
}): { providerResults: TradeResearchProviderResult[]; counts: ProviderOutcomeCounts } {
  const plans = [...input.plans].sort((a, b) => a.sequence - b.sequence || a.provider_id.localeCompare(b.provider_id));
  const planIds = new Set<string>();
  const plannedProviders = new Set<string>();
  for (const plan of plans) {
    if (planIds.has(plan.id) || plannedProviders.has(plan.provider_id)) {
      throw new ProviderOutcomeProjectionError("DUPLICATE_PROVIDER_PLAN");
    }
    planIds.add(plan.id);
    plannedProviders.add(plan.provider_id);
  }

  const submitted = new Map<string, TradeResearchProviderResult>();
  for (const result of input.submitted) {
    if (!plannedProviders.has(result.providerId)) {
      throw new ProviderOutcomeProjectionError("UNPLANNED_PROVIDER_RESULT");
    }
    if (submitted.has(result.providerId)) {
      throw new ProviderOutcomeProjectionError("DUPLICATE_PROVIDER_RESULT");
    }
    submitted.set(result.providerId, result);
  }

  for (const attempt of input.attempts) {
    if (!planIds.has(attempt.provider_plan_id)) {
      throw new ProviderOutcomeProjectionError("ATTEMPT_FOR_UNPLANNED_PROVIDER");
    }
  }
  const latest = latestAttempts(input.attempts);
  const providerResults = plans.map((plan): TradeResearchProviderResult => {
    const attempt = latest.get(plan.id);
    const status = providerExecutionStatusForPlan(plan, attempt, Boolean(input.jobCancelled));
    const candidate = submitted.get(plan.provider_id);
    if (status === "completed" || status === "no_match" || status === "cached") {
      if (!candidate || candidate.execution.status !== status || !candidate.evidence) {
        throw new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_RESULT_REQUIRED");
      }
      return {
        ...candidate,
        providerId: plan.provider_id,
        execution: { status, safeErrorCode: null },
      } as TradeResearchProviderResult;
    }
    return unevaluatedProviderOutcome(plan, status, attempt?.safe_error_code ?? null);
  });

  const attemptedPlanIds = new Set(input.attempts.map((attempt) => attempt.provider_plan_id));
  const counts: ProviderOutcomeCounts = {
    sourcesPlanned: plans.length,
    sourcesAttempted: attemptedPlanIds.size,
    sourcesEvaluated: providerResults.filter((r) => r.execution.status === "completed" || r.execution.status === "no_match" || r.execution.status === "cached").length,
    sourcesSucceeded: providerResults.filter((r) => r.execution.status === "completed" || r.execution.status === "no_match").length,
    sourcesFailed: providerResults.filter((r) => r.execution.status === "failed_retryable" || r.execution.status === "failed_terminal").length,
    sourcesCached: providerResults.filter((r) => r.execution.status === "cached").length,
  };
  return { providerResults, counts };
}

export function withProviderOutcomeProjection(
  result: TradeResearchResultSummary,
  projection: ReturnType<typeof projectProviderOutcomes>,
): TradeResearchResultSummary {
  return { ...result, ...projection.counts, providerResults: projection.providerResults };
}

/**
 * TH07 DEFECT 05D — semantic timestamp equality for `retrieved_at`.
 *
 * `buyer_trade_source_snapshots.retrieved_at` is a Postgres
 * `timestamptz`. PostgREST serialises it as
 * `YYYY-MM-DDTHH:mm:ss(.sss)+00:00`, which is NOT byte-identical to
 * the `new Date().toISOString()` form (`.sssZ`) that executors
 * typically produce.
 *
 * A strict string compare therefore fires `PROVIDER_SNAPSHOT_METADATA_CONFLICT`
 * on every finalize of any job whose provider_result captured
 * `retrievedAt` as an ISO-`Z` string (as the pre-05D website executor
 * did). The compare is meant to assert "the snapshot persisted in DB
 * corresponds to the provider_result we're finalizing with" — a
 * semantic-time check, not a bytewise one.
 *
 * We compare `retrieved_at` as parsed epoch-millis. Non-parseable
 * values on either side fall back to strict string compare so we
 * never silently accept a mismatch.
 */
function timestampsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const parsedA = Date.parse(a);
  const parsedB = Date.parse(b);
  if (Number.isNaN(parsedA) || Number.isNaN(parsedB)) return false;
  return parsedA === parsedB;
}

/** Validate evaluated metadata against a snapshot that already exists in DB. */
export function validateProviderResultSnapshots(
  results: readonly TradeResearchProviderResult[],
  snapshots: readonly ProviderOutcomeSnapshot[],
): void {
  const evaluated = results.filter((result) =>
    result.execution.status === "completed" || result.execution.status === "no_match" || result.execution.status === "cached",
  );
  for (const result of evaluated) {
    if (!result.datasetVersion) {
      throw new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_SNAPSHOT_REQUIRED");
    }
    const snapshot = snapshots.find((item) =>
      item.provider_id === result.providerId
      && item.dataset_id === result.datasetId
      && item.material_hash === result.datasetVersion,
    );
    if (!snapshot) throw new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_SNAPSHOT_REQUIRED");
    const retrievedAtMatches = typeof result.retrievedAt === "string"
      && typeof snapshot.retrieved_at === "string"
      && timestampsEqual(snapshot.retrieved_at, result.retrievedAt);
    if (snapshot.published_period !== result.sourcePeriod
        || !retrievedAtMatches
        || snapshot.parse_version !== result.parserVersion) {
      throw new ProviderOutcomeProjectionError("PROVIDER_SNAPSHOT_METADATA_CONFLICT");
    }
  }
}
