import type {
  TradeResearchProviderExecutionState,
  TradeResearchProviderResult,
} from "./types";

type Row = Record<string, unknown>;

const CHECKPOINT_STATUS_BY_ATTEMPT_STATE = {
  completed: "completed",
  completed_no_match: "no_match",
  skipped_cached: "cached",
} as const satisfies Record<string, TradeResearchProviderExecutionState>;

export type CheckpointAttemptState = keyof typeof CHECKPOINT_STATUS_BY_ATTEMPT_STATE;

function isObject(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const PROVIDER_RESULT_FIELDS = new Set([
  "providerId", "datasetId", "datasetVersion", "parserVersion",
  "sourceRecordIds", "sourcePeriod", "retrievedAt", "execution", "evidence",
]);

export function checkpointExecutionStatus(state: string): TradeResearchProviderExecutionState | undefined {
  return CHECKPOINT_STATUS_BY_ATTEMPT_STATE[state as CheckpointAttemptState];
}

/**
 * Reads only a complete T08 evaluated-provider checkpoint. Invalid or legacy
 * terminal rows are deliberately returned as undefined so callers take the
 * conservative legacy path instead of fabricating evidence.
 */
export function readProviderResultCheckpoint(
  attempt: Row | undefined,
  providerId: string,
): TradeResearchProviderResult | undefined {
  if (!attempt || typeof attempt.state !== "string") return undefined;
  const expectedStatus = checkpointExecutionStatus(attempt.state);
  if (!expectedStatus || !isObject(attempt.provider_result)) return undefined;
  const result = attempt.provider_result;
  if (!Object.keys(result).every((field) => PROVIDER_RESULT_FIELDS.has(field))
      || result.providerId !== providerId
      || typeof result.datasetId !== "string"
      || typeof result.datasetVersion !== "string"
      || typeof result.parserVersion !== "string"
      || !Array.isArray(result.sourceRecordIds)
      || !result.sourceRecordIds.every((value) => typeof value === "string")
      || typeof result.sourcePeriod !== "string"
      || typeof result.retrievedAt !== "string"
      || !isObject(result.execution)
      || result.execution.status !== expectedStatus
      || result.execution.safeErrorCode !== null
      || !isObject(result.evidence)) {
    return undefined;
  }
  return result as unknown as TradeResearchProviderResult;
}

export function assertProviderResultCheckpoint(
  attemptState: string,
  providerId: string,
  result: TradeResearchProviderResult,
): void {
  const checkpoint = readProviderResultCheckpoint(
    { state: attemptState, provider_result: result },
    providerId,
  );
  if (!checkpoint) throw new Error("INVALID_PROVIDER_RESULT_CHECKPOINT");
}
