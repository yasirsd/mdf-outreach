import "server-only";

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
};

export type TradeResearchLogger = (diagnostic: TradeResearchDiagnostic) => void;

export function safeTradeResearchErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TradeResearchServiceRoleConfigError") return "SERVICE_ROLE_CONFIGURATION_ERROR";
    if (error.message === "JOB_LEASE_LOST") return "JOB_LEASE_LOST";
    if (error.message === "PROVIDER_COST_POLICY_VIOLATION") return "PROVIDER_COST_POLICY_VIOLATION";
    if (error.message === "AUTOMATIC_SPEND_MUST_REMAIN_ZERO") return "AUTOMATIC_SPEND_POLICY_VIOLATION";
  }
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (/^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code)) return `DATABASE_${code}`;
  }
  return "WORKER_INTERNAL_ERROR";
}

export const logTradeResearchDiagnostic: TradeResearchLogger = (diagnostic) => {
  const payload = JSON.stringify({ scope: "trade_research", ...diagnostic });
  if (diagnostic.event === "route_failed" || diagnostic.event === "claim_rejected" || diagnostic.event === "job_failed") console.error(payload);
  else console.info(payload);
};
