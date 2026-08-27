import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function CampaignSendLoading() {
  return (
    <div>
      <div className="mb-8">
        <Skeleton height={22} width="24%" />
        <div className="mt-2">
          <Skeleton height={12} width="55%" />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <SkeletonCard padding={22}>
          <Skeleton height={10} width="30%" />
          <div className="mt-3">
            <Skeleton height={22} width="70%" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton height={10} width="55%" />
                <div className="mt-1.5">
                  <Skeleton height={14} width="80%" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCard>
        <SkeletonCard padding={22}>
          <Skeleton height={10} width="42%" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={14} />
            ))}
          </div>
        </SkeletonCard>
      </div>
      <div className="grid md:grid-cols-3 gap-2 mt-6">
        <SkeletonCard padding={16} />
        <SkeletonCard padding={16} />
        <SkeletonCard padding={16} />
      </div>
      <div className="mt-4">
        <SkeletonCard padding={22}>
          <Skeleton height={10} width="18%" />
          <div className="mt-3 grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <Skeleton height={9} width="55%" />
                <div className="mt-1.5">
                  <Skeleton height={20} width="65%" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}
