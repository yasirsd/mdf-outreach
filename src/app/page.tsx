"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Plus, Send } from "lucide-react";
import { activityRepo, buyerRepo, campaignRepo, recipientRepo } from "@/lib/repositories";
import { PageContainer } from "@/components/ui/Page";
import { formatRelative, greeting } from "@/lib/utils";
import { useWorkspace } from "@/components/WorkspaceProvider";

export default function OverviewPage() {
  const { ready, settings } = useWorkspace();
  const buyers = useLiveQuery(() => buyerRepo.list(), [], []);
  const campaigns = useLiveQuery(() => campaignRepo.list(), [], []);
  const activity = useLiveQuery(() => activityRepo.list(10), [], []);
  const activeCampaign = campaigns?.find((c) => c.status === "active") ?? campaigns?.[0];
  const recipients = useLiveQuery(
    () => (activeCampaign ? recipientRepo.listByCampaign(activeCampaign.id) : Promise.resolve([])),
    [activeCampaign?.id],
    [],
  );

  if (!ready || !settings) return null;

  const contacted = buyers.filter((b) =>
    ["contacted", "replied", "interested", "quotation-sent", "negotiating", "converted"].includes(
      b.status,
    ),
  ).length;
  const replied = buyers.filter((b) =>
    ["replied", "interested", "quotation-sent", "negotiating", "converted"].includes(b.status),
  ).length;
  const interested = buyers.filter((b) =>
    ["interested", "quotation-sent", "negotiating", "converted"].includes(b.status),
  ).length;

  const cmpReady = recipients.filter((r) => r.status === "ready" || r.status === "qualified" || r.status === "new").length;
  const cmpContacted = recipients.filter((r) =>
    ["contacted", "replied", "interested", "quotation-sent", "negotiating", "converted"].includes(r.status),
  ).length;
  const cmpReplied = recipients.filter((r) =>
    ["replied", "interested", "quotation-sent", "negotiating", "converted"].includes(r.status),
  ).length;
  const cmpInterested = recipients.filter((r) =>
    ["interested", "quotation-sent", "negotiating", "converted"].includes(r.status),
  ).length;

  return (
    <PageContainer>
      <header className="mb-14">
        <h1 className="font-serif font-medium text-[52px] leading-[1.02] tracking-[-0.025em] text-brand-charcoal">
          {greeting()}.
        </h1>
        <p className="mt-4 text-brand-muted text-[16px] leading-relaxed max-w-xl">
          Your export outreach, in one place.
          {activeCampaign && (
            <>
              {" "}
              <span className="text-brand-charcoal/85">
                {activeCampaign.country} · {activeCampaign.product}
              </span>{" "}
              campaign is ready to continue.
            </>
          )}
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
        <Metric label="Buyers" value={buyers.length} />
        <Metric label="Contacted" value={contacted} />
        <Metric label="Replies" value={replied} />
        <Metric label="Interested" value={interested} accent />
      </div>

      {activeCampaign ? (
        <Link
          href={`/campaigns/${activeCampaign.id}`}
          className="group block rounded-2xl bg-brand-charcoal text-white p-8 md:p-10 border border-brand-charcoal hover:shadow-panel transition-shadow"
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange">
                Active Campaign · Export Campaign
              </div>
              <div className="mt-4 font-serif text-[36px] font-medium leading-[1.05] tracking-[-0.02em]">
                {activeCampaign.country}
                <span className="text-white/40"> · </span>
                {activeCampaign.product}
              </div>
              <div className="mt-2 text-white/60 text-[14px]">{activeCampaign.name}</div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-[13px] text-white/70 group-hover:text-white transition-colors">
              Continue campaign <ArrowRight size={16} />
            </div>
          </div>

          <div className="mt-10 grid grid-cols-2 md:grid-cols-5 gap-6 pt-6 border-t border-white/10">
            <CampaignStat label="Recipients" value={recipients.length} />
            <CampaignStat label="Ready" value={cmpReady} />
            <CampaignStat label="Contacted" value={cmpContacted} />
            <CampaignStat label="Replied" value={cmpReplied} />
            <CampaignStat label="Interested" value={cmpInterested} accent />
          </div>
        </Link>
      ) : (
        <div className="rounded-2xl border border-dashed border-brand-border p-10 text-center bg-white">
          <div className="text-brand-charcoal font-medium">No active campaign</div>
          <p className="mt-1 text-sm text-brand-muted">Create your first campaign to get started.</p>
          <Link href="/campaigns" className="btn-brand mt-5 inline-flex">
            <Plus size={14} /> New campaign
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 mt-14">
        <section>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-[15px] font-semibold text-brand-charcoal tracking-tight">
              Recent Activity
            </h2>
            <Link href="/activity" className="text-[12px] text-brand-muted hover:text-brand-charcoal">
              View all
            </Link>
          </div>
          <div className="card divide-y divide-brand-border">
            {activity.length === 0 && (
              <div className="p-6 text-sm text-brand-muted text-center">
                No activity yet. Actions you take will appear here.
              </div>
            )}
            {activity.map((a) => (
              <div key={a.id} className="p-4 flex items-start justify-between gap-3">
                <div className="text-[13.5px] text-brand-charcoal/90">{a.message}</div>
                <div className="text-[11.5px] text-brand-muted shrink-0">
                  {formatRelative(a.at)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="text-[15px] font-semibold text-brand-charcoal tracking-tight">
              Quick actions
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <QuickAction
              href="/buyers"
              title="Add or import buyers"
              body="Grow your buyer network from a CSV or add one at a time."
            />
            <QuickAction
              href={activeCampaign ? `/campaigns/${activeCampaign.id}/email` : "/campaigns"}
              title="Design the outreach email"
              body="Refine the Guntur Chilli template, then preview as any buyer."
            />
            <QuickAction
              href={activeCampaign ? `/campaigns/${activeCampaign.id}/send` : "/campaigns"}
              title="Prepare a campaign"
              body="Validate personalization and readiness before you send."
              icon={<Send size={16} className="text-brand-orange" />}
            />
          </div>
        </section>
      </div>
    </PageContainer>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="metric-card">
      <div className="text-[11px] tracking-[0.14em] uppercase text-brand-muted">{label}</div>
      <div
        className={`mt-3 font-serif font-medium text-[38px] leading-none tracking-[-0.02em] ${accent ? "text-brand-orange" : "text-brand-charcoal"}`}
      >
        {value}
      </div>
    </div>
  );
}

function CampaignStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-white/50">{label}</div>
      <div
        className={`mt-2 font-serif font-medium text-[26px] leading-none tracking-[-0.02em] ${accent ? "text-brand-orange" : "text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}

function QuickAction({
  href,
  title,
  body,
  icon,
}: {
  href: string;
  title: string;
  body: string;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group card p-5 hover:border-brand-charcoal/25 hover:shadow-card transition-all flex items-start gap-3"
    >
      <div className="mt-0.5">{icon ?? <ArrowRight size={16} className="text-brand-charcoal/40 group-hover:text-brand-charcoal transition-colors" />}</div>
      <div className="flex-1">
        <div className="text-[14px] font-medium text-brand-charcoal">{title}</div>
        <div className="text-[13px] text-brand-muted mt-1 leading-relaxed">{body}</div>
      </div>
    </Link>
  );
}
