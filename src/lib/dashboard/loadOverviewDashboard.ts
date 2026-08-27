import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { serverRepositories } from "@/lib/repositories/server";
import { getCachedGmailConnection } from "@/lib/gmail/gmailConnectionCache";
import type { Buyer, Campaign, CampaignRecipient } from "@/lib/types";
import {
  DEFAULT_RANGE,
  rangeBounds,
  rangeDays,
  type DashboardRange,
} from "./range";
import {
  workspaceCalendarKey,
  workspaceTodayKey,
  workspaceRangeBounds,
} from "./timezone";
import {
  buildSendTimeSeries,
  trend,
  type SendTimeSeries,
  type TrendInfo,
} from "./timeSeries";
import { computePipeline, type BuyerPipeline } from "./pipeline";
import { computeNeedsAttention, type AttentionItem } from "./needsAttention";
import {
  computeCampaignProgress,
  type CampaignProgressRow,
} from "./campaignProgress";
import {
  curateOverviewActivity,
  type OverviewActivityRow,
} from "./activityCuration";
import { followUpDateKey } from "@/lib/dates/followUp";

/**
 * MDF Outreach — F6 dashboard loader.
 *
 * Delivers one coherent snapshot of the workspace. Queries are workspace-
 * scoped (RLS) and either bounded by a date range, filtered to a set of
 * active campaign ids, or capped by row limit. This module never writes.
 *
 * ─── QUERY PLAN ──────────────────────────────────────────────────────
 *
 *  PARALLEL BATCH 1 (kicked off simultaneously)
 *    A. repos.buyers.list()
 *    B. repos.campaigns.list()
 *    C. repos.activity.list(60)
 *    D. current-range successful buyer-send events (bounded by workspace
 *       calendar window; three columns; kind='buyer-send' AND ok=true
 *       filtered at SQL layer — authoritative)
 *    E. previous-range successful buyer-send events (same shape)
 *    F. getCachedGmailConnection()
 *
 *  AFTER (A,B): union set of campaign_ids we need recipient + lifetime-
 *               delivery data for =
 *                 (all active campaigns, unbounded)   for needs-attention
 *               ∪ (up to N most-recent campaigns)     for progress display
 *
 *    G. Single aggregate query for campaign_recipients:
 *         SELECT id, campaign_id, buyer_id
 *         FROM campaign_recipients
 *         WHERE campaign_id IN (unionIds)
 *
 *    H. Single aggregate query for ALL-TIME successful buyer-sends
 *       against those same union campaign ids:
 *         SELECT campaign_id, buyer_id, created_at
 *         FROM email_send_events
 *         WHERE workspace_id = $ws
 *           AND kind = 'buyer-send' AND ok = true
 *           AND campaign_id IN (unionIds)
 *
 *  This deliberately trades a small unbounded-fanout risk (active
 *  campaign count) for CORRECTNESS: needs-attention always evaluates
 *  every active campaign, and campaign progress uses lifetime delivery
 *  counts instead of range-window counts (a campaign that finished 60
 *  days ago must still read as delivered at range=7d).
 */

const ACTIVITY_ROWS = 60;
const PROGRESS_DISPLAY_LIMIT = 5;

export interface OverviewMetrics {
  totalBuyers: number;
  totalActiveCampaigns: number;
  emailsSent: number;
  emailsSentTrend: TrendInfo;
  followUpsOverdue: number;
  followUpsToday: number;
}

export interface OverviewFollowUpRow {
  buyer: Buyer;
  followUpKey: string;
  overdue: boolean;
  today: boolean;
}

export interface OverviewDashboard {
  range: DashboardRange;
  metrics: OverviewMetrics;
  timeSeries: SendTimeSeries;
  pipeline: BuyerPipeline;
  campaignProgress: CampaignProgressRow[];
  needsAttention: AttentionItem[];
  followUps: OverviewFollowUpRow[];
  recentActivity: OverviewActivityRow[];
  gmailConnected: boolean;
  telemetry: {
    buyerCount: number;
    campaignCount: number;
    activityRowsFetched: number;
    sendEventRowsCurrentRange: number;
    sendEventRowsPreviousRange: number;
    activeCampaignCount: number;
    /**
     * Campaign ids we queried recipient + lifetime-delivery data for
     * (union of ALL active + up to N recent for progress display).
     */
    campaignsQueriedForRollups: number;
    /** Rows returned by the aggregate lifetime-delivery query. */
    lifetimeDeliveryRowsFetched: number;
  };
}

/** Loader-internal query row shapes. */
type SuccessfulSendEventRow = {
  created_at: string;
  buyer_id: string | null;
  campaign_id: string | null;
};

