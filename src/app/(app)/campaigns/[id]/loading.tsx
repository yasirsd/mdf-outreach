import { SkeletonCard, SkeletonMetric } from "@/components/ui/Skeleton";

/**
 * Fallback for the campaign Overview page ONLY.
 *
 * The layout renders the header + tabs synchronously (with the header
 * streamed via its own Suspense boundary), so this loading state fills
 * ONLY the body slot. Do NOT re-render header / tabs skeletons here —
 * they are already on screen.
 */
export default function CampaignLoading() {
  return (
    <>
      <div className="grid md:grid-cols-4 gap-3 mb-8" aria-hidden>
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
      </div>
      <div className="grid md:grid-cols-2 gap-4" aria-hidden>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </>
  );
}
