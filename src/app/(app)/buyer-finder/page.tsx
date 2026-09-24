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

export const dynamic = "force-dynamic";

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
  await requireMdfSession();
  const handoff = resolveMarketIntelligenceBuyerFinderHandoff(searchParams);
  const marketContextPromise = handoff
    ? getMarketIntelligenceHandoffContext(
        handoff.productId,
        handoff.countryAlpha2,
        createMarketReadRepository(createClient(cookies())),
      )
    : Promise.resolve(undefined);
  const [initial, activeRun, enrichmentSummary, marketContext] = await Promise.all([
    handoff ? loadBuyerCandidateQueueReadOnlyAction() : loadBuyerCandidateQueueAction(),
    getLatestActiveBuyerFinderSearchRunAction(),
    getFreeEnrichmentSummaryAction(),
    marketContextPromise,
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
    />
  );
}
