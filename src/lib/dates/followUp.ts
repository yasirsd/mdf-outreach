/**
 * MDF Outreach — DATE-ONLY follow-up contract.
 *
 * DOMAIN SEMANTIC
 *   A buyer follow-up is a CALENDAR DATE — "follow up on 2026-08-30",
 *   NOT "at a specific instant 09:00 UTC on 2026-08-30". Every UI
 *   comparison / label / sort key runs through these helpers so a
 *   value stored while writing from one operator timezone reads back
 *   as the same calendar day for every other operator.
 *
 * STORAGE (unchanged)
 *   `buyers.next_follow_up_at` is a Postgres `timestamptz`. When we
 *   WRITE a follow-up we serialise it as
 *     `YYYY-MM-DDT09:00:00.000Z`
 *   — the historical canonical 09:00 UTC anchor the legacy
 *   `<input type="date">` used, kept so pre-F5 rows round-trip
 *   correctly. On READ we take the `YYYY-MM-DD` PREFIX of whatever
 *   ISO string comes back — that prefix is the semantic value.
 *
 * SUPABASE / POSTGREST READ CONTRACT
 *   Under Supabase's default configuration the PostgREST layer
 *   serialises `timestamptz` values as UTC ISO strings — so the
 *   YYYY-MM-DD prefix of the returned string equals the calendar day
 *   we wrote. Every UI consumer relies on that convention.
 *
 *   If a future deployment changes the database or PostgREST session
 *   timezone to something other than UTC, the returned ISO prefix
 *   could shift and this convention MUST be reviewed. Nothing in the
 *   app compensates for that scenario today — it is out of contract.
 *
 * PARSE / SERIALISE IDENTITY
 *   `parseFollowUpDate` never runs `new Date(iso)` on the full string;
 *   it slices the leading `YYYY-MM-DD` and builds a local-midnight
 *   Date so `getFullYear/Month/Date` cannot surprise. `serializeFollowUpDate`
 *   likewise reads local `getFullYear/Month/Date` and writes the 09:00
 *   UTC anchor — no timezone conversion is applied on either side.
 */

const YYYY_MM_DD = /^(\d{4})-(\d{2})-(\d{2})/;

export interface FollowUpDate {
  /** Canonical YYYY-MM-DD string — always local-calendar-safe. */
  key: string;
  /** JS Date at LOCAL midnight of the same calendar day. */
  date: Date;
}

/**
 * Parse whatever the DB / DatePicker stored. Accepts:
 *   • `YYYY-MM-DD`
 *   • `YYYY-MM-DDTHH:mm:ss(.sss)?Z?`
 *   • `undefined` / `null` → returns null.
 *
 * Never applies timezone conversion. The YYYY-MM-DD prefix IS the
 * authoritative calendar date. Local JS Date is constructed at
 * midnight of that day so `getFullYear/Month/Date` never surprises.
 */
export function parseFollowUpDate(
  input: string | null | undefined,
): FollowUpDate | null {
  if (!input) return null;
  const m = YYYY_MM_DD.exec(input);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return { key: `${m[1]}-${m[2]}-${m[3]}`, date };
}

/**
 * Serialise a local-calendar Date to the canonical `YYYY-MM-DDT09:00:00.000Z`
 * storage form. `.getFullYear() / getMonth() / getDate()` read the LOCAL
 * calendar day the operator chose — no UTC conversion.
 */
export function serializeFollowUpDate(day: Date | undefined | null): string | undefined {
  if (!day) return undefined;
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T09:00:00.000Z`;
}

/**
 * `YYYY-MM-DD` key from a stored value — used by sort/filter/compare
 * flows so `localeCompare` on the key remains equivalent to comparing
 * calendar days.
 */
export function followUpDateKey(input: string | null | undefined): string | null {
  const parsed = parseFollowUpDate(input);
  return parsed?.key ?? null;
}

/**
 * "Today" in the operator's local calendar, as a `YYYY-MM-DD` key.
 * Injectable `now` for tests.
 */
export function todayDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Is the given stored follow-up date strictly before today's local
 * calendar day? Date-only comparison — never relies on ambient
 * timezone-sensitive Date math.
 */
export function isFollowUpOverdue(
  stored: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const key = followUpDateKey(stored);
  if (!key) return false;
  return key < todayDateKey(now);
}

/**
 * Human-readable date-only format (e.g. "30 Aug 2026"). Uses the
 * OPERATOR'S locale but NEVER exposes a time-of-day for follow-ups
 * (which are date-only by contract).
 */
export function formatFollowUpDate(
  stored: string | null | undefined,
  locale?: string,
): string {
  const parsed = parseFollowUpDate(stored);
  if (!parsed) return "";
  return parsed.date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