export async function loadOverviewDashboard(
  range: DashboardRange = DEFAULT_RANGE,
  now: Date = new Date(),
): Promise<OverviewDashboard> {
  const { session, repos } = await serverRepositories();
  const supabase = createClient(cookies());
  const workspaceId = session.membership.workspaceId;

  const current = rangeBounds(range, now);
  const previous = workspaceRangeBounds(rangeDays(range), previousWindowAnchor(now, range));

  // -------------------------------------------------------------------
  // PARALLEL BATCH 1
  // -------------------------------------------------------------------
  const [
    buyers,
    campaigns,
    activityRows,
    currentSendRows,
    previousSendRows,
    gmailConnection,
  ] = await Promise.all([
    repos.buyers.list(),
    repos.campaigns.list(),
    repos.activity.list(ACTIVITY_ROWS),
    fetchSuccessfulSendEvents(supabase, workspaceId, current.fromIso, current.untilIso),
    fetchSuccessfulSendEvents(supabase, workspaceId, previous.fromIso, previous.untilIso),
    getCachedGmailConnection(),
  ]);

  const gmailConnected = !!gmailConnection;

  // -------------------------------------------------------------------
  // Union set of campaigns we need recipient + lifetime-delivery data for
  // -------------------------------------------------------------------
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const activeIds = new Set(activeCampaigns.map((c) => c.id));

  // For progress display we may need to top up with non-active campaigns
  // when there are fewer than the display limit active. Repository default
  // ordering is updated_at desc, so we take the first N non-active as
  // candidates.
  const progressFill = campaigns
    .filter((c) => c.status !== "active")
    .slice(0, PROGRESS_DISPLAY_LIMIT);

  const rollupIds = new Set<string>([...activeIds]);
  for (const c of progressFill) rollupIds.add(c.id);

  // -------------------------------------------------------------------
  // PARALLEL BATCH 2 — recipient + lifetime delivery aggregates
  // -------------------------------------------------------------------
  const rollupIdList = Array.from(rollupIds);
  const [recipientsAggregate, lifetimeDeliveryRows] = await Promise.all([
    fetchRecipientsForCampaigns(supabase, workspaceId, rollupIdList),
    fetchLifetimeSuccessfulSends(supabase, workspaceId, rollupIdList),
  ]);

  // Group recipients per campaign.
  const recipientsByCampaign = new Map<string, CampaignRecipient[]>();
  for (const r of recipientsAggregate) {
    let arr = recipientsByCampaign.get(r.campaignId);
    if (!arr) {
      arr = [];
      recipientsByCampaign.set(r.campaignId, arr);
    }
    arr.push(r);
  }

  // Group lifetime successful sends per campaign, plus track last delivery.
  const successfulByCampaign = new Map<string, Set<string>>();
  const lastDeliveryByCampaign = new Map<string, string | null>();
  for (const row of lifetimeDeliveryRows) {
    if (!row.campaign_id || !row.buyer_id) continue;
    let set = successfulByCampaign.get(row.campaign_id);
    if (!set) {
      set = new Set<string>();
      successfulByCampaign.set(row.campaign_id, set);
    }
    set.add(row.buyer_id);
    const prev = lastDeliveryByCampaign.get(row.campaign_id);
    if (!prev || row.created_at > prev) lastDeliveryByCampaign.set(row.campaign_id, row.created_at);
  }

  // -------------------------------------------------------------------
  // AGGREGATIONS
  // -------------------------------------------------------------------
  const suppressedBuyerIds = new Set<string>();
  for (const b of buyers) if (b.suppressed) suppressedBuyerIds.add(b.id);

  const currentBuyersAdded = buyers.filter(
    (b) => b.createdAt >= current.fromIso && b.createdAt < current.untilIso,
  );
  const previousBuyersAdded = buyers.filter(
    (b) => b.createdAt >= previous.fromIso && b.createdAt < previous.untilIso,
  );

  const timeSeries = buildSendTimeSeries({
    range,
    now,
    // SuccessfulSendRow is authoritatively filtered at the SQL layer
    // — no fake defence-in-depth in the aggregator.
    currentSendEvents: currentSendRows.map((r) => ({ createdAt: r.created_at })),
    previousSendEvents: previousSendRows.map((r) => ({ createdAt: r.created_at })),
    currentBuyersAdded: currentBuyersAdded.map((b) => ({ createdAt: b.createdAt })),
    previousBuyersAdded: previousBuyersAdded.map((b) => ({ createdAt: b.createdAt })),
  });

  const pipeline = computePipeline(buyers);

  const campaignProgress = computeCampaignProgress({
    campaigns,
    recipientsByCampaign,
    successfulBuyerIdsByCampaign: successfulByCampaign,
    lastDeliveryByCampaign,
    suppressedBuyerIds,
    limit: PROGRESS_DISPLAY_LIMIT,
  });

  // Needs-attention evaluates the FULL active-campaign set — not the
  // display-capped progress subset.
  const activeRecipients = new Map<string, CampaignRecipient[]>();
  for (const id of activeIds) {
    activeRecipients.set(id, recipientsByCampaign.get(id) ?? []);
  }

  const needsAttention = computeNeedsAttention({
    buyers,
    campaigns,
    activeRecipientsByCampaign: activeRecipients,
    suppressedBuyerIds,
    gmailConnected,
    now,
  });

  const todayKey = workspaceTodayKey(now);
  const followUps = buildFollowUpRows(buyers, todayKey);

  const emailsSentTrend = trend(timeSeries.totals.emails, timeSeries.previous.emails);

  const overdueCount = buyers.filter((b) => {
    const k = followUpDateKey(b.nextFollowUpAt);
    return !!k && k < todayKey;
  }).length;
  const todayCount = buyers.filter(
    (b) => followUpDateKey(b.nextFollowUpAt) === todayKey,
  ).length;

  const metrics: OverviewMetrics = {
    totalBuyers: buyers.length,
    totalActiveCampaigns: activeCampaigns.length,
    emailsSent: timeSeries.totals.emails,
    emailsSentTrend,
    followUpsOverdue: overdueCount,
    followUpsToday: todayCount,
  };

  const recentActivity = curateOverviewActivity(activityRows, 8);

  return {
    range,
    metrics,
    timeSeries,
    pipeline,
    campaignProgress,
    needsAttention,
    followUps,
    recentActivity,
    gmailConnected,
    telemetry: {
      buyerCount: buyers.length,
      campaignCount: campaigns.length,
      activityRowsFetched: activityRows.length,
      sendEventRowsCurrentRange: currentSendRows.length,
      sendEventRowsPreviousRange: previousSendRows.length,
      activeCampaignCount: activeCampaigns.length,
      campaignsQueriedForRollups: rollupIdList.length,
      lifetimeDeliveryRowsFetched: lifetimeDeliveryRows.length,
    },
  };
}

