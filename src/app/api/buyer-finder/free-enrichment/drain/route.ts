import { NextResponse } from "next/server";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import {
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
} from "@/lib/buyerFinder/config";
import { drainDueFreeEnrichmentJobs } from "@/lib/buyerFinder/freeEnrichmentWorker";
import { createPublicWebsiteCompanyContactProvider } from "@/lib/buyerFinder/providers/publicWebsite/companyContacts";
import { createHunterPersonDiscoveryProvider } from "@/lib/buyerFinder/providers/hunter/personDiscovery";

/**
 * Authenticated drain of due free-enrichment jobs.
 * The DB queue is the source of truth. This route processes at most
 * one job per capability per request. Never calls paid reveal.
 *
 * Website jobs always have a provider. Decision-maker jobs are only
 * claimed when Hunter credentials are present — missing config must
 * not burn retry_count.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  await requireMdfSession();

  const { repos } = await serverRepositories();
  const result = await drainDueFreeEnrichmentJobs({
    repos: {
      jobs: repos.buyerFinderFreeEnrichmentJobs,
      candidates: repos.buyerCandidates,
      contacts: repos.buyerCandidateContacts,
      productMatches: repos.buyerCandidateProductMatches,
      publicEmails: repos.buyerCandidatePublicEmails,
    },
    providers: {
      publicWebsite: createPublicWebsiteCompanyContactProvider(),
      decisionMakers: isBuyerFinderHunterReady()
        ? createHunterPersonDiscoveryProvider({ apiKey: requireBuyerFinderHunterApiKey() })
        : undefined,
    },
  });
  return NextResponse.json({
    outcome: "ok",
    idle: result.claimed === 0,
    ...result,
  });
}
