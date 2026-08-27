import Link from "next/link";
import { Users, Megaphone, Mail, CalendarClock, Plus, Upload } from "lucide-react";
import { PageContainer } from "@/components/ui/Page";
import { greeting } from "@/lib/utils";
import { loadOverviewDashboard } from "@/lib/dashboard/loadOverviewDashboard";
import { parseDashboardRange, rangeLabel } from "@/lib/dashboard/range";
import { RangeSelector } from "@/components/dashboard/RangeSelector";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ActivityChart } from "@/components/dashboard/ActivityChart";
import { PipelinePanel } from "@/components/dashboard/PipelinePanel";
import { CampaignProgressPanel } from "@/components/dashboard/CampaignProgressPanel";
import { NeedsAttentionPanel } from "@/components/dashboard/NeedsAttentionPanel";
import { FollowUpsPanel } from "@/components/dashboard/FollowUpsPanel";
import { RecentActivityPanel } from "@/components/dashboard/RecentActivityPanel";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams?: { range?: string };
}) {
  const range = parseDashboardRange(searchParams?.range);
  const dashboard = await loadOverviewDashboard(range);
  const {
    metrics,
    timeSeries,
    pipeline,
    campaignProgress,
    needsAttention,
    followUps,
    recentActivity,
  } = dashboard;

  const emailsSparkline = timeSeries.buckets.map((b) => b.emails);
  const buyersAddedSparkline = timeSeries.buckets.map((b) => b.buyersAdded);
  const emailsDetail = describeEmailsDetail(metrics.emailsSent, timeSeries.previous.emails, range);
  const followUpsDetail = describeFollowUpDetail(metrics.followUpsOverdue, metrics.followUpsToday);
  const campaignsDetail = metrics.totalActiveCampaigns === 0
    ? "No active campaigns"
    : `${metrics.totalActiveCampaigns} currently sending or ready`;
  const buyersDetail =
    timeSeries.totals.buyersAdded === 0
      ? metrics.totalBuyers === 0
        ? "Import buyers to begin"
        : "No new buyers this period"
      : `${timeSeries.totals.buyersAdded} added in ${rangeLabel(range).toLowerCase()}`;

  const hasAnyData =
    metrics.totalBuyers > 0 ||
    dashboard.telemetry.campaignCount > 0 ||
    metrics.emailsSent > 0;

  return (
    <PageContainer size="wide">
      <header className="mb-5">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange mb-2 font-medium">
              Overview
            </div>
            <h1 className="text-[24px] font-semibold tracking-tight text-text-primary">
              {greeting()}.
            </h1>
            <p className="mt-1.5 text-[13.5px] text-text-secondary max-w-2xl">
              Here&apos;s what&apos;s happening with MDF Outreach.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RangeSelector current={range} />
            <Link href="/campaigns" className="btn-primary">
              <Plus size={14} /> New campaign
            </Link>
          </div>
        </div>
      </header>

      {/* Top metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricCard
          label="Total buyers"
          value={metrics.totalBuyers}
          detail={buyersDetail}
          icon={<Users size={14} />}
          sparkline={buyersAddedSparkline}
          href="/buyers"
        />
        <MetricCard
          label="Active campaigns"
          value={metrics.totalActiveCampaigns}
          detail={campaignsDetail}
          icon={<Megaphone size={14} />}
          href="/campaigns"
        />
        <MetricCard
          label="Emails sent"
          value={metrics.emailsSent}
          detail={emailsDetail}
          icon={<Mail size={14} />}
          sparkline={emailsSparkline}
          trend={metrics.emailsSentTrend}
          tone="primary"
        />
        <MetricCard
          label="Follow-ups"
          value={metrics.followUpsOverdue + metrics.followUpsToday}
          detail={followUpsDetail}
          icon={<CalendarClock size={14} />}
          href="/buyers"
        />
      </div>

      {!hasAnyData && (
        <EmptyDashboard />
      )}

      {/* Row: Outreach activity + Needs attention */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] gap-4 mb-4 items-start">
        <section
          aria-labelledby="activity-chart-heading"
          className="rounded-[12px] p-5"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <h2
                id="activity-chart-heading"
                className="text-[13px] font-semibold tracking-tight text-text-primary"
              >
                Outreach activity
              </h2>
              <p className="mt-0.5 text-[11.5px] text-text-muted">
                Successful buyer emails · {rangeLabel(range).toLowerCase()}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[19px] font-semibold text-text-primary tabular-nums leading-none">
                {metrics.emailsSent.toLocaleString()}
              </div>
              <div className="text-[10.5px] text-text-muted mt-1">total</div>
            </div>
          </div>
          {metrics.emailsSent === 0 ? (
            <div
              className="h-[170px] flex items-center justify-center text-center px-6"
              style={{ color: "var(--text-muted)" }}
            >
              <div>
                <div className="text-[13px] font-medium text-text-secondary">
                  No outreach yet
                </div>
                <div className="mt-1 text-[11.5px]">
                  Successful buyer emails will appear here once campaigns begin.
                </div>
              </div>
            </div>
          ) : (
            <ActivityChart buckets={timeSeries.buckets} label="Successful buyer emails" />
          )}
        </section>

        <NeedsAttentionPanel items={needsAttention} />
      </div>

      {/* Row: Pipeline + Campaign progress */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 mb-4 items-start">
        <PipelinePanel pipeline={pipeline} />
        <CampaignProgressPanel rows={campaignProgress} />
      </div>

      {/* Row: Follow-ups + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <FollowUpsPanel rows={followUps} />
        <RecentActivityPanel rows={recentActivity} />
      </div>
    </PageContainer>
  );
}

function describeEmailsDetail(current: number, previous: number, range: string): string {
  if (current === 0 && previous === 0) return `Nothing sent yet`;
  if (previous === 0) return `${current} this period`;
  const label = range === "7d" ? "vs prev 7 days" : range === "90d" ? "vs prev 90 days" : "vs prev 30 days";
  return `${current} ${label}`;
}

function describeFollowUpDetail(overdue: number, today: number): string {
  if (overdue === 0 && today === 0) return "Nothing scheduled today";
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (today > 0) parts.push(`${today} today`);
  return parts.join(" · ");
}

function EmptyDashboard() {
  return (
    <div
      className="rounded-[16px] p-8 md:p-10 mb-6"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px dashed var(--app-border-strong)",
      }}
    >
      <div className="max-w-2xl">
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange mb-2 font-medium">
          Get started
        </div>
        <h2 className="text-[20px] font-semibold text-text-primary tracking-tight">
          Set up your first outreach
        </h2>
        <p className="mt-1.5 text-[13px] text-text-secondary leading-relaxed">
          Import buyers or add them one at a time, then create a campaign to
          group a market, product, and email into one focused effort.
        </p>
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <Link href="/buyers" className="btn-primary">
            <Upload size={14} /> Import buyers
          </Link>
          <Link href="/campaigns" className="btn-secondary">
            <Plus size={14} /> New campaign
          </Link>
        </div>
      </div>
    </div>
  );
}
