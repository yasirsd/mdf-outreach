import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function CampaignPreviewLoading() {
  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <Skeleton height={32} width={90} />
        <Skeleton height={32} width={90} />
        <div className="ml-auto flex gap-2">
          <Skeleton height={32} width={110} />
          <Skeleton height={32} width={110} />
        </div>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_260px] gap-4">
        <div
          className="rounded-[12px]"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            minHeight: 720,
          }}
          aria-hidden
        />
        <SkeletonCard padding={16}>
          <Skeleton height={10} width="40%" />
          <div className="mt-3 space-y-3">
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}
