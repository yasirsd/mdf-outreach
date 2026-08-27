import { describe, it, expect } from "vitest";
import {
  parseIsoToLocalDate,
  serialiseLocalDayToIso,
} from "./DatePicker";

/**
 * F5 DatePicker — timezone-safe round trip.
 *
 * The stored ISO string uses a 09:00 UTC anchor for the picked
 * calendar day. Under normal operator timezones (UTC-12 to UTC+14),
 * 09:00 UTC of a given calendar day still lands on the SAME calendar
 * day in the operator's local view — so the picker reads back the
 * same day the operator originally chose. This test asserts the two
 * helpers agree on the underlying date string.
 */

describe("DatePicker helpers — timezone safety", () => {
  it("round-trips a locally-picked day through the ISO string", () => {
    const day = new Date(2026, 8, 15); // Sep 15 2026 in the local zone
    const iso = serialiseLocalDayToIso(day);
    const roundTripped = parseIsoToLocalDate(iso)!;
    expect(roundTripped.getFullYear()).toBe(2026);
    expect(roundTripped.getMonth()).toBe(8); // 0-indexed → September
    expect(roundTripped.getDate()).toBe(15);
  });

  it("accepts a stored full ISO string and reads back the stored calendar day", () => {
    // A previously-stored value.
    const iso = "2026-03-01T09:00:00.000Z";
    const parsed = parseIsoToLocalDate(iso)!;
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2); // March
    expect(parsed.getDate()).toBe(1);
  });

  it("accepts a bare YYYY-MM-DD form", () => {
    const parsed = parseIsoToLocalDate("2026-12-31")!;
    expect(parsed.getMonth()).toBe(11);
    expect(parsed.getDate()).toBe(31);
  });

  it("returns undefined for malformed input", () => {
    expect(parseIsoToLocalDate("not-a-date")).toBeUndefined();
    expect(parseIsoToLocalDate("")).toBeUndefined();
  });

  it("serialise produces a stable 09:00 UTC anchor", () => {
    const iso = serialiseLocalDayToIso(new Date(2026, 0, 5));
    expect(iso).toBe("2026-01-05T09:00:00.000Z");
  });
});
