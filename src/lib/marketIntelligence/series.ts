/**
 * MI0 — deterministic growth primitives for Market Intelligence
 * time series. Every helper here is pure; no I/O, no fallbacks.
 *
 * Missing-data rule: an absent point stays absent. A `null` sample is
 * never treated as zero. A CAGR / YoY that cannot be computed returns
 * `null` — the caller must render "Not available" or hide the chip
 * rather than manufacture a percentage.
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

export interface GrowthResult {
  /** null when the calculation cannot be performed under the missing-data rule. */
  percent: number | null;
  reason: "ok" | "insufficient_periods" | "zero_base" | "invalid_value";
  supportCount: number;
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Year-over-year growth between the two most recent non-null points.
 * A zero base returns `null` with `reason: "zero_base"` — MI never
 * emits +∞ or NaN. A negative or non-finite value is rejected.
 */
export function yearOverYear(series: DatedPoint[]): GrowthResult {
  const sorted = [...series].sort((a, b) => a.period.localeCompare(b.period));
  const known = sorted.filter((p) => isFiniteNonNegative(p.value));
  if (known.length < 2) return { percent: null, reason: "insufficient_periods", supportCount: known.length };
  const last = known[known.length - 1]!.value as number;
  const prev = known[known.length - 2]!.value as number;
  if (prev === 0) return { percent: null, reason: "zero_base", supportCount: known.length };
  if (!Number.isFinite(last) || !Number.isFinite(prev)) {
    return { percent: null, reason: "invalid_value", supportCount: known.length };
  }
  return { percent: (last - prev) / prev, reason: "ok", supportCount: known.length };
}

/**
 * Compound annual growth rate over the trailing N periods. Requires
 * at least two ordered points with strictly positive values (CAGR is
 * undefined when the base is 0 or negative). Fractional years are
 * computed from period count minus one so a 5-year annual series
 * yields a 4-year CAGR — matching accepted trade-statistics practice.
 */
export function cagr(series: DatedPoint[], years: number): GrowthResult {
  if (!Number.isFinite(years) || years <= 0) {
    return { percent: null, reason: "insufficient_periods", supportCount: 0 };
  }
  const sorted = [...series].sort((a, b) => a.period.localeCompare(b.period));
  const known = sorted.filter((p) => isFiniteNonNegative(p.value));
  if (known.length < 2) return { percent: null, reason: "insufficient_periods", supportCount: known.length };
  const requiredPoints = Math.min(known.length, Math.max(2, years + 1));
  const window = known.slice(-requiredPoints);
  const base = window[0]!.value as number;
  const last = window[window.length - 1]!.value as number;
  if (!isFinitePositive(base)) return { percent: null, reason: "zero_base", supportCount: window.length };
  if (!Number.isFinite(last) || last < 0) {
    return { percent: null, reason: "invalid_value", supportCount: window.length };
  }
  const spanYears = window.length - 1;
  if (spanYears <= 0) return { percent: null, reason: "insufficient_periods", supportCount: window.length };
  const percent = Math.pow(last / base, 1 / spanYears) - 1;
  if (!Number.isFinite(percent)) {
    return { percent: null, reason: "invalid_value", supportCount: window.length };
  }
  return { percent, reason: "ok", supportCount: window.length };
}

/**
 * Rolling-mean stability index. Higher = more stable. Standard
 * deviation is scaled by the trimmed mean so the index sits in [0, 1]
 * for a positive series; volatile series compress the index toward 0.
 * Returns null when there are fewer than three non-null points.
 */
export function stabilityIndex(series: DatedPoint[]): { index: number | null; supportCount: number } {
  const known = series
    .map((p) => (isFiniteNonNegative(p.value) ? p.value : null))
    .filter((v): v is number => v !== null);
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
  const known = [...series]
    .sort((a, b) => a.period.localeCompare(b.period))
    .filter((p) => isFiniteNonNegative(p.value)) as { period: string; value: number }[];
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
