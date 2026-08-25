import Link from "next/link";
import { ArrowUpRight, Plus, Upload } from "lucide-react";
import { serverRepositories } from "@/lib/repositories/server";
import { PageContainer } from "@/components/ui/Page";
import { formatRelative, greeting } from "@/lib/utils";
import type { Buyer, Campaign, CampaignRecipient } from "@/lib/types";

export const dynamic = "force-dynamic";

const CONTACTED_SET = ["contacted", "replied", "interested", "quotation-sent", "negotiating", "converted"];
const REPLIED_SET = ["replied", "interested", "quotation-sent", "negotiating", "converted"];
const INTERESTED_SET = ["interested", "quotation-sent", "negotiating", "converted"];

export default async function OverviewPage() {
  const { repos } = await serverRepositories();
  const [buyers, campaigns, activity] = await Promise.all([
    repos.buyers.list(),
    repos.campaigns.list(),
    repos.activity.list(8),
  ]);

  const activeCampaign = campaigns.find((c) => c.status === "active") ?? campaigns[0];
  const recipients = activeCampaign
    ? await repos.recipients.listByCampaign(activeCampaign.id)
    : [];

  const contacted = buyers.filter((b) => CONTACTED_SET.includes(b.status)).length;
  const replied = buyers.filter((b) => REPLIED_SET.includes(b.status)).length;
  const interested = buyers.filter((b) => INTERESTED_SET.includes(b.status)).length;

  const followUps = buyers
    .filter((b) => !!b.nextFollowUpAt)
    .sort((a, b) => (a.nextFollowUpAt ?? "").localeCompare(b.nextFollowUpAt ?? ""))
    .slice(0, 5);

  return (
    <PageContainer>
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-text-primary">
          {greeting()}.
        </h1>
        <p className="mt-1.5 text-[13.5px] text-text-secondary">
          Your export outreach, in one place.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Metric label="Buyers" value={buyers.length} />
        <Metric label="Contacted" value={contacted} />
        <Metric label="Replies" value={replied} />
        <Metric label="Interested" value={interested} accent />
      </div>

      {activeCampaign ? (
        <ActiveCampaignPanel campaign={activeCampaign} recipients={recipients} />
      ) : (
        <EmptyCampaignPanel hasBuyers={buyers.length > 0} />
      )}

      <div className="grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 mt-8">
        <section>
          <SectionHeader
            title="Follow-ups"
            hint={
              followUps.length === 0
                ? "No scheduled follow-ups"
                : `${followUps.length} scheduled`
            }
            href="/buyers"
            linkLabel="Open buyers"
          />
          <div
            className="rounded-[12px] overflow-hidden"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border)",
            }}
          >
            {followUps.length === 0 ? (
              <div className="px-5 py-6 text-[13px] text-text-muted">
                No follow-ups scheduled. Assign a next follow-up date on a buyer to see it here.
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
                {followUps.map((b) => (
                  <FollowUpRow key={b.id} buyer={b} />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <SectionHeader
            title="Recent activity"
            hint={activity.length === 0 ? "Nothing yet" : "Latest events"}
            href="/activity"
            linkLabel="View all"
          />
          <div
            className="rounded-[12px] overflow-hidden"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border)",
            }}
          >
            {activity.length === 0 ? (
              <div className="px-5 py-6 text-[13px] text-text-muted">
                Actions you take will appear here.
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--app-border)" }}>
                {activity.map((a) => (
                  <li key={a.id} className="px-5 py-3 flex items-start justify-between gap-4">
                    <div className="text-[13px] text-text-primary/90 leading-snug">{a.message}</div>
                    <div className="text-[11px] text-text-muted shrink-0 mt-0.5 tabular-nums">
                      {formatRelative(a.at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </PageContainer>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="metric-card">
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
        {label}
      </div>
      <div
        className="mt-2.5 text-[28px] font-semibold leading-none tabular-nums tracking-tight"
        style={{ color: accent ? "var(--brand-orange)" : "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

function ActiveCampaignPanel({
  campaign,
  recipients,
}: {
  campaign: Campaign;
  recipients: CampaignRecipient[];
}) {
  const cmpReady = recipients.filter(
    (r) => r.status === "ready" || r.status === "qualified" || r.status === "new",
  ).length;
  const cmpContacted = recipients.filter((r) => CONTACTED_SET.includes(r.status)).length;
  const cmpReplied = recipients.filter((r) => REPLIED_SET.includes(r.status)).length;
  const cmpInterested = recipients.filter((r) => INTERESTED_SET.includes(r.status)).length;

  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="group block rounded-[16px] p-7 md:p-8 transition-all duration-220 focus-ring-quiet"
      style={{
        backgroundColor: "var(--app-elevated)",
        border: "1px solid var(--app-border-strong)",
      }}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
            Active campaign
          </div>
          <div className="mt-3 text-[22px] font-semibold text-text-primary tracking-tight">
            {campaign.name}
          </div>
          <div className="mt-1 text-[13px] text-text-secondary">
            {campaign.country} · {campaign.product}
          </div>
        </div>
        <div
          className="hidden md:inline-flex items-center gap-1.5 text-[12.5px] text-text-muted group-hover:text-text-primary transition-colors"
        >
          Continue
          <ArrowUpRight size={14} />
        </div>
      </div>

      <div
        className="mt-7 grid grid-cols-2 md:grid-cols-5 gap-6 pt-6"
        style={{ borderTop: "1px solid var(--app-border)" }}
      >
        <MiniStat label="Recipients" value={recipients.length} />
        <MiniStat label="Ready" value={cmpReady} />
        <MiniStat label="Contacted" value={cmpContacted} />
        <MiniStat label="Replied" value={cmpReplied} />
        <MiniStat label="Interested" value={cmpInterested} accent />
      </div>
    </Link>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
        {label}
      </div>
      <div
        className="mt-2 text-[20px] font-semibold tabular-nums tracking-tight"
        style={{ color: accent ? "var(--brand-orange)" : "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyCampaignPanel({ hasBuyers }: { hasBuyers: boolean }) {
  return (
    <div
      className="rounded-[16px] p-10 md:p-12 text-center"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px dashed var(--app-border-strong)",
      }}
    >
      <div className="mx-auto max-w-md">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange mb-3 font-medium">
          Get started
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">
          No active campaign
        </h2>
        <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed">
          Create your first campaign to begin buyer outreach. A campaign groups a market,
          product, buyers, and email into one focused effort.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <Link href="/campaigns" className="btn-primary">
            <Plus size={14} /> New campaign
          </Link>
          {!hasBuyers && (
            <Link href="/buyers" className="btn-secondary">
              <Upload size={14} /> Import buyers
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  hint,
  href,
  linkLabel,
}: {
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold text-text-primary tracking-tight">{title}</h2>
        {hint && <span className="text-[11.5px] text-text-muted">{hint}</span>}
      </div>
      {href && linkLabel && (
        <Link
          href={href}
          className="text-[11.5px] text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1"
        >
          {linkLabel} <ArrowUpRight size={11} />
        </Link>
      )}
    </div>
  );
}

function FollowUpRow({ buyer }: { buyer: Buyer }) {
  const due = buyer.nextFollowUpAt ? new Date(buyer.nextFollowUpAt) : null;
  const overdue = due && due.getTime() < Date.now();
  return (
    <li className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-text-primary font-medium truncate">
          {buyer.company || `${buyer.firstName} ${buyer.lastName}`.trim() || buyer.email}
        </div>
        <div className="text-[11.5px] text-text-muted truncate">
          {buyer.country || "—"}
          {buyer.productInterest ? ` · ${buyer.productInterest}` : ""}
        </div>
      </div>
      <div
        className="text-[11.5px] shrink-0 tabular-nums"
        style={{ color: overdue ? "#F08B7E" : "var(--text-muted)" }}
      >
        {due ? formatRelative(due.toISOString()) : "—"}
      </div>
    </li>
  );
}
