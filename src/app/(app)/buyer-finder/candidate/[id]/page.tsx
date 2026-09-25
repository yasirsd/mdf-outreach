import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { loadBuyerCandidateAction } from "@/app/(app)/buyer-finder/actions";
import { hunterDiscoveryAvailability, hunterRevealAvailability, publicWebsiteAvailability } from "@/lib/buyerFinder/config";
import { CandidateView } from "./CandidateView";
import { requireMdfSession } from "@/lib/auth/require";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { createTradeResearchReadRepository } from "@/lib/tradeResearch/repository";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: { id: string } }) {
  const session = await requireMdfSession();
  const [record, researchJob] = await Promise.all([
    loadBuyerCandidateAction(params.id),
    createTradeResearchReadRepository(createClient(cookies()), session.membership.workspaceId).getLatestJobForCandidate(params.id),
  ]);
  if (!record) {
    return (
      <PageContainer>
        <PageHeader
          title="Candidate not found"
          subtitle="This candidate does not exist in your workspace or has been removed."
        />
        <Link href="/buyer-finder" className="btn-secondary">
          Back to Buyer Finder
        </Link>
      </PageContainer>
    );
  }
  return (
    <CandidateView
      record={record}
      hunterDiscovery={hunterDiscoveryAvailability()}
      hunterReveal={hunterRevealAvailability()}
      publicWebsite={publicWebsiteAvailability()}
      publicJobStatus={record.publicJobStatus}
      peopleJobStatus={record.peopleJobStatus}
      isOwner={session.membership.role === "owner"}
      initialTradeResearchJob={researchJob}
    />
  );
}
