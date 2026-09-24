import { PageContainer } from "@/components/ui/Page";
import { Skeleton, SkeletonCard, SkeletonTable, SkeletonText } from "@/components/ui/Skeleton";

export default function MarketIntelligenceLoading() {
  return (
    <PageContainer size="wide">
      <main aria-busy="true" aria-live="polite" aria-label="Loading Market Intelligence">
        <span className="sr-only" role="status">Loading Market Intelligence</span>

        <header className="mb-5 flex items-start justify-between gap-6 flex-wrap" aria-hidden>
          <div className="w-full max-w-2xl">
            <Skeleton height={10} width={132} />
            <Skeleton className="mt-3" height={29} width="72%" />
            <SkeletonText className="mt-3" lines={2} lastWidth="82%" size={13} />
          </div>
          <Skeleton height={34} width={220} />
        </header>

        <section
          className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 rounded-[12px] p-3.5"
          style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
          aria-hidden
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index}>
              <Skeleton height={10} width="62%" />
              <Skeleton className="mt-2" height={22} width="46%" />
            </div>
          ))}
          <Skeleton className="col-span-2 md:col-span-4 mt-1" height={10} width="38%" />
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 items-start">
          <div aria-hidden>
            <SkeletonCard className="mb-0 rounded-b-none" padding={18}>
              <Skeleton height={13} width={118} />
              <Skeleton className="mt-2" height={10} width={190} />
            </SkeletonCard>
            <SkeletonTable className="rounded-t-none" rows={10} columns={9} />
          </div>

          <SkeletonCard className="flex flex-col gap-4" padding={20}>
            <Skeleton height={10} width={34} />
            <Skeleton height={24} width="46%" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton height={86} />
              <Skeleton height={86} />
            </div>
            <Skeleton height={58} />
            <div className="grid grid-cols-1 gap-3">
              <Skeleton height={210} />
              <Skeleton height={210} />
            </div>
            <Skeleton height={164} />
            <Skeleton height={176} />
          </SkeletonCard>
        </div>
      </main>
    </PageContainer>
  );
}
