import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { serverRepositories } from "@/lib/repositories/server";
import { getCachedCampaign } from "@/lib/repositories/campaignCache";
import { createClient } from "@/utils/supabase/server";
import { fetchSendHistoryForCampaign } from "@/lib/gmail/buyerSendAudit";
import { formatRelative } from "@/lib/utils";
import { SendHistoryTable } from "./SendHistoryTable";
import type { Buyer } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CampaignActivityPage({
  params,
}: {
  params: { id: string };
}) {
  const { session, repos } = await serverRepositories();
  const campaign = await getCachedCampaign(params.id);
  if (!campaign) notFound();

  const supabase = createClient(cookies());

  const [history, buyers, activity] = await Promise.all([
    fetchSendHistoryForCampaign({
      supabase,
      workspaceId: session.membership.workspaceId,
      campaignId: params.id,
    }),
    repos.buyers.list(),
    repos.activity.list(300),
  ]);

  // Compact buyer lookup for the history table.
  const buyersById: Record<
    string,
    Pick<Buyer, "company" | "firstName" | "lastName" | "email">
  > = {};
  for (const b of buyers) {
    buyersById[b.id] = {
      company: b.company,
      firstName: b.firstName,
      lastName: b.lastName,
      email: b.email,
    };
  }
  const buyerIdSet = new Set(buyers.map((b) => b.id));

  // Filter activity to events that reference this campaign OR any buyer
  // belonging to this campaign's recipient list. This keeps the page
  // relevant instead of showing global workspace activity.
  const campaignActivity = activity.filter((a) => {
    if (!a.entity) return false;
    if (a.entity.type === "campaign" && a.entity.id === params.id) return true;
    if (a.entity.type === "buyer" && buyerIdSet.has(a.entity.id)) {
      // Only surface buyer events that came from this campaign's send
      // events (approximation via message prefix — audit rows themselves
      // live in email_send_events, rendered above).
      return /Campaign:\s*/.test(a.message);
    }
    return false;
  });

  return (
    <div>
      <SendHistoryTable rows={history} buyersById={buyersById} />

      <div>
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-3">
          Campaign activity
        </div>
        <div
          className="rounded-[10px] divide-y"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            borderColor: "var(--app-border)",
          }}
        >
          {campaignActivity.length === 0 && (
            <div className="p-4 text-[13px] text-text-muted text-center">
              No activity events for this campaign yet.
            </div>
          )}
          {campaignActivity.map((a) => (
            <div
              key={a.id}
              className="p-3.5 flex items-start justify-between gap-3"
              style={{ borderColor: "var(--app-border)" }}
            >
              <div className="text-[13px] text-text-primary leading-relaxed">{a.message}</div>
              <div className="text-[11.5px] text-text-muted shrink-0 whitespace-nowrap">
                {formatRelative(a.at)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
