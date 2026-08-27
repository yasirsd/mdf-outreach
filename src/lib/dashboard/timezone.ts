/**
 * MDF Outreach — F6 dashboard timezone contract.
 *
 * PROBLEM
 *   The Next.js server runs in the host's local timezone. On Vercel that
 *   is UTC. `new Date().getDate()` therefore returns the UTC calendar
 *   day, and the F5 date helpers — which use `.getFullYear/Month/Date`
 *   — inherit that. At 03:00 IST (21:30 UTC previous day), a naive
 *   server-side "today" is one day BEHIND what the operator sees on
 *   the wall clock.
 *
 * DECISION
 *   MDF is a single-team internal app operated from India. Every
 *   operator sees the same calendar. So this module anchors ALL
 *   dashboard calendar arithmetic to ONE explicit workspace timezone:
 *
 *     WORKSPACE_TIMEZONE = process.env.MDF_WORKSPACE_TIMEZONE
 *                        ?? "Asia/Kolkata"
 *
 *   Every dashboard consumer (range bounds, day buckets, follow-up
 *   "today", overdue comparison) uses these helpers instead of raw
 *   `Date.getDate()` etc. F5 storage semantics are unchanged — writes
 *   still slice YYYY-MM-DD from the operator's local picker; reads
 *   still slice YYYY-MM-DD from the DB. Only the "what day is it
 *   NOW on the dashboard" comparison is anchored.
 *
 * NON-GOALS
 *   • No per-user timezone (there is no per-user timezone yet).
 *   • No workspace_settings.timezone column (no migration this phase).
 *   • No DST edge-case aviation-grade rigour — Asia/Kolkata does not
 *     observe DST. If MDF ever runs the app from a DST zone, revisit.
 */

const DEFAULT_TZ = "Asia/Kolkata";

/**
 * Validate an IANA timezone name by attempting a formatter construction.
 * `Intl.DateTimeFormat` throws `RangeError` for unknown zones — we catch
 * that and fall back to the default rather than letting the dashboard
 * page crash on a mis-typed env value.
 */
export function resolveWorkspaceTimezone(
  candidate: string | undefined | null,
  fallback: string = DEFAULT_TZ,
  warn: (msg: string) => void = defaultWarn,
): string {
  if (!candidate || typeof candidate !== "string" || candidate.trim() === "") {
    return fallback;
  }
  const trimmed = candidate.trim();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: trimmed });
    return trimmed;
  } catch {
    warn(
      `[MDF] MDF_WORKSPACE_TIMEZONE="${trimmed}" is not a valid IANA timezone; falling back to "${fallback}".`,
    );
    return fallback;
  }
}

function defaultWarn(msg: string): void {
  // Server-side warning only. Never throws.
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(msg);
  }
}

export const WORKSPACE_TIMEZONE: string = resolveWorkspaceTimezone(
  typeof process !== "undefined" ? process.env?.MDF_WORKSPACE_TIMEZONE : undefined,
);

/**
 * Extract the YYYY-MM-DD calendar key of `instant` in the workspace
 * timezone. Uses Intl.DateTimeFormat — always available on Node 18+
 * and every modern browser; no external dependency.
 */
