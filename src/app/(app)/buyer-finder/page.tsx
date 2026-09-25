import { cookies } from "next/headers";
import { BuyerFinderView } from "./BuyerFinderView";
import {
  loadBuyerCandidateQueueAction,
  loadBuyerCandidateQueueReadOnlyAction,
} from "./actions";
import { getLatestActiveBuyerFinderSearchRunAction } from "./searchRunActions";
import { getFreeEnrichmentSummaryAction } from "./freeEnrichmentActions";
import {
  hunterDiscoveryAvailability,
  hunterRevealAvailability,
  publicWebsiteAvailability,
} from "@/lib/buyerFinder/config";
import { requireMdfSession } from "@/lib/auth/require";
import { createClient } from "@/utils/supabase/server";
import { createMarketReadRepository } from "@/lib/marketIntelligence/marketReadRepository";
import { getMarketIntelligenceHandoffContext } from "@/lib/marketIntelligence/read/overview";
import { resolveMarketIntelligenceBuyerFinderHandoff } from "@/lib/marketIntelligence/buyerFinderHandoff";
import { createTradeResearchReadRepository } from "@/lib/tradeResearch/repository";

export const dynamic = "force-dynamic";
// BI4F 2A Hobby-plan headroom: the server action awaits a bounded
// trade-research drain kick after batch creation (up to
// INLINE_KICK_MS ~= 12 s + normal request overhead). 60 s is Vercel's
// Hobby-plan function ceiling and gives the drain safe margin even on
// a cold FDA XLSX fetch. Never grows the drain's own row-count budget.
export const maxDuration = 60;

export default async function BuyerFinderPage({
  searchParams,
}: {
  searchParams?: {
    source?: string | string[];
    product?: string | string[];
    country?: string | string[];
    returnCompare?: string | string[];
  };
}) {
  const session = await requireMdfSession();
  const supabase = createClient(cookies());
  const handoff = resolveMarketIntelligenceBuyerFinderHandoff(searchParams);
  const marketContextPromise = handoff
    ? getMarketIntelligenceHandoffContext(
        handoff.productId,
        handoff.countryAlpha2,
        createMarketReadRepository(supabase),
      )
    : Promise.resolve(undefined);
  const [initial, activeRun, enrichmentSummary, marketContext, researchBatch] = await Promise.all([
    handoff ? loadBuyerCandidateQueueReadOnlyAction() : loadBuyerCandidateQueueAction(),
    getLatestActiveBuyerFinderSearchRunAction(),
    getFreeEnrichmentSummaryAction(),
    marketContextPromise,
    createTradeResearchReadRepository(supabase, session.membership.workspaceId).getLatestBatch(),
  ]);
  return (
    <BuyerFinderView
      initialQueue={initial.rows}
      initialSummary={initial.summary}
      queueLimit={initial.limit}
      hunterDiscovery={hunterDiscoveryAvailability()}
      hunterReveal={hunterRevealAvailability()}
      publicWebsite={publicWebsiteAvailability()}
      initialActiveRun={activeRun}
      enrichmentSummary={enrichmentSummary}
      initialQuery={handoff ? { country: handoff.countryName, productId: handoff.productId } : undefined}
      marketHandoff={handoff}
      marketContext={marketContext}
      isOwner={session.membership.role === "owner"}
      initialResearchBatch={researchBatch}
    />
  );
}
