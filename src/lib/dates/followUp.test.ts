import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  followUpDateKey,
  formatFollowUpDate,
  isFollowUpOverdue,
  parseFollowUpDate,
  serializeFollowUpDate,
  todayDateKey,
} from "./followUp";

/**
 * F5 follow-up — date-only contract.
 *
 * The stored `YYYY-MM-DDT09:00:00.000Z` value must round-trip to the
 * SAME calendar day regardless of the operator's local timezone.
 *
 * Vitest cannot literally change the process TZ mid-run, so we exercise
 * the pure helpers against inputs shaped exactly like what each timezone
 * would send. `todayDateKey(now)` is injectable so overdue tests never
 * depend on the wall clock.
 */

describe("parseFollowUpDate", () => {
  it("extracts the YYYY-MM-DD prefix from a full ISO string (09:00 UTC anchor)", () => {
    const parsed = parseFollowUpDate("2026-08-30T09:00:00.000Z");
    expect(parsed?.key).toBe("2026-08-30");
    expect(parsed?.date.getFullYear()).toBe(2026);
    expect(parsed?.date.getMonth()).toBe(7); // August
    expect(parsed?.date.getDate()).toBe(30);
  });

  it("accepts a bare YYYY-MM-DD form", () => {
    const parsed = parseFollowUpDate("2026-12-31");
    expect(parsed?.key).toBe("2026-12-31");
    expect(parsed?.date.getDate()).toBe(31);
  });

  it("rejects garbage / null / undefined", () => {
    expect(parseFollowUpDate(null)).toBeNull();
    expect(parseFollowUpDate(undefined)).toBeNull();
    expect(parseFollowUpDate("not-a-date")).toBeNull();
    expect(parseFollowUpDate("")).toBeNull();
  });
});

describe("serializeFollowUpDate", () => {
  it("uses LOCAL getFullYear/Month/Date — matches the operator's picked calendar day", () => {
    const day = new Date(2026, 0, 5); // Jan 5 2026 LOCAL
    expect(serializeFollowUpDate(day)).toBe("2026-01-05T09:00:00.000Z");
  });

  it("undefined input → undefined output", () => {
    expect(serializeFollowUpDate(undefined)).toBeUndefined();
    expect(serializeFollowUpDate(null)).toBeUndefined();
  });
});

describe("Date-only round trip across timezones", () => {
  /**
   * The `stored` value carries `2026-08-30T09:00:00.000Z`. Simulate
   * four operator scenarios by asking the helper what CALENDAR DAY
   * that string represents. Because parseFollowUpDate ignores the
   * time-of-day and reads only the ISO prefix, the answer is
   * timezone-independent by construction.
   */
  const CASES: Array<{ label: string; iso: string }> = [
    { label: "India (UTC+5:30)", iso: "2026-08-30T09:00:00.000Z" },
    { label: "UTC", iso: "2026-08-30T09:00:00.000Z" },
    { label: "US Pacific (UTC-08)", iso: "2026-08-30T09:00:00.000Z" },
    { label: "Sydney (UTC+10)", iso: "2026-08-30T09:00:00.000Z" },
    { label: "Baker Island (UTC-12)", iso: "2026-08-30T09:00:00.000Z" },
    { label: "Kiribati (UTC+14)", iso: "2026-08-30T09:00:00.000Z" },
  ];

  it.each(CASES)(
    "%s: 2026-08-30 remains 2026-08-30 (no ambient TZ shift)",
    ({ iso }) => {
      const key = followUpDateKey(iso);
      expect(key).toBe("2026-08-30");
    },
  );
});

describe("todayDateKey", () => {
  it("emits YYYY-MM-DD in the LOCAL calendar of the supplied Date", () => {
    // Force a local date; helper reads getFullYear/Month/Date directly.
    const local = new Date(2026, 8, 15); // Sep 15
    expect(todayDateKey(local)).toBe("2026-09-15");
  });
});

describe("isFollowUpOverdue", () => {
  it("returns true when the stored date's key < today's local key", () => {
    const stored = "2026-01-05T09:00:00.000Z";
    const now = new Date(2026, 1, 20); // Feb 20 2026
    expect(isFollowUpOverdue(stored, now)).toBe(true);
  });

  it("returns false for a future date", () => {
    const stored = "2026-12-31T09:00:00.000Z";
    const now = new Date(2026, 1, 20);
    expect(isFollowUpOverdue(stored, now)).toBe(false);
  });

  it("returns false when the follow-up is TODAY (strict < comparison)", () => {
    const stored = "2026-02-20T09:00:00.000Z";
    const now = new Date(2026, 1, 20);
    expect(isFollowUpOverdue(stored, now)).toBe(false);
  });

  it("returns false for null / undefined / malformed input", () => {
    expect(isFollowUpOverdue(null)).toBe(false);
    expect(isFollowUpOverdue(undefined)).toBe(false);
    expect(isFollowUpOverdue("bogus")).toBe(false);
  });
});

describe("formatFollowUpDate", () => {
  it("produces a date-only label without any time-of-day", () => {
    const s = formatFollowUpDate("2026-08-30T09:00:00.000Z", "en-US");
    expect(s.length).toBeGreaterThan(0);
    // No hours / colons in the output.
    expect(/\d:\d/.test(s)).toBe(false);
    // 30 (day) and 2026 (year) appear.
    expect(s.includes("30")).toBe(true);
    expect(s.includes("2026")).toBe(true);
  });
});
