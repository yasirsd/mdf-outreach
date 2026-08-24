import { serverRepositories } from "@/lib/repositories/server";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CampaignActivityPage() {
  const { repos } = await serverRepositories();
  const activity = await repos.activity.list(200);

  return (
    <div className="card divide-y divide-brand-border">
      {activity.length === 0 && (
        <div className="p-6 text-sm text-brand-muted text-center">No activity yet.</div>
      )}
      {activity.map((a) => (
        <div key={a.id} className="p-4 flex items-start justify-between gap-3">
          <div className="text-[13.5px] text-brand-charcoal/90">{a.message}</div>
          <div className="text-[11.5px] text-brand-muted shrink-0">{formatRelative(a.at)}</div>
        </div>
      ))}
    </div>
  );
}
