import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function CampaignActivityLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <Skeleton height={12} width="20%" />
        <Skeleton height={30} width={220} />
      </div>
      <div className="mb-8">
        <SkeletonTable rows={6} columns={6} />
      </div>
      <Skeleton height={11} width="20%" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[10px] p-3.5 flex items-center gap-3"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border)",
            }}
            aria-hidden
          >
            <div className="flex-1">
              <Skeleton height={12} width="75%" />
            </div>
            <Skeleton height={10} width={80} />
          </div>
        ))}
      </div>
    </div>
  );
}
