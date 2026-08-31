"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import { isFreeEnrichmentCapability, type FreeEnrichmentCapability } from "@/lib/buyerFinder/freeEnrichmentJob";
import { summarizeFreeEnrichmentJobs, type FreeEnrichmentSummary } from "@/lib/buyerFinder/freeEnrichmentSummary";
import { assessRevealPriority } from "@/lib/buyerFinder/revealPriority";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getFreeEnrichmentSummaryAction(): Promise<FreeEnrichmentSummary> {
  await requireMdfSession();
  const { repos } = await serverRepositories();
  const [candidates, jobs] = await Promise.all([
    repos.buyerCandidates.list(),
    repos.buyerFinderFreeEnrichmentJobs.listAll(),
  ]);
  const eligible = candidates.filter(
    (c) => c.discoveryStatus !== "archived" && c.reviewStatus !== "rejected",
  );
  let publicEmailCount = 0;
  let companiesWithPublicEmail = 0;
  let decisionMakerCount = 0;
  let highPriorityCount = 0;
  for (const candidate of eligible) {
    const [emails, contacts] = await Promise.all([
      repos.buyerCandidatePublicEmails.listByCandidate(candidate.id),
      repos.buyerCandidateContacts.listByCandidate(candidate.id),
    ]);
    publicEmailCount += emails.length;
    if (emails.length > 0 || candidate.generalEmail) companiesWithPublicEmail += 1;
    decisionMakerCount += contacts.length;
    const priority = assessRevealPriority({ candidate, contacts, publicEmails: emails });
    if (priority.tier === "high") highPriorityCount += 1;
  }
  return summarizeFreeEnrichmentJobs({
    jobs,
    companyIds: eligible.map((c) => c.id),
    publicEmailCount,
    companiesWithPublicEmail,
    decisionMakerCount,
    highPriorityCount,
  });
}

export async function requeueFreeEnrichmentJobAction(
  candidateId: string,
  capability: FreeEnrichmentCapability,
): Promise<{ outcome: "ok" | "invalid_input" | "not_found" }> {
  await requireMdfSession();
  const id = (candidateId ?? "").trim();
  if (!UUID_RE.test(id) || !isFreeEnrichmentCapability(capability)) {
    return { outcome: "invalid_input" };
  }
  const { repos } = await serverRepositories();
  const candidate = await repos.buyerCandidates.get(id);
  if (!candidate) return { outcome: "not_found" };
  if (candidate.discoveryStatus === "archived" || candidate.reviewStatus === "rejected") {
    return { outcome: "invalid_input" };
  }
  const job = await repos.buyerFinderFreeEnrichmentJobs.getByCandidateCapability(id, capability);
  if (!job) return { outcome: "not_found" };
  const requeued = await repos.buyerFinderFreeEnrichmentJobs.requeue(job.id);
  if (!requeued) return { outcome: "invalid_input" };
  revalidatePath("/buyer-finder");
  revalidatePath(`/buyer-finder/candidate/${id}`);
  return { outcome: "ok" };
}
