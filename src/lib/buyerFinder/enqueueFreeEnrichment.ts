import "server-only";

import type { BuyerCandidate } from "./types";
import type { BuyerFinderFreeEnrichmentJobRepository } from "@/lib/repositories/interfaces";
import type { FreeEnrichmentCapability } from "./freeEnrichmentJob";

export function candidateEligibleForFreeEnrichment(candidate: BuyerCandidate): boolean {
  return candidate.discoveryStatus !== "archived" && candidate.reviewStatus !== "rejected";
}

export async function ensureFreeEnrichmentJobsForCandidate(input: {
  candidate: BuyerCandidate;
  jobs: BuyerFinderFreeEnrichmentJobRepository;
}): Promise<void> {
  if (!candidateEligibleForFreeEnrichment(input.candidate)) {
    await input.jobs.cancelOpenForCandidate(input.candidate.id);
    return;
  }
  await input.jobs.ensure({
    candidateId: input.candidate.id,
    capability: "public_company_contacts",
    alreadyComplete: Boolean(input.candidate.publicContactsSearchedAt),
  });
  await input.jobs.ensure({
    candidateId: input.candidate.id,
    capability: "decision_makers",
    alreadyComplete: Boolean(input.candidate.peopleSearchedAt),
  });
}

/**
 * Idempotent DB-only repair. Call from bounded queue/detail loads, not
 * from the autopump tick. Missing rows are inserted; completed timestamps
 * become succeeded/already_complete. No provider calls.
 */
export async function repairMissingFreeEnrichmentJobs(input: {
  candidates: BuyerCandidate[];
  jobs: BuyerFinderFreeEnrichmentJobRepository;
}): Promise<{ inserted: number }> {
  const existing = await input.jobs.listAll();
  const have = new Set(existing.map((j) => `${j.candidateId}:${j.capability}`));
  let inserted = 0;
  for (const candidate of input.candidates) {
    if (!candidateEligibleForFreeEnrichment(candidate)) {
      await input.jobs.cancelOpenForCandidate(candidate.id);
      continue;
    }
    const caps: FreeEnrichmentCapability[] = ["public_company_contacts", "decision_makers"];
    for (const capability of caps) {
      const key = `${candidate.id}:${capability}`;
      if (have.has(key)) continue;
      const alreadyComplete =
        capability === "public_company_contacts"
          ? Boolean(candidate.publicContactsSearchedAt)
          : Boolean(candidate.peopleSearchedAt);
      await input.jobs.ensure({ candidateId: candidate.id, capability, alreadyComplete });
      have.add(key);
      inserted += 1;
    }
  }
  return { inserted };
}
