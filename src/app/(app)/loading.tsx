import { PageContainer } from "@/components/ui/Page";
import { Skeleton, SkeletonCard, SkeletonMetric } from "@/components/ui/Skeleton";

/**
 * MDF Outreach — F6 Overview loading fallback.
 *
 * Shape-matches the new dashboard so the resolved page does not visibly
 * jump: 4 metric cards, a chart region + attention panel, pipeline +
 * campaign progress, follow-ups + recent activity.
 */
export default function AppLoading() {
  return (
    <PageContainer size="wide">
      <div className="mb-7 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <Skeleton height={10} width={80} />
          <div className="mt-2.5">
            <Skeleton height={20} width={220} />
          </div>
          <div className="mt-2">
            <Skeleton height={12} width={280} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton height={30} width={124} />
          <Skeleton height={36} width={132} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
        <SkeletonMetric />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] gap-4 mb-4 items-start">
        <SkeletonCard padding={20}>
          <Skeleton height={12} width={140} />
          <div className="mt-4">
            <Skeleton height={170} />
          </div>
        </SkeletonCard>
        <SkeletonCard padding={20}>
          <Skeleton height={12} width={130} />
          <div className="mt-4 space-y-2">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        </SkeletonCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 mb-4 items-start">
        <SkeletonCard padding={20}>
          <Skeleton height={12} width={120} />
          <div className="mt-4">
            <Skeleton height={10} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        </SkeletonCard>
        <SkeletonCard padding={20}>
          <Skeleton height={12} width={140} />
          <div className="mt-4 space-y-3">
            <Skeleton height={80} />
            <Skeleton height={80} />
            <Skeleton height={80} />
          </div>
        </SkeletonCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonCard padding={20}>
          <Skeleton height={12} width={100} />
          <div className="mt-4 space-y-2">
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        </SkeletonCard>
        <SkeletonCard padding={20}>
          <Skeleton height={12} width={120} />
          <div className="mt-4 space-y-2">
            <Skeleton height={30} />
            <Skeleton height={30} />
            <Skeleton height={30} />
            <Skeleton height={30} />
            <Skeleton height={30} />
          </div>
        </SkeletonCard>
      </div>
    </PageContainer>
  );
}
