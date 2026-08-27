import { PageContainer, PageHeader } from "@/components/ui/Page";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function BuyerFinderLoading() {
  return (
    <PageContainer>
      <PageHeader title="Buyer Finder" />
      <div className="mb-6">
        <Skeleton height={44} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} padding={20} />
        ))}
      </div>
    </PageContainer>
  );
}
