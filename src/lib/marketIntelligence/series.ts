/**
 * MI0.1 — deterministic growth primitives for Market Intelligence
 * annual time series. Every helper here is pure; no I/O, no
 * fallbacks.
 *
 * Missing-data rule: an absent point stays absent. A `null` sample is
 * never treated as zero. A CAGR / YoY that cannot be computed returns
 * `null` — the caller must render "Not available" or hide the chip
 * rather than manufacture a percentage.
 *
 * MI0.1 correctness rules:
 *   • YoY requires **consecutive annual periods** (2023 → 2024). A
 *     four-year gap does NOT become a YoY.
 *   • CAGR uses **actual elapsed calendar years** between the base
 *     point and the last known point. Point count minus one is
 *     never used when periods have gaps.
 *   • The base point is the earliest known observation within the
 *     requested trailing window; the exponent is `lastYear − baseYear`.
 *
 * Zero vs missing: the type distinguishes `0` (source reported zero
 * imports for that period) from `null` (no observation). MI must not
 * paper over the difference; that would silently overstate coverage.
 */

export type SeriesFrequency = "annual" | "quarterly" | "monthly";

/**
 * A dated numeric sample. `value = null` means the period exists on
 * the timeline but the provider did not report data for it — callers
 * MUST NOT coerce to zero.
 */
export interface DatedPoint {
  /** ISO period label — "2024" (annual), "2024-Q3", "2024-06". */
  period: string;
  value: number | null;
}

export type GrowthReason =
  | "ok"
  | "insufficient_periods"
  | "non_consecutive_periods"
  | "zero_base"
  | "invalid_value"
  | "unsupported_frequency";

