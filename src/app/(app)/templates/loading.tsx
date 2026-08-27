import { PageContainer, PageHeader } from "@/components/ui/Page";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function TemplatesLoading() {
  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        subtitle="Approved MDF master templates. Choose one for a campaign — the campaign keeps its own snapshot."
      />
      <div className="mb-8">
        <Skeleton height={12} width="30%" />
      </div>
      <div className="space-y-12">
        {Array.from({ length: 4 }).map((_, groupIdx) => (
          <section key={groupIdx}>
            <div className="mb-5 flex items-center gap-3">
              <Skeleton height={11} width={120} />
              <div className="flex-1">
                <Skeleton height={1} />
              </div>
            </div>
            <div className="mb-3 flex items-center gap-3">
              <Skeleton height={18} width="26%" />
              <Skeleton height={12} width={120} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <SkeletonCard padding={0}>
                <div style={{ height: 280 }} />
              </SkeletonCard>
              <SkeletonCard padding={0}>
                <div style={{ height: 280 }} />
              </SkeletonCard>
            </div>
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
