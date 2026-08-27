import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/**
 * Composer skeleton — approximates
 *   template control row
 *   [ section navigator | preview | properties ]
 */
export default function CampaignEmailLoading() {
  return (
    <div>
      <div
        className="rounded-[12px] p-4 mb-5 flex items-center gap-3"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
        aria-hidden
      >
        <Skeleton height={40} width="30%" />
        <Skeleton height={40} width="18%" />
        <div className="ml-auto flex gap-2">
          <Skeleton height={36} width={120} />
          <Skeleton height={36} width={100} />
        </div>
      </div>

      <SkeletonCard padding={18}>
        <Skeleton height={12} width="30%" />
        <div className="mt-3">
          <Skeleton height={40} />
        </div>
      </SkeletonCard>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)_260px] gap-4">
        <SkeletonCard padding={12}>
          <Skeleton height={10} width="40%" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} height={22} />
            ))}
          </div>
        </SkeletonCard>
        <div
          className="rounded-[12px]"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            minHeight: 640,
          }}
          aria-hidden
        />
        <SkeletonCard padding={16}>
          <Skeleton height={10} width="50%" />
          <div className="mt-3 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton height={9} width="40%" />
                <div className="mt-1">
                  <Skeleton height={34} />
                </div>
              </div>
            ))}
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}
