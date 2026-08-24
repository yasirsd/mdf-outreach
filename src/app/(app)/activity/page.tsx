import { serverRepositories } from "@/lib/repositories/server";
import { PageContainer, PageHeader } from "@/components/ui/Page";
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
        <div className="card p-14 text-center">
          <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange mb-3">Empty</div>
          <div className="font-serif text-[24px] text-brand-charcoal">Nothing here yet.</div>
          <div className="mt-2 text-brand-muted text-[13.5px]">Your actions will appear here.</div>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([day, events]) => (
            <section key={day}>
              <div className="text-[11px] tracking-[0.14em] uppercase text-brand-muted mb-3">
                {day}
              </div>
              <div className="card divide-y divide-brand-border">
                {events.map((e) => (
                  <div key={e.id} className="p-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13.5px] text-brand-charcoal/90">{e.message}</div>
                    </div>
                    <div className="text-[12px] text-brand-muted shrink-0">
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
