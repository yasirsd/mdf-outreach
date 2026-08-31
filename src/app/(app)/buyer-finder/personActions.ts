"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import {
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
  HUNTER_NOT_CONFIGURED_MESSAGE,
} from "@/lib/buyerFinder/config";
import { createHunterPersonDiscoveryProvider } from "@/lib/buyerFinder/providers/hunter/personDiscovery";
import { hunterErrorCodeToOutcome } from "@/lib/buyerFinder/providers/descriptors";
import { toSafeContacts, type SafeBuyerCandidateContact } from "@/lib/buyerFinder/safeContact";
import { scoreBuyerCandidate } from "@/lib/buyerFinder/scoring";
import { blankToUndefined, normalizeDomain } from "@/lib/buyerFinder/normalize";
import { runOperatorFreeEnrichmentJob } from "@/lib/buyerFinder/freeEnrichmentWorker";
import type { ProviderNeutralOutcome } from "@/lib/buyerFinder/providers/descriptors";
import type { FreeEnrichmentJob } from "@/lib/buyerFinder/freeEnrichmentJob";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PersonSearchOutcome =
  | ProviderNeutralOutcome
  | "ok"
  | "disabled"
  | "already_running"
  | "invalid_input";

export interface SafePersonSearchSummary {
  outcome: PersonSearchOutcome;
  message?: string;
  discovered: number;
  persisted: number;
  updatedExisting: number;
  discardedOtherDomain: number;
  hasMore: boolean;
  overallScore?: number;
  companyFit?: number;
  contactQuality?: number;
  completeness?: number;
  contacts: SafeBuyerCandidateContact[];
}

function emptySummary(outcome: PersonSearchOutcome, message?: string): SafePersonSearchSummary {
  return {
    outcome,
    message,
    discovered: 0,
    persisted: 0,
    updatedExisting: 0,
    discardedOtherDomain: 0,
    hasMore: false,
    contacts: [],
  };
}

function messageForHunterCode(code: string | undefined): string {
  switch (code) {
    case "unauthorized":
      return "Hunter configuration needs attention.";
    case "forbidden":
      return "Hunter refused this request.";
    case "rate_limited":
      return "Hunter is temporarily rate limited. Try again shortly.";
    case "timeout":
      return "Hunter did not respond in time.";
    case "invalid_request":
      return "Person search parameters were rejected by Hunter.";
    case "invalid_response":
      return "Hunter returned an unexpected response.";
    case "invalid_input":
      return "Person search parameters were invalid.";
    default:
      return "Hunter is temporarily unavailable.";
  }
}

function jobToPersonOutcome(job: FreeEnrichmentJob): [PersonSearchOutcome, string | undefined] {
  if (job.status === "succeeded") return ["success", undefined];
  if (job.status === "no_result") {
    return ["no_result", "No matching people were found at this company domain."];
  }
  if (job.status === "cancelled") {
    return ["invalid_input", "This candidate cannot be searched."];
  }
  const code = job.errorCode ?? job.providerOutcome ?? "provider_unavailable";
  if (code === "invalid_input") return ["invalid_input", messageForHunterCode(code)];
  const hunterCodes = [
    "invalid_request",
    "unauthorized",
    "forbidden",
    "rate_limited",
    "provider_unavailable",
    "timeout",
    "invalid_response",
  ] as const;
  const mapped = hunterCodes.find((c) => c === code);
  if (mapped) return [hunterErrorCodeToOutcome(mapped), messageForHunterCode(code)];
  return ["temporarily_unavailable", messageForHunterCode(code)];
}

/**
 * BF3A / BF3C.1 — free masked decision-maker discovery for ONE candidate.
 *
 * Browser supplies only candidateId. Does not consult the enrichment
 * or reveal gates. Requires Hunter API credentials. Coordinates through
 * the durable job claim so auto drain cannot search the same candidate
 * at the same time.
 */
export async function findCandidateDecisionMakersAction(
  candidateId: string,
): Promise<SafePersonSearchSummary> {
  await requireMdfSession();
  const id = (candidateId ?? "").trim();
  if (!UUID_RE.test(id)) {
    return emptySummary("invalid_input", "Invalid candidate id.");
  }
  if (!isBuyerFinderHunterReady()) {
    return emptySummary("not_configured", HUNTER_NOT_CONFIGURED_MESSAGE);
  }

  const { repos } = await serverRepositories();
  const candidate = await repos.buyerCandidates.get(id);
  if (!candidate) return emptySummary("invalid_input", "Candidate not found.");
  if (candidate.discoveryStatus === "archived") {
    return emptySummary("invalid_input", "Archived candidates cannot be searched.");
  }
  if (candidate.reviewStatus === "rejected") {
    return emptySummary("invalid_input", "Rejected candidates cannot be searched.");
  }
  if (!normalizeDomain(candidate.domain) || !blankToUndefined(candidate.companyName)) {
    return emptySummary("invalid_input", "This candidate needs a company name and domain.");
  }

  const run = await runOperatorFreeEnrichmentJob({
    candidateId: id,
    capability: "decision_makers",
    repos: {
      jobs: repos.buyerFinderFreeEnrichmentJobs,
      candidates: repos.buyerCandidates,
      contacts: repos.buyerCandidateContacts,
      productMatches: repos.buyerCandidateProductMatches,
      publicEmails: repos.buyerCandidatePublicEmails,
    },
    providers: {
      decisionMakers: createHunterPersonDiscoveryProvider({
        apiKey: requireBuyerFinderHunterApiKey(),
      }),
    },
  });

  if (run.kind === "not_found") {
    return emptySummary("invalid_input", "Candidate not found.");
  }

  const [productMatches, contacts, refreshed] = await Promise.all([
    repos.buyerCandidateProductMatches.listByCandidate(id),
    repos.buyerCandidateContacts.listByCandidate(id),
    repos.buyerCandidates.get(id),
  ]);
  const scored = refreshed
    ? scoreBuyerCandidate({
        candidate: refreshed,
        contacts,
        productMatches,
        targetProductId: productMatches[0]?.productId,
        targetCountry: refreshed.country,
      })
    : undefined;
  const safe = toSafeContacts(contacts);

  if (run.kind === "already_running") {
    return {
      ...emptySummary("already_running", "Lookup in progress."),
      persisted: safe.length,
      contacts: safe,
      overallScore: scored?.total,
      companyFit: scored?.companyFit,
      contactQuality: scored?.contactQuality,
      completeness: scored?.completeness,
    };
  }

  const [outcome, message] = jobToPersonOutcome(run.job);
  revalidatePath("/buyer-finder");
  revalidatePath(`/buyer-finder/candidate/${id}`);

  return {
    outcome,
    message,
    discovered: safe.length,
    persisted: safe.length,
    updatedExisting: 0,
    discardedOtherDomain: 0,
    hasMore: false,
    overallScore: scored?.total,
    companyFit: scored?.companyFit,
    contactQuality: scored?.contactQuality,
    completeness: scored?.completeness,
    contacts: safe,
  };
}
