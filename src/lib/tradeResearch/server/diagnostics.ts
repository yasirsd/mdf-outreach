import "server-only";

import { TradeResearchContractError } from "../repository";

export type TradeResearchDiagnostic = {
  event: "drain_started" | "drain_finished" | "route_failed" | "jobs_requested" | "jobs_claimed" | "claim_no_work" | "claim_rejected" |
    "job_claimed" | "stage_started" | "stage_completed" | "job_requeued" | "job_failed";
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
  if (error instanceof Error) {
    if (error.name === "TradeResearchServiceRoleConfigError") return "SERVICE_ROLE_CONFIGURATION_ERROR";
    if (error.message === "JOB_LEASE_LOST") return "JOB_LEASE_LOST";
    if (error.message === "PROVIDER_COST_POLICY_VIOLATION") return "PROVIDER_COST_POLICY_VIOLATION";
    if (error.message === "AUTOMATIC_SPEND_MUST_REMAIN_ZERO") return "AUTOMATIC_SPEND_POLICY_VIOLATION";
  }
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "22P02") {
      const detail = databaseErrorText(error);
      if (/\buuid\b/.test(detail)) return "DATABASE_22P02_INVALID_UUID";
      if (/\benum\b/.test(detail)) return "DATABASE_22P02_INVALID_ENUM";
      if (/\b(?:smallint|integer|bigint|numeric|decimal)\b/.test(detail)) return "DATABASE_22P02_INVALID_INTEGER";
      if (/\b(?:timestamp|timestamptz|date|time)\b/.test(detail)) return "DATABASE_22P02_INVALID_TIMESTAMP";
      return "DATABASE_22P02_OTHER";
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
