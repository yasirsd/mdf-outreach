import { describe, expect, it, vi } from "vitest";
import {
  resolveWorkspaceTimezone,
  workspaceCalendarKey,
  workspaceDateKeysForRange,
  workspaceRangeBounds,
  workspaceTodayKey,
  WORKSPACE_TIMEZONE,
} from "./timezone";

/**
 * Midnight-boundary correctness tests for the F6 workspace timezone
 * contract. Default MDF workspace TZ is Asia/Kolkata (+05:30, no DST).
 *
 * The regression these guard against:
 *   Vercel server runs in UTC. `new Date().getDate()` returned the UTC
 *   calendar day, which meant at 01:00 IST Aug 27 (19:30 UTC Aug 26)
 *   the dashboard mistakenly treated Aug 26 as "today" for an operator
 *   in India.
 */

describe("WORKSPACE_TIMEZONE contract", () => {
  it("defaults to Asia/Kolkata unless the env var overrides it", () => {
    // The env is not set in tests so it stays at the default.
    expect(WORKSPACE_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("resolveWorkspaceTimezone — validation", () => {
  it("returns Asia/Kolkata when the env value is missing / empty", () => {
    expect(resolveWorkspaceTimezone(undefined)).toBe("Asia/Kolkata");
    expect(resolveWorkspaceTimezone(null)).toBe("Asia/Kolkata");
    expect(resolveWorkspaceTimezone("")).toBe("Asia/Kolkata");
    expect(resolveWorkspaceTimezone("   ")).toBe("Asia/Kolkata");
  });

  it("returns the configured value when it is a valid IANA timezone", () => {
    expect(resolveWorkspaceTimezone("Asia/Dubai")).toBe("Asia/Dubai");
    expect(resolveWorkspaceTimezone("Europe/London")).toBe("Europe/London");
    expect(resolveWorkspaceTimezone("America/New_York")).toBe("America/New_York");
    expect(resolveWorkspaceTimezone("UTC")).toBe("UTC");
  });

  it("falls back to Asia/Kolkata on an INVALID IANA timezone and emits a warning", () => {
    const warn = vi.fn();
    expect(resolveWorkspaceTimezone("Asia/Kolkataa", "Asia/Kolkata", warn)).toBe("Asia/Kolkata");
    expect(resolveWorkspaceTimezone("Not/AZone", "Asia/Kolkata", warn)).toBe("Asia/Kolkata");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("Asia/Kolkataa");
  });

  it("calculations still work after invalid-config fallback", () => {
    // Simulate what happens if resolveWorkspaceTimezone gave us a valid
    // fallback: the workspace calendar helpers must still produce sane
    // output for a canonical input.
    const tz = resolveWorkspaceTimezone("garbage", "Asia/Kolkata", () => {});
    expect(tz).toBe("Asia/Kolkata");
    expect(workspaceCalendarKey("2026-08-27T18:30:00.000Z", tz)).toBe("2026-08-28");
    expect(workspaceTodayKey(new Date("2026-08-27T18:30:00.000Z"), tz)).toBe("2026-08-28");
  });
});

describe("workspaceCalendarKey — midnight boundaries", () => {
  it("22:00 UTC → next day in IST", () => {
    // 22:00 UTC Aug 27 = 03:30 IST Aug 28.
    expect(workspaceCalendarKey("2026-08-27T22:00:00.000Z", "Asia/Kolkata")).toBe("2026-08-28");
  });

  it("18:29 UTC still same day in IST, 18:30 UTC rolls to next day in IST", () => {
    // 18:29 UTC Aug 27 = 23:59 IST Aug 27.
    expect(workspaceCalendarKey("2026-08-27T18:29:00.000Z", "Asia/Kolkata")).toBe("2026-08-27");
    // 18:30 UTC Aug 27 = 00:00 IST Aug 28.
    expect(workspaceCalendarKey("2026-08-27T18:30:00.000Z", "Asia/Kolkata")).toBe("2026-08-28");
  });

  it("returns null for empty / invalid input", () => {
    expect(workspaceCalendarKey(null)).toBe(null);
    expect(workspaceCalendarKey(undefined)).toBe(null);
    expect(workspaceCalendarKey("garbage")).toBe(null);
  });
});

describe("workspaceTodayKey — server-timezone-independent", () => {
  it("uses workspace TZ regardless of what the server clock says", () => {
    // Instant is 19:30 UTC Aug 26 = 01:00 IST Aug 27.
    const instant = new Date("2026-08-26T19:30:00.000Z");
    expect(workspaceTodayKey(instant, "Asia/Kolkata")).toBe("2026-08-27");
    // Same instant read in UTC is still Aug 26.
    expect(workspaceTodayKey(instant, "UTC")).toBe("2026-08-26");
  });
});

describe("workspaceDateKeysForRange", () => {
  it("returns N chronological workspace-calendar keys ending on today", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const keys = workspaceDateKeysForRange(7, now, "Asia/Kolkata");
    expect(keys.length).toBe(7);
    expect(keys.at(-1)).toBe("2026-08-27");
    expect(keys[0]).toBe("2026-08-21");
    // Strictly ascending.
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });
});

describe("workspaceRangeBounds — UTC ISO bounds", () => {
  it("fromIso and untilIso are workspace-anchored day boundaries", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const b = workspaceRangeBounds(7, now, "Asia/Kolkata");
    // fromIso corresponds to Aug 21 00:00 IST = Aug 20 18:30 UTC.
    expect(b.fromIso).toBe("2026-08-20T18:30:00.000Z");
    // untilIso corresponds to Aug 28 00:00 IST = Aug 27 18:30 UTC.
    expect(b.untilIso).toBe("2026-08-27T18:30:00.000Z");
    expect(b.days).toBe(7);
  });

  it("30-day and 90-day windows land on the correct workspace midnight", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const b30 = workspaceRangeBounds(30, now, "Asia/Kolkata");
    expect(workspaceCalendarKey(b30.fromIso, "Asia/Kolkata")).toBe("2026-07-29");
    expect(workspaceCalendarKey(b30.untilIso, "Asia/Kolkata")).toBe("2026-08-28");
    const b90 = workspaceRangeBounds(90, now, "Asia/Kolkata");
    expect(workspaceCalendarKey(b90.fromIso, "Asia/Kolkata")).toBe("2026-05-30");
    expect(workspaceCalendarKey(b90.untilIso, "Asia/Kolkata")).toBe("2026-08-28");
  });
});
