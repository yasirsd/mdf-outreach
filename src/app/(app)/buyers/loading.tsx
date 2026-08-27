import { PageContainer, PageHeader } from "@/components/ui/Page";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function BuyersLoading() {
  return (
    <PageContainer size="wide">
      <PageHeader
        title="Buyers"
        subtitle="Your international buyer network — importers, distributors, and food ingredient companies."
      />
      <div
        className="rounded-[12px] mb-4 p-3 flex flex-wrap items-center gap-2"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
        aria-hidden
      >
        <Skeleton height={36} width={240} />
        <Skeleton height={36} width={140} />
        <Skeleton height={36} width={140} />
        <Skeleton height={36} width={140} />
        <div className="ml-auto">
          <Skeleton height={14} width={90} />
        </div>
      </div>
      <SkeletonTable rows={10} columns={6} />
    </PageContainer>
  );
}
