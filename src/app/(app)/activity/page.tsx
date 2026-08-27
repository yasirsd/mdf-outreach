import { serverRepositories } from "@/lib/repositories/server";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateTime } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

function dayKey(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date();
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default async function ActivityPage() {
  const { repos } = await serverRepositories();
  const activity = await repos.activity.list(500);

  const groupedMap = new Map<string, ActivityEvent[]>();
  for (const a of activity) {
    const key = dayKey(a.at);
    const arr = groupedMap.get(key) ?? [];
    arr.push(a);
    groupedMap.set(key, arr);
  }
  const grouped = Array.from(groupedMap.entries());

  return (
    <PageContainer>
      <PageHeader
        title="Activity"
        subtitle="A timeline of everything that happens in this workspace."
      />
      {activity.length === 0 ? (
        <EmptyState
          eyebrow="Empty"
          title="Nothing here yet."
          body="Your actions will appear here."
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(([day, events]) => (
            <section key={day}>
              <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-3 font-medium">
                {day}
              </div>
              <div
                className="rounded-[12px] divide-y"
                style={{
                  backgroundColor: "var(--app-surface)",
                  border: "1px solid var(--app-border)",
                  borderColor: "var(--app-border)",
                }}
              >
                {events.map((e) => (
                  <div
                    key={e.id}
                    className="p-4 flex items-start justify-between gap-3"
                    style={{ borderColor: "var(--app-border)" }}
                  >
                    <div className="text-[13px] text-text-primary leading-relaxed">
                      {e.message}
                    </div>
                    <div className="text-[11.5px] text-text-muted shrink-0 whitespace-nowrap tabular-nums">
                      {formatDateTime(e.at).split(",").pop()?.trim()}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
