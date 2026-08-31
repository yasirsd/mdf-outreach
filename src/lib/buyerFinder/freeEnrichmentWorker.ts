import "server-only";

import type { BuyerCandidateRepository } from "@/lib/repositories/interfaces";
import type {
  BuyerCandidateContactRepository,
  BuyerCandidateProductMatchRepository,
  BuyerCandidatePublicEmailRepository,
  BuyerFinderFreeEnrichmentJobRepository,
} from "@/lib/repositories/interfaces";
import {
  backoffMsAfterAttempt,
  FREE_ENRICHMENT_MAX_ATTEMPTS,
  type FreeEnrichmentCapability,
  type FreeEnrichmentJob,
} from "./freeEnrichmentJob";
import { candidateEligibleForFreeEnrichment } from "./enqueueFreeEnrichment";
import { discoverPublicCompanyContactsForCandidate } from "./publicCompanyContacts";
import { discoverPeopleForCandidate } from "./personDiscovery";
import { blankToUndefined, normalizeDomain } from "./normalize";
import { HunterDiscoveryError } from "./providers/hunter/errors";
import type { CompanyContactDiscoveryProvider } from "./providers/types";
import type { PersonDiscoveryProvider } from "./providers/types";

export interface FreeEnrichmentWorkerRepos {
  jobs: BuyerFinderFreeEnrichmentJobRepository;
  candidates: BuyerCandidateRepository;
  contacts: BuyerCandidateContactRepository;
  productMatches: BuyerCandidateProductMatchRepository;
  publicEmails: BuyerCandidatePublicEmailRepository;
}

export interface FreeEnrichmentWorkerProviders {
  publicWebsite?: CompanyContactDiscoveryProvider;
  decisionMakers?: PersonDiscoveryProvider;
}

const PUBLIC_RETRYABLE = new Set(["timeout", "unavailable", "incomplete"]);
const HUNTER_RETRYABLE = new Set(["rate_limited", "provider_unavailable", "timeout"]);

export interface DrainFreeEnrichmentResult {
  claimed: number;
  processed: number;
  skipped: number;
}

export function logFreeEnrichmentJobDev(input: {
  jobId: string;
  candidateId: string;
  capability: FreeEnrichmentCapability;
  attempt: number;
  outcome: string;
  durationMs: number;
}): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.VITEST) return;
  console.info("[free-enrichment.job]", {
    jobId: input.jobId,
    candidateId: input.candidateId,
    capability: input.capability,
    attempt: input.attempt,
    outcome: input.outcome,
    durationMs: input.durationMs,
  });
}

function hunterCode(err: unknown): string {
  if (err instanceof HunterDiscoveryError) return err.code;
  return "provider_unavailable";
}

export async function processClaimedFreeEnrichmentJob(input: {
  job: FreeEnrichmentJob;
  repos: FreeEnrichmentWorkerRepos;
  providers: FreeEnrichmentWorkerProviders;
  now?: () => Date;
}): Promise<FreeEnrichmentJob> {
  const now = input.now ?? (() => new Date());
  const started = now();
  const candidate = await input.repos.candidates.get(input.job.candidateId);
  if (!candidate || !candidateEligibleForFreeEnrichment(candidate)) {
    const finalized = await input.repos.jobs.finalize(input.job.id, {
      status: "cancelled",
      errorCode: "candidate_ineligible",
      providerOutcome: "cancelled",
    });
    logFreeEnrichmentJobDev({
      jobId: input.job.id,
      candidateId: input.job.candidateId,
      capability: input.job.capability,
      attempt: input.job.attemptCount,
      outcome: "cancelled",
      durationMs: now().getTime() - started.getTime(),
    });
    return finalized;
  }

  try {
    if (input.job.capability === "public_company_contacts") {
      if (!input.providers.publicWebsite) {
        return finish(input, "failed", "provider_disabled", "provider_disabled", now, started, false);
      }
      if (!normalizeDomain(candidate.domain) && !blankToUndefined(candidate.website)) {
        return finish(input, "failed", "invalid_input", "invalid_input", now, started, false);
      }
      const [productMatches, contacts] = await Promise.all([
        input.repos.productMatches.listByCandidate(candidate.id),
        input.repos.contacts.listByCandidate(candidate.id),
      ]);
      const result = await discoverPublicCompanyContactsForCandidate({
        candidate,
        contacts,
        productMatches,
        provider: input.providers.publicWebsite,
        repositories: { candidates: input.repos.candidates, publicEmails: input.repos.publicEmails },
        now,
      });
      return finalizeFromOutcome(input, result.outcome, now, started);
    }

    if (!input.providers.decisionMakers) {
      return finish(input, "failed", "provider_disabled", "provider_disabled", now, started, false);
    }
    if (!normalizeDomain(candidate.domain) || !blankToUndefined(candidate.companyName)) {
      return finish(input, "failed", "invalid_input", "invalid_input", now, started, false);
    }
    const productMatches = await input.repos.productMatches.listByCandidate(candidate.id);
    const result = await discoverPeopleForCandidate({
      candidate,
      productMatches,
      provider: input.providers.decisionMakers,
      repositories: { candidates: input.repos.candidates, contacts: input.repos.contacts },
      now,
    });
    const outcome = result.acceptedSameDomain === 0 ? "no_result" : "ok";
    return finalizeFromOutcome(input, outcome, now, started);
  } catch (err) {
    const code =
      input.job.capability === "public_company_contacts" ? "unavailable" : hunterCode(err);
    return finalizeFromOutcome(input, code, now, started);
  }
}

