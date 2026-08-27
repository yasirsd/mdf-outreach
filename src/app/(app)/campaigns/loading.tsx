import { PageContainer, PageHeader } from "@/components/ui/Page";
import { SkeletonCard } from "@/components/ui/Skeleton";

export default function CampaignsLoading() {
  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        subtitle="Each campaign groups a market, product, buyers, and email into one focused effort."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} padding={22} />
        ))}
      </div>
    </PageContainer>
  );
}
