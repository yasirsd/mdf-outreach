"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import { runOperatorFreeEnrichmentJob } from "@/lib/buyerFinder/freeEnrichmentWorker";
import { createPublicWebsiteCompanyContactProvider } from "@/lib/buyerFinder/providers/publicWebsite/companyContacts";
import { scoreBuyerCandidate } from "@/lib/buyerFinder/scoring";
import { blankToUndefined, normalizeDomain } from "@/lib/buyerFinder/normalize";
import type { BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";
import type { ProviderNeutralOutcome } from "@/lib/buyerFinder/providers/descriptors";
import type { FreeEnrichmentJob } from "@/lib/buyerFinder/freeEnrichmentJob";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicCompanyContactOutcome =
  | ProviderNeutralOutcome
  | "ok"
  | "disabled"
  | "already_running"
  | "invalid_input"
  | "blocked"
  | "timeout"
  | "unavailable"
  | "incomplete";

export interface SafePublicCompanyContactSummary {
  outcome: PublicCompanyContactOutcome;
  message?: string;
  discovered: number;
  persisted: number;
  updatedExisting: number;
  pagesFetched: number;
  overallScore?: number;
  companyFit?: number;
  contactQuality?: number;
  completeness?: number;
  emails: BuyerCandidatePublicEmail[];
}

function emptySummary(
  outcome: PublicCompanyContactOutcome,
  message?: string,
): SafePublicCompanyContactSummary {
  return {
    outcome,
    message,
    discovered: 0,
    persisted: 0,
    updatedExisting: 0,
    pagesFetched: 0,
    emails: [],
  };
}

function outcomeMessage(outcome: PublicCompanyContactOutcome): string | undefined {
  switch (outcome) {
    case "unavailable":
      return "Website unavailable.";
    case "blocked":
      return "Website blocked automated access.";
    case "timeout":
      return "Lookup timed out.";
    case "incomplete":
      return "Some website pages could not be checked.";
    case "no_result":
      return "No public company email found.";
    case "already_running":
      return "Lookup in progress.";
    default:
      return undefined;
  }
}

function jobToPublicOutcome(job: FreeEnrichmentJob): PublicCompanyContactOutcome {
  if (job.status === "succeeded") {
    return job.providerOutcome === "blocked" ? "blocked" : "success";
  }
  if (job.status === "no_result") return "no_result";
  const raw = job.providerOutcome ?? job.errorCode ?? "";
  if (raw === "incomplete" || raw === "timeout" || raw === "unavailable" || raw === "blocked") {
    return raw;
  }
  if (job.status === "cancelled") return "invalid_input";
  return "unavailable";
}

/**
 * BF3A.5 / BF3C.1 — free public company-contact lookup for ONE candidate.
 *
 * Browser supplies only candidateId. Website/domain come from the
 * persisted candidate. Coordinates through the durable job claim so
 * auto drain cannot crawl the same candidate at the same time.
 * Independent of Hunter credentials. Always available when the
 * candidate has a website or domain. Never reveals personal contacts.
 */
export async function findCandidatePublicCompanyContactsAction(
  candidateId: string,
): Promise<SafePublicCompanyContactSummary> {
  await requireMdfSession();
  const id = (candidateId ?? "").trim();
  if (!UUID_RE.test(id)) {
    return emptySummary("invalid_input", "Invalid candidate id.");
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
  if (!normalizeDomain(candidate.domain) && !blankToUndefined(candidate.website)) {
    return emptySummary("invalid_input", "This candidate needs a company website or domain.");
  }

  try {
    const run = await runOperatorFreeEnrichmentJob({
      candidateId: id,
      capability: "public_company_contacts",
      repos: {
        jobs: repos.buyerFinderFreeEnrichmentJobs,
        candidates: repos.buyerCandidates,
        contacts: repos.buyerCandidateContacts,
        productMatches: repos.buyerCandidateProductMatches,
        publicEmails: repos.buyerCandidatePublicEmails,
      },
      providers: { publicWebsite: createPublicWebsiteCompanyContactProvider() },
    });

    if (run.kind === "not_found") {
      return emptySummary("invalid_input", "Candidate not found.");
    }
    if (run.kind === "already_running") {
      const emails = await repos.buyerCandidatePublicEmails.listByCandidate(id);
      return {
        ...emptySummary("already_running", outcomeMessage("already_running")),
        persisted: emails.length,
        emails,
      };
    }

    const [productMatches, contacts, emails, refreshed] = await Promise.all([
      repos.buyerCandidateProductMatches.listByCandidate(id),
      repos.buyerCandidateContacts.listByCandidate(id),
      repos.buyerCandidatePublicEmails.listByCandidate(id),
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
    const outcome = jobToPublicOutcome(run.job);

    revalidatePath("/buyer-finder");
    revalidatePath(`/buyer-finder/candidate/${id}`);

    return {
      outcome,
      message: outcomeMessage(outcome),
      discovered: emails.length,
      persisted: emails.length,
      updatedExisting: 0,
      pagesFetched: 0,
      overallScore: scored?.total,
      companyFit: scored?.companyFit,
      contactQuality: scored?.contactQuality,
      completeness: scored?.completeness,
      emails,
    };
  } catch {
    return emptySummary("unavailable", "Website unavailable.");
  }
}
