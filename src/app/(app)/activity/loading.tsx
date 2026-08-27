import { PageContainer, PageHeader } from "@/components/ui/Page";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ActivityLoading() {
  return (
    <PageContainer>
      <PageHeader
        title="Activity"
        subtitle="A timeline of everything that happens in this workspace."
      />
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, day) => (
          <section key={day}>
            <div className="mb-3">
              <Skeleton height={11} width={140} />
            </div>
            <div
              className="rounded-[12px] divide-y"
              style={{
                backgroundColor: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderColor: "var(--app-border)",
              }}
              aria-hidden
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <Skeleton height={13} width="70%" />
                  </div>
                  <Skeleton height={10} width={90} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
