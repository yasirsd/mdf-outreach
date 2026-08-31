/**
 * Operator-facing free-research status. Presentation only.
 */

import type { FreeEnrichmentJob, FreeEnrichmentJobStatus } from "./freeEnrichmentJob";

export type CompanyResearchState = "ready" | "researching" | "needs_attention" | "waiting";

const TERMINAL_OK: readonly FreeEnrichmentJobStatus[] = ["succeeded", "no_result", "cancelled"];
const RESEARCHING: readonly FreeEnrichmentJobStatus[] = ["queued", "processing", "retry_wait"];

export function companyResearchState(jobs: FreeEnrichmentJob[]): CompanyResearchState {
  if (jobs.length === 0) return "waiting";
  if (jobs.some((j) => j.status === "failed")) return "needs_attention";
  if (jobs.some((j) => RESEARCHING.includes(j.status))) return "researching";
  if (jobs.every((j) => TERMINAL_OK.includes(j.status))) return "ready";
  return "waiting";
}

export function researchJobLabel(
  status: FreeEnrichmentJobStatus | undefined,
  providerOutcome?: string | null,
): string {
  if (status === "processing") return "Researching";
  if (status === "retry_wait") return "Retrying";
  if (status === "queued") return "Waiting";
  if (status === "failed") return "Needs attention";
  if (status === "no_result") return "No result found";
  if (status === "cancelled") return "Skipped";
  if (status === "succeeded") {
    if (providerOutcome === "blocked") return "Website restricted";
    return "Ready";
  }
  return "Not started";
}

export function researchFeedbackCopy(input: {
  researching: number;
  needsAttention: number;
  ready: number;
  companies: number;
  checksRemaining: number;
  paused?: boolean;
  pausedReason?: string;
}): string {
  if (input.paused) {
    return input.pausedReason ?? "Research paused";
  }
  if (input.researching > 0 || input.checksRemaining > 0) {
    if (input.checksRemaining > 0) {
      return `Free research is running automatically · ${input.checksRemaining} ${input.checksRemaining === 1 ? "check" : "checks"} remaining`;
    }
    return "Free research is running automatically";
  }
  if (input.needsAttention > 0 && input.ready + input.needsAttention >= input.companies) {
    return `Research complete · ${input.needsAttention} need attention`;
  }
  if (input.ready > 0 && input.needsAttention === 0 && input.researching === 0) {
    return "Free research complete";
  }
  return "Free research";
}