export interface GrowthResult {
  /** null when the calculation cannot be performed under the missing-data rule. */
  percent: number | null;
  reason: GrowthReason;
  supportCount: number;
  /** MI0.1 — the calendar-year span actually used, when applicable. */
  yearsSpanned?: number;
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Parse the year out of a period label. Returns `undefined` for
 * anything that is not a plain annual label — MI0.1's YoY/CAGR only
 * operate on annual periods. Monthly and quarterly semantics ship
 * with MI1.
 */
export function annualPeriodYear(period: string): number | undefined {
  if (!/^\d{4}$/.test(period)) return undefined;
  const year = Number.parseInt(period, 10);
  return Number.isFinite(year) ? year : undefined;
}

interface KnownPoint {
  year: number;
  value: number;
}

/** Sort → dedupe on year → keep only annual points with a non-negative value. */
function normalizeAnnualSeries(series: DatedPoint[]): KnownPoint[] {
  const seenYears = new Set<number>();
  const out: KnownPoint[] = [];
  const sorted = [...series].sort((a, b) => a.period.localeCompare(b.period));
  for (const p of sorted) {
    const year = annualPeriodYear(p.period);
    if (year === undefined) continue; // not annual — skip
    if (seenYears.has(year)) continue; // duplicate period — first wins
    seenYears.add(year);
    if (!isFiniteNonNegative(p.value)) continue;
    out.push({ year, value: p.value });
  }
  return out.sort((a, b) => a.year - b.year);
}

/**
 * MI0.1 — Year-over-year growth. Requires the two most recent known
 * annual points to be **consecutive calendar years**. A gap
 * (2020 → 2024) returns `non_consecutive_periods` rather than
 * silently producing a four-year growth passed off as annual.
 * A zero base returns `null` with reason `zero_base`.
 */
export function yearOverYear(series: DatedPoint[]): GrowthResult {
  const known = normalizeAnnualSeries(series);
  if (known.length < 2) {
    return { percent: null, reason: "insufficient_periods", supportCount: known.length };
  }
  const last = known[known.length - 1]!;
  const prev = known[known.length - 2]!;
  if (last.year - prev.year !== 1) {
    return {
      percent: null,
      reason: "non_consecutive_periods",
      supportCount: known.length,
      yearsSpanned: last.year - prev.year,
    };
  }
  if (prev.value === 0) {
    return { percent: null, reason: "zero_base", supportCount: known.length, yearsSpanned: 1 };
  }
  if (!Number.isFinite(last.value) || !Number.isFinite(prev.value)) {
    return { percent: null, reason: "invalid_value", supportCount: known.length };
  }
  return {
    percent: (last.value - prev.value) / prev.value,
    reason: "ok",
    supportCount: known.length,
    yearsSpanned: 1,
  };
}

/**
 * MI0.1 — Compound annual growth rate across the trailing `years`
 * calendar-year window.
 *
 * Base = earliest known observation whose year is >= (latestYear -
 * years). Exponent = actual `latestYear − baseYear`. If no base
 * exists in the window (a series with only the latest known point in
 * the range and everything else older), returns
 * `insufficient_periods` — MI never fabricates a base point.
 */
export function cagr(series: DatedPoint[], years: number): GrowthResult {
  if (!Number.isFinite(years) || years <= 0) {
    return { percent: null, reason: "insufficient_periods", supportCount: 0 };
  }
  const known = normalizeAnnualSeries(series);
  if (known.length < 2) {
    return { percent: null, reason: "insufficient_periods", supportCount: known.length };
  }
  const last = known[known.length - 1]!;
  const targetBaseYear = last.year - years;
  const windowBases = known.filter(
    (p) => p.year >= targetBaseYear && p.year < last.year,
  );
  if (windowBases.length === 0) {
    return {
      percent: null,
      reason: "insufficient_periods",
      supportCount: known.length,
    };
  }
  const base = windowBases[0]!;
  const spanYears = last.year - base.year;
  if (spanYears <= 0) {
    return { percent: null, reason: "insufficient_periods", supportCount: known.length };
  }
  if (!isFinitePositive(base.value)) {
    return {
      percent: null,
      reason: "zero_base",
      supportCount: known.length,
      yearsSpanned: spanYears,
    };
  }
  if (!Number.isFinite(last.value) || last.value < 0) {
    return { percent: null, reason: "invalid_value", supportCount: known.length };
  }
  const percent = Math.pow(last.value / base.value, 1 / spanYears) - 1;
  if (!Number.isFinite(percent)) {
    return {
      percent: null,
      reason: "invalid_value",
      supportCount: known.length,
      yearsSpanned: spanYears,
    };
  }
  return {
    percent,
    reason: "ok",
    supportCount: known.length,
    yearsSpanned: spanYears,
  };
}

/**
 * Rolling-mean stability index. Higher = more stable. Standard
 * deviation is scaled by the trimmed mean so the index sits in [0, 1]
 * for a positive series; volatile series compress the index toward 0.
 * Returns null when there are fewer than three non-null points.
 */
export function stabilityIndex(series: DatedPoint[]): { index: number | null; supportCount: number } {
  const known = normalizeAnnualSeries(series).map((p) => p.value);
  if (known.length < 3) return { index: null, supportCount: known.length };
  const mean = known.reduce((sum, v) => sum + v, 0) / known.length;
  if (mean <= 0) return { index: null, supportCount: known.length };
  const variance = known.reduce((sum, v) => sum + (v - mean) ** 2, 0) / known.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  const index = Math.max(0, Math.min(1, 1 - cv));
  return { index, supportCount: known.length };
}

/**
 * Trend direction from the last three known points, using a simple
 * arithmetic slope. Returns "flat" when the middle sample sits within
 * ±5% of both neighbours or when fewer than three known points exist.
 */
export type TrendDirection = "rising" | "falling" | "flat" | "unknown";

export function trendDirection(series: DatedPoint[]): TrendDirection {
  const known = normalizeAnnualSeries(series);
  if (known.length < 3) return "unknown";
  const last3 = known.slice(-3);
  const [a, b, c] = [last3[0]!.value, last3[1]!.value, last3[2]!.value];
  if (a === 0 && c === 0) return "flat";
  const rising = a <= b && b <= c && c > a;
  const falling = a >= b && b >= c && c < a;
  if (rising) return "rising";
  if (falling) return "falling";
  const drift = a > 0 ? Math.abs(c - a) / a : 1;
  if (drift < 0.05) return "flat";
  return c > a ? "rising" : "falling";
}
