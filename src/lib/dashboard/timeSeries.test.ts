import { describe, expect, it } from "vitest";
import { buildSendTimeSeries, trend } from "./timeSeries";
import { workspaceCalendarKey, workspaceTodayKey } from "./timezone";

/**
 * Aggregator contract: input rows have ALREADY been narrowed by the
 * loader's SQL to kind='buyer-send' AND ok=true. These tests assert
 * bucketing behavior, NOT re-filtering.
 *
 * Loader-level exclusion of gmail-test / ok=false / safety-gate refusals
 * is covered by `loadOverviewDashboard.test.ts` (the query-shape test).
 */

const NOW = new Date("2026-08-27T15:00:00.000Z");

function isoAtWorkspaceDay(daysAgo: number): string {
  // Anchor to noon UTC so ±TZ shifts don't roll into an adjacent day
  // for a UTC-testing scenario. We pass `timezone: "UTC"` to the
  // aggregator in these tests so the day math is deterministic.
  const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return d.toISOString();
}

describe("buildSendTimeSeries — bucketing", () => {
  it("range=7d produces 7 buckets, 30d → 30, 90d → 90", () => {
    for (const [range, expected] of [
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
    ] as const) {
      const s = buildSendTimeSeries({
        range,
        now: NOW,
        currentSendEvents: [],
        previousSendEvents: [],
        currentBuyersAdded: [],
        previousBuyersAdded: [],
        timezone: "UTC",
      });
      expect(s.buckets.length).toBe(expected);
      expect(s.days).toBe(expected);
    }
  });

  it("buckets are chronological ending on today (workspace calendar)", () => {
    const s = buildSendTimeSeries({
      range: "7d",
      now: NOW,
      currentSendEvents: [],
      previousSendEvents: [],
      currentBuyersAdded: [],
      previousBuyersAdded: [],
      timezone: "UTC",
    });
    const keys = s.buckets.map((b) => b.dateKey);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(keys.at(-1)).toBe(workspaceTodayKey(NOW, "UTC"));
  });

  it("empty input yields all-zero buckets, not an empty array", () => {
    const s = buildSendTimeSeries({
      range: "30d",
      now: NOW,
      currentSendEvents: [],
      previousSendEvents: [],
      currentBuyersAdded: [],
      previousBuyersAdded: [],
      timezone: "UTC",
    });
    expect(s.buckets.length).toBe(30);
    expect(s.totals.emails).toBe(0);
    for (const b of s.buckets) {
      expect(b.emails).toBe(0);
      expect(b.buyersAdded).toBe(0);
    }
  });

  it("sends bucket into the correct workspace-calendar day", () => {
    const s = buildSendTimeSeries({
      range: "7d",
      now: NOW,
      currentSendEvents: [
        { createdAt: isoAtWorkspaceDay(0) },
        { createdAt: isoAtWorkspaceDay(0) },
        { createdAt: isoAtWorkspaceDay(3) },
      ],
      previousSendEvents: [],
      currentBuyersAdded: [],
      previousBuyersAdded: [],
      timezone: "UTC",
    });
    expect(s.totals.emails).toBe(3);
    expect(s.buckets.at(-1)?.emails).toBe(2);
    expect(s.buckets.at(-4)?.emails).toBe(1);
  });

  it("carries a buyersAdded count per day", () => {
    const s = buildSendTimeSeries({
      range: "7d",
      now: NOW,
      currentSendEvents: [],
      previousSendEvents: [],
      currentBuyersAdded: [
        { createdAt: isoAtWorkspaceDay(0) },
        { createdAt: isoAtWorkspaceDay(0) },
        { createdAt: isoAtWorkspaceDay(3) },
      ],
      previousBuyersAdded: [{ createdAt: isoAtWorkspaceDay(20) }],
      timezone: "UTC",
    });
    expect(s.totals.buyersAdded).toBe(3);
    expect(s.previous.buyersAdded).toBe(1);
    expect(s.buckets.at(-1)?.buyersAdded).toBe(2);
    expect(s.buckets.at(-4)?.buyersAdded).toBe(1);
  });

  it("previous window total is a plain count of the input rows (already SQL-scoped)", () => {
    const s = buildSendTimeSeries({
      range: "7d",
      now: NOW,
      currentSendEvents: [],
      previousSendEvents: [
        { createdAt: isoAtWorkspaceDay(8) },
        { createdAt: isoAtWorkspaceDay(9) },
        { createdAt: isoAtWorkspaceDay(10) },
      ],
      currentBuyersAdded: [],
      previousBuyersAdded: [],
      timezone: "UTC",
    });
    expect(s.previous.emails).toBe(3);
  });
});

describe("workspaceCalendarKey — midnight boundary", () => {
  it("22:00 UTC on 2026-08-27 lands on 2026-08-28 in Asia/Kolkata (+05:30)", () => {
    const iso = "2026-08-27T22:00:00.000Z";
    expect(workspaceCalendarKey(iso, "Asia/Kolkata")).toBe("2026-08-28");
    expect(workspaceCalendarKey(iso, "UTC")).toBe("2026-08-27");
  });

  it("02:00 UTC on 2026-08-27 is still 2026-08-27 in Asia/Kolkata", () => {
    const iso = "2026-08-27T02:00:00.000Z";
    expect(workspaceCalendarKey(iso, "Asia/Kolkata")).toBe("2026-08-27");
  });
});

describe("trend()", () => {
  it("previous zero + current > 0 → firstPeriod", () => {
    const t = trend(4, 0);
    expect(t.firstPeriod).toBe(true);
    expect(t.pct).toBeNull();
  });

  it("both zero → flat, pct null", () => {
    const t = trend(0, 0);
    expect(t.direction).toBe("flat");
    expect(t.pct).toBeNull();
  });

  it("positive delta returns up + positive pct", () => {
    expect(trend(15, 10).direction).toBe("up");
    expect(trend(15, 10).pct).toBe(50);
  });

  it("negative delta returns down + negative pct", () => {
    expect(trend(5, 10).direction).toBe("down");
    expect(trend(5, 10).pct).toBe(-50);
  });
});
