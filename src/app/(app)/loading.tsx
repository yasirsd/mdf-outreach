import { PageContainer } from "@/components/ui/Page";
import { Skeleton, SkeletonCard, SkeletonMetric } from "@/components/ui/Skeleton";

/**
 * Generic app-shell loading fallback for any route that does not ship
 * its own loading.tsx. Sits under (app)/layout.tsx which already renders
 * the sidebar, so this only covers the page body.
 */
export default function AppLoading() {
  return (
    <PageContainer>
      <div className="mb-8">
        <Skeleton height={18} width="30%" />
        <div className="mt-3">
          <Skeleton height={12} width="45%" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
      </div>
      <SkeletonCard />
    </PageContainer>
  );
}
