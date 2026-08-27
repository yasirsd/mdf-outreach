import { describe, expect, it } from "vitest";
import {
  DASHBOARD_RANGES,
  DEFAULT_RANGE,
  isDashboardRange,
  parseDashboardRange,
  rangeBounds,
  rangeDays,
} from "./range";
import { workspaceCalendarKey } from "./timezone";

describe("dashboard range parsing", () => {
  it("only accepts 7d / 30d / 90d", () => {
    for (const r of DASHBOARD_RANGES) expect(isDashboardRange(r)).toBe(true);
    expect(isDashboardRange("1d")).toBe(false);
    expect(isDashboardRange("year")).toBe(false);
    expect(isDashboardRange(undefined)).toBe(false);
  });

  it("parseDashboardRange defaults to 30d when input is unknown", () => {
    expect(parseDashboardRange(undefined)).toBe(DEFAULT_RANGE);
    expect(parseDashboardRange("junk")).toBe(DEFAULT_RANGE);
    expect(parseDashboardRange("7d")).toBe("7d");
  });

  it("rangeDays matches the range", () => {
    expect(rangeDays("7d")).toBe(7);
    expect(rangeDays("30d")).toBe(30);
    expect(rangeDays("90d")).toBe(90);
  });

  it("rangeBounds returns absolute UTC ISO instants for workspace-calendar midnight", () => {
    // 15:00 UTC on Aug 27 = 20:30 IST on Aug 27.
    const NOW = new Date("2026-08-27T15:00:00.000Z");
    const b = rangeBounds("7d", NOW);
    expect(b.days).toBe(7);
    // The from/until instants land on workspace-day boundaries.
    const fromKey = workspaceCalendarKey(b.fromIso);
    const untilKey = workspaceCalendarKey(b.untilIso);
    // From = today (workspace) − 6 days.
    expect(fromKey).toBe("2026-08-21");
    // Until = tomorrow (workspace) = Aug 28.
    expect(untilKey).toBe("2026-08-28");
  });
});