export function workspaceCalendarKey(
  instant: Date | string | null | undefined,
  tz: string = WORKSPACE_TIMEZONE,
): string | null {
  if (!instant) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

/**
 * "Today" in the workspace calendar, as YYYY-MM-DD. Injectable `now`
 * for tests.
 */
export function workspaceTodayKey(
  now: Date = new Date(),
  tz: string = WORKSPACE_TIMEZONE,
): string {
  const k = workspaceCalendarKey(now, tz);
  if (!k) throw new Error("workspaceTodayKey: could not derive key");
  return k;
}

/**
 * Return an ordered array of workspace-calendar YYYY-MM-DD keys ending
 * on today (inclusive), N days back.
 */
export function workspaceDateKeysForRange(
  days: number,
  now: Date = new Date(),
  tz: string = WORKSPACE_TIMEZONE,
): string[] {
  if (days <= 0) return [];
  const out: string[] = [];
  // Anchor a rolling instant to noon of the target day so DST/hour
  // shifts don't produce a different YYYY-MM-DD when we step back by
  // 24h in UTC.
  const anchor = new Date(now.getTime());
  for (let i = days - 1; i >= 0; i -= 1) {
    const shifted = new Date(anchor.getTime() - i * 86_400_000);
    const key = workspaceCalendarKey(shifted, tz);
    if (key) out.push(key);
  }
  return out;
}

/**
 * Compute the UTC ISO instants that bound the workspace-calendar window
 * for a given day count.
 *
 *   fromIso   = 00:00 wall-clock of (workspace-today − (days − 1))
 *   untilIso  = 00:00 wall-clock of (workspace-tomorrow) [exclusive]
 *
 * Both are ABSOLUTE UTC instants suitable for PostgREST `.gte()` /
 * `.lt()` filters against `timestamptz` columns, regardless of the
 * server's own local timezone.
 */
export function workspaceRangeBounds(
  days: number,
  now: Date = new Date(),
  tz: string = WORKSPACE_TIMEZONE,
): { fromIso: string; untilIso: string; days: number } {
  const todayKey = workspaceTodayKey(now, tz);
  const startKey = workspaceCalendarKey(
    new Date(now.getTime() - (days - 1) * 86_400_000),
    tz,
  );
  if (!startKey) throw new Error("workspaceRangeBounds: could not derive start");
  const fromIso = workspaceMidnightInstant(startKey, tz);
  const tomorrowKey = workspaceCalendarKey(
    new Date(now.getTime() + 86_400_000),
    tz,
  );
  // If the +24h roll lands us back on today because of DST (never in
  // Asia/Kolkata, but defensive), advance until we land on a distinct
  // day so the window remains right-open on tomorrow.
  const nextDayKey =
    tomorrowKey && tomorrowKey !== todayKey
      ? tomorrowKey
      : addOneWorkspaceDay(todayKey);
  const untilIso = workspaceMidnightInstant(nextDayKey, tz);
  return { fromIso, untilIso, days };
}

/**
 * Given a YYYY-MM-DD calendar day in the workspace timezone, return the
 * UTC ISO instant of its 00:00 wall-clock local start.
 *
 * We do this by binary-anchoring: start with midnight-UTC of the day
 * and iterate at most once to correct for the workspace offset. Simpler
 * than pulling a full timezone library; good enough for a static offset
 * TZ like Asia/Kolkata.
 */
function workspaceMidnightInstant(dayKey: string, tz: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  // Candidate 1: midnight UTC of that day.
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Find the UTC instant whose workspace-calendar representation is
  // exactly this day at 00:00 wall-clock. We use the offset at that
  // day-of-year by asking Intl to format the UTC-midnight instant.
  const asWorkspaceParts = getWorkspaceParts(new Date(utcMidnight), tz);
  const offsetMinutes = computeOffsetMinutes(utcMidnight, asWorkspaceParts);
  // If workspace is +05:30, then workspace midnight = UTC midnight - 05:30.
  const instant = new Date(utcMidnight - offsetMinutes * 60_000);
  return instant.toISOString();
}

function addOneWorkspaceDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function getWorkspaceParts(instant: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    y: g("year"),
    m: g("month"),
    d: g("day"),
    h: g("hour"),
    mi: g("minute"),
  };
}

function computeOffsetMinutes(
  utcInstant: number,
  parts: { y: number; m: number; d: number; h: number; mi: number },
): number {
  const asIfLocalUtc = Date.UTC(parts.y, parts.m - 1, parts.d, parts.h, parts.mi);
  return Math.round((asIfLocalUtc - utcInstant) / 60_000);
}
