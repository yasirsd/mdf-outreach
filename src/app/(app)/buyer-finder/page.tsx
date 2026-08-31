import { BuyerFinderView } from "./BuyerFinderView";
import { loadBuyerCandidateQueueAction } from "./actions";
import { getLatestActiveBuyerFinderSearchRunAction } from "./searchRunActions";
import { getFreeEnrichmentSummaryAction } from "./freeEnrichmentActions";
import {
  hunterDiscoveryAvailability,
  hunterRevealAvailability,
  publicWebsiteAvailability,
} from "@/lib/buyerFinder/config";

export const dynamic = "force-dynamic";

export default async function BuyerFinderPage() {
  const [initial, activeRun, enrichmentSummary] = await Promise.all([
    loadBuyerCandidateQueueAction(),
    getLatestActiveBuyerFinderSearchRunAction(),
    getFreeEnrichmentSummaryAction(),
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
    />
  );
}