// ─── Private helpers ──────────────────────────────────────────────────

async function fetchSuccessfulSendEvents(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  fromIso: string,
  untilIso: string,
): Promise<SuccessfulSendEventRow[]> {
  const { data, error } = await supabase
    .from("email_send_events")
    .select("created_at, buyer_id, campaign_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "buyer-send")
    .eq("ok", true)
    .gte("created_at", fromIso)
    .lt("created_at", untilIso)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SuccessfulSendEventRow[];
}

async function fetchLifetimeSuccessfulSends(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  campaignIds: string[],
): Promise<SuccessfulSendEventRow[]> {
  if (campaignIds.length === 0) return [];
  const { data, error } = await supabase
    .from("email_send_events")
    .select("created_at, buyer_id, campaign_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "buyer-send")
    .eq("ok", true)
    .in("campaign_id", campaignIds);
  if (error) throw error;
  return (data ?? []) as SuccessfulSendEventRow[];
}

interface RecipientRow {
  id: string;
  campaignId: string;
  buyerId: string;
}

async function fetchRecipientsForCampaigns(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  campaignIds: string[],
): Promise<(CampaignRecipient & RecipientRow)[]> {
  if (campaignIds.length === 0) return [];
  const { data, error } = await supabase
    .from("campaign_recipients")
    .select("id, campaign_id, buyer_id, status, created_at")
    .eq("workspace_id", workspaceId)
    .in("campaign_id", campaignIds);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    campaignId: row.campaign_id as string,
    buyerId: row.buyer_id as string,
    status: row.status as CampaignRecipient["status"],
    createdAt: row.created_at as string,
  }));
}

function buildFollowUpRows(buyers: Buyer[], todayKey: string): OverviewFollowUpRow[] {
  const rows: OverviewFollowUpRow[] = [];
  for (const b of buyers) {
    const key = followUpDateKey(b.nextFollowUpAt);
    if (!key) continue;
    rows.push({
      buyer: b,
      followUpKey: key,
      overdue: key < todayKey,
      today: key === todayKey,
    });
  }
  rows.sort((a, b) => a.followUpKey.localeCompare(b.followUpKey));
  return rows.slice(0, 5);
}

/**
 * Compute an "instant" that lands N days before `now` — used to derive
 * the previous-window range bounds without duplicating range arithmetic.
 * We use noon of the shift to avoid DST-day boundary funkiness for TZs
 * that observe it (Asia/Kolkata does not, but this is defensive).
 */
function previousWindowAnchor(now: Date, range: DashboardRange): Date {
  const days = rangeDays(range);
  return new Date(now.getTime() - days * 86_400_000);
}

// Also compute a workspace date key for callers who need it.
export { workspaceCalendarKey };