async function finalizeFromOutcome(
  input: {
    job: FreeEnrichmentJob;
    repos: FreeEnrichmentWorkerRepos;
  },
  outcome: string,
  now: () => Date,
  started: Date,
): Promise<FreeEnrichmentJob> {
  if (outcome === "ok" || outcome === "success") {
    return finish(input, "succeeded", outcome, null, now, started);
  }
  if (outcome === "no_result" || outcome === "blocked") {
    return finish(input, outcome === "blocked" ? "succeeded" : "no_result", outcome, null, now, started, false);
  }
  const retryable =
    input.job.capability === "public_company_contacts"
      ? PUBLIC_RETRYABLE.has(outcome)
      : HUNTER_RETRYABLE.has(outcome);
  if (retryable) {
    return finish(input, "retry_wait", outcome, outcome, now, started, true);
  }
  return finish(input, "failed", outcome, outcome, now, started, false);
}

async function finish(
  input: { job: FreeEnrichmentJob; repos: FreeEnrichmentWorkerRepos },
  status: "succeeded" | "no_result" | "failed" | "retry_wait",
  providerOutcome: string,
  errorCode: string | null,
  now: () => Date,
  started: Date,
  maybeRetry = false,
): Promise<FreeEnrichmentJob> {
  let nextStatus = status;
  let nextAttemptAt: string | null = null;
  if (maybeRetry && status === "retry_wait") {
    if (input.job.attemptCount >= FREE_ENRICHMENT_MAX_ATTEMPTS) {
      nextStatus = "failed";
    } else {
      const wait = backoffMsAfterAttempt(input.job.attemptCount);
      nextAttemptAt = wait != null ? new Date(now().getTime() + wait).toISOString() : null;
      if (!nextAttemptAt) nextStatus = "failed";
    }
  }
  const finalized = await input.repos.jobs.finalize(input.job.id, {
    status: nextStatus,
    providerOutcome,
    errorCode,
    nextAttemptAt,
  });
  logFreeEnrichmentJobDev({
    jobId: input.job.id,
    candidateId: input.job.candidateId,
    capability: input.job.capability,
    attempt: input.job.attemptCount,
    outcome: nextStatus,
    durationMs: now().getTime() - started.getTime(),
  });
  return finalized;
}

/**
 * Claim and process at most one due job per capability.
 * Callable from the authenticated drain route or a future scheduler.
 */
export async function drainDueFreeEnrichmentJobs(input: {
  repos: FreeEnrichmentWorkerRepos;
  providers: FreeEnrichmentWorkerProviders;
  now?: () => Date;
}): Promise<DrainFreeEnrichmentResult> {
  const now = input.now ?? (() => new Date());
  await input.repos.jobs.reclaimStaleProcessing(now());
  const capabilities: FreeEnrichmentCapability[] = ["decision_makers", "public_company_contacts"];
  let claimed = 0;
  let processed = 0;
  let skipped = 0;
  for (const capability of capabilities) {
    if (capability === "public_company_contacts" && !input.providers.publicWebsite) {
      skipped += 1;
      continue;
    }
    if (capability === "decision_makers" && !input.providers.decisionMakers) {
      skipped += 1;
      continue;
    }
    const job = await input.repos.jobs.claimNextDue(capability, now());
    if (!job) {
      skipped += 1;
      continue;
    }
    claimed += 1;
    await processClaimedFreeEnrichmentJob({
      job,
      repos: input.repos,
      providers: input.providers,
      now,
    });
    processed += 1;
  }
  return { claimed, processed, skipped };
}

export type OperatorFreeEnrichmentRun =
  | { kind: "already_running"; job: FreeEnrichmentJob }
  | { kind: "not_found" }
  | { kind: "processed"; job: FreeEnrichmentJob };

/**
 * Explicit operator path. Does NOT require the auto-free-enrichment gate.
 * Shares claim + processClaimedFreeEnrichmentJob with the drain worker.
 */
export async function runOperatorFreeEnrichmentJob(input: {
  candidateId: string;
  capability: FreeEnrichmentCapability;
  repos: FreeEnrichmentWorkerRepos;
  providers: FreeEnrichmentWorkerProviders;
  now?: () => Date;
}): Promise<OperatorFreeEnrichmentRun> {
  const now = input.now ?? (() => new Date());
  const candidate = await input.repos.candidates.get(input.candidateId);
  if (!candidate || !candidateEligibleForFreeEnrichment(candidate)) {
    return { kind: "not_found" };
  }
  const alreadyComplete =
    input.capability === "public_company_contacts"
      ? Boolean(candidate.publicContactsSearchedAt)
      : Boolean(candidate.peopleSearchedAt);
  const ensured = await input.repos.jobs.ensure({
    candidateId: candidate.id,
    capability: input.capability,
    alreadyComplete,
  });
  const prepared = await input.repos.jobs.prepareForManualExecution(ensured.id, now());
  if (!prepared) return { kind: "not_found" };
  if (prepared.status === "processing") {
    return { kind: "already_running", job: prepared };
  }
  const claimed = await input.repos.jobs.claimById(prepared.id, now());
  if (!claimed) {
    const current = await input.repos.jobs.get(prepared.id);
    if (current) return { kind: "already_running", job: current };
    return { kind: "not_found" };
  }
  const processed = await processClaimedFreeEnrichmentJob({
    job: claimed,
    repos: input.repos,
    providers: input.providers,
    now,
  });
  return { kind: "processed", job: processed };
}
