import { BuyerFinderView } from "./BuyerFinderView";
import { loadBuyerCandidateQueueAction } from "./actions";
import { getLatestActiveBuyerFinderSearchRunAction } from "./searchRunActions";
import { hunterDiscoveryAvailability } from "@/lib/buyerFinder/config";

export const dynamic = "force-dynamic";

export default async function BuyerFinderPage() {
  const [initial, activeRun] = await Promise.all([
    loadBuyerCandidateQueueAction(),
    getLatestActiveBuyerFinderSearchRunAction(),
  ]);
  return (
    <BuyerFinderView
      initialQueue={initial.rows}
      initialSummary={initial.summary}
      queueLimit={initial.limit}
      hunterDiscovery={hunterDiscoveryAvailability()}
      initialActiveRun={activeRun}
    />
  );
}
