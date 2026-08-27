import {
  workspaceCalendarKey,
  workspaceDateKeysForRange,
  WORKSPACE_TIMEZONE,
} from "./timezone";
import { rangeDays, type DashboardRange } from "./range";

/**
 * MDF Outreach — F6 successful-send / buyers-added time series.
 *
 * CONTRACT
 *   This aggregator is AUTHORITATIVELY AT THE QUERY LAYER.
 *   The loader queries `email_send_events` WHERE
 *     kind = 'buyer-send' AND ok = true
 *   and the caller must only ever pass rows that ALREADY satisfy that
 *   invariant. The aggregator itself does not receive kind/ok fields
 *   because it would be meaningless to re-check them — SuccessfulSendRow
 *   documents that in the type system.
 *
 *   Rejection of gmail-test / ok=false / safety-gate refusals happens
 *   at the SQL layer (see loadOverviewDashboard.fetchSuccessfulSendEvents)
 *   and is asserted by tests that inspect the actual query.
 *
 *   Bucketing runs in the WORKSPACE calendar (see ./timezone.ts).
 *   A send at 21:00 UTC that lands on the next calendar day in the
 *   workspace timezone appears in the next bucket, not the current one.
 */

export interface SuccessfulSendRow {
  createdAt: string;
}

export interface BuyerCreatedAtInput {
  createdAt: string;
}

export interface DayBucket {
  /** YYYY-MM-DD in the workspace calendar. */
  dateKey: string;
  emails: number;
  buyersAdded: number;
}

export interface SendTimeSeries {
  range: DashboardRange;
  days: number;
  buckets: DayBucket[];
  totals: { emails: number; buyersAdded: number };
  /** Same aggregation for the immediately-previous window of the same length. */
  previous: { emails: number; buyersAdded: number };
  timezone: string;
}

/**
 * Pure aggregator. Every input row is assumed to already satisfy the
 * "successful buyer send" query invariant (see SuccessfulSendRow).
 */
export function buildSendTimeSeries(input: {
  range: DashboardRange;
  now?: Date;
  /** Rows within the CURRENT range window. */
  currentSendEvents: SuccessfulSendRow[];
  /** Rows within the PREVIOUS range window (of equal length). */
  previousSendEvents: SuccessfulSendRow[];
  /** Buyers created within the CURRENT window. */
  currentBuyersAdded: BuyerCreatedAtInput[];
  /** Buyers created within the PREVIOUS window. */
  previousBuyersAdded: BuyerCreatedAtInput[];
  /** Optional TZ override (tests). Defaults to WORKSPACE_TIMEZONE. */
  timezone?: string;
}): SendTimeSeries {
  const now = input.now ?? new Date();
  const tz = input.timezone ?? WORKSPACE_TIMEZONE;
  const days = rangeDays(input.range);
  const keys = workspaceDateKeysForRange(days, now, tz);
  const bucketByKey = new Map<string, DayBucket>();
  for (const k of keys) bucketByKey.set(k, { dateKey: k, emails: 0, buyersAdded: 0 });

  let currentEmails = 0;
  for (const ev of input.currentSendEvents) {
    const k = workspaceCalendarKey(ev.createdAt, tz);
    if (!k) continue;
    const b = bucketByKey.get(k);
    if (!b) continue;
    b.emails += 1;
    currentEmails += 1;
  }

  let currentBuyersAdded = 0;
  for (const b of input.currentBuyersAdded) {
    const k = workspaceCalendarKey(b.createdAt, tz);
    if (!k) continue;
    const bkt = bucketByKey.get(k);
    if (!bkt) continue;
    bkt.buyersAdded += 1;
    currentBuyersAdded += 1;
  }

  const previousEmails = input.previousSendEvents.length;
  const previousBuyersAdded = input.previousBuyersAdded.length;

  return {
    range: input.range,
    days,
    buckets: keys.map((k) => bucketByKey.get(k)!),
    totals: { emails: currentEmails, buyersAdded: currentBuyersAdded },
    previous: { emails: previousEmails, buyersAdded: previousBuyersAdded },
    timezone: tz,
  };
}

/**
 * Human-safe percent trend. See prior version for semantics.
 */
export interface TrendInfo {
  pct: number | null;
  direction: "up" | "down" | "flat";
  firstPeriod?: boolean;
}

export function trend(current: number, previous: number): TrendInfo {
  if (previous === 0 && current === 0) return { pct: null, direction: "flat" };
  if (previous === 0) return { pct: null, direction: "up", firstPeriod: true };
  const delta = current - previous;
  const pct = Math.round((delta / previous) * 100);
  if (delta === 0) return { pct: 0, direction: "flat" };
  return { pct, direction: delta > 0 ? "up" : "down" };
}
