import { PageContainer, PageHeader } from "@/components/ui/Page";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        subtitle="Company, brand, email defaults, assets, and workspace data."
      />
      <div className="grid md:grid-cols-[220px_minmax(0,1fr)] gap-8">
        <aside className="flex md:flex-col gap-1" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={32} width="100%" />
          ))}
        </aside>
        <div>
          <div className="mb-5">
            <Skeleton height={18} width="20%" />
            <div className="mt-2">
              <Skeleton height={12} width="60%" />
            </div>
          </div>
          <SkeletonCard padding={0}>
            <div className="p-5 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <Skeleton height={10} width="24%" />
                  <div className="mt-1.5">
                    <Skeleton height={38} />
                  </div>
                </div>
              ))}
            </div>
          </SkeletonCard>
        </div>
      </div>
    </PageContainer>
  );
}
