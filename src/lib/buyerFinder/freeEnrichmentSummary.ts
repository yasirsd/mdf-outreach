import type { FreeEnrichmentJob } from "./freeEnrichmentJob";
import type { RevealPriorityTier } from "./revealPriority";
import { companyResearchState } from "./researchPresentation";

export interface FreeEnrichmentSummary {
  companies: number;
  ready: number;
  researching: number;
  needsAttention: number;
  checksRemaining: number;
  companiesWithPublicEmail: number;
  peopleFound: number;
  highRevealPriority: number;
  /** @deprecated use ready */
  complete: number;
  inProgress: number;
  retrying: number;
  queued: number;
  /** Email records, not companies. Prefer companiesWithPublicEmail. */
  publicEmailsFound: number;
  decisionMakersFound: number;
}

export function summarizeFreeEnrichmentJobs(input: {
  jobs: FreeEnrichmentJob[];
  companyIds: string[];
  publicEmailCount: number;
  companiesWithPublicEmail: number;
  decisionMakerCount: number;
  highPriorityCount: number;
}): FreeEnrichmentSummary {
  const byCandidate = new Map<string, FreeEnrichmentJob[]>();
  for (const job of input.jobs) {
    const list = byCandidate.get(job.candidateId) ?? [];
    list.push(job);
    byCandidate.set(job.candidateId, list);
  }
  let ready = 0;
  let researching = 0;
  let needsAttention = 0;
  let inProgress = 0;
  let retrying = 0;
  let queued = 0;
  let checksRemaining = 0;
  for (const id of input.companyIds) {
    const jobs = byCandidate.get(id) ?? [];
    const state = companyResearchState(jobs);
    if (state === "needs_attention") needsAttention += 1;
    else if (state === "researching") researching += 1;
    else if (state === "ready") ready += 1;
    for (const job of jobs) {
      if (job.status === "processing") inProgress += 1;
      if (job.status === "retry_wait") retrying += 1;
      if (job.status === "queued") queued += 1;
      if (job.status === "queued" || job.status === "processing" || job.status === "retry_wait") {
        checksRemaining += 1;
      }
    }
  }
  return {
    companies: input.companyIds.length,
    ready,
    researching,
    needsAttention,
    checksRemaining,
    companiesWithPublicEmail: input.companiesWithPublicEmail,
    peopleFound: input.decisionMakerCount,
    highRevealPriority: input.highPriorityCount,
    complete: ready,
    inProgress,
    retrying,
    queued,
    publicEmailsFound: input.publicEmailCount,
    decisionMakersFound: input.decisionMakerCount,
  };
}

export function jobStatusLabel(status: FreeEnrichmentJob["status"] | undefined): string {
  switch (status) {
    case "processing":
      return "Researching";
    case "retry_wait":
      return "Retrying";
    case "queued":
      return "Waiting";
    case "failed":
      return "Needs attention";
    case "no_result":
      return "No result found";
    case "succeeded":
      return "Ready";
    case "cancelled":
      return "Skipped";
    default:
      return "Not started";
  }
}

export function revealPriorityLabel(tier: RevealPriorityTier): string {
  if (tier === "high") return "High";
  if (tier === "medium") return "Medium";
  if (tier === "low") return "Low";
  return "None";
}
