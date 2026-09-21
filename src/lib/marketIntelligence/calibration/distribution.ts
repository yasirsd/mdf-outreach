/**
 * MI1E — distribution statistics for calibration.
 *
 * `null` values are treated as "missing" and skipped from the summary
 * (they are never coerced to zero). Every stat is deterministic; nothing
 * here writes to the DB, calls a provider, or touches session state.
 */

export interface DistributionSummary {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

/** Type-1 percentile (nearest rank) so a small cohort produces stable buckets. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 100) throw new Error(`percentile out of range: ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))] ?? null;
}

export function summarize(values: ReadonlyArray<number | null | undefined>): DistributionSummary {
  const finite = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (finite.length === 0) {
    return { n: 0, min: null, max: null, mean: null, median: null, p25: null, p50: null, p75: null, p90: null };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  return {
    n: finite.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean,
    median: percentile(sorted, 50),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

/**
 * Log10(x + 1) transform for skewed trade-value distributions. Preserves
 * zero (log10(1) = 0), collapses long tails, and remains monotonic. Used
 * ONLY for reporting distributions and for demand-size normalization —
 * the underlying number is never rewritten.
 */
export function log10p1(x: number | null): number | null {
  if (x === null || !Number.isFinite(x) || x < 0) return null;
  return Math.log10(x + 1);
}

/**
 * Winsorize by clamping to [p_low, p_high]. Used only as an OPTIONAL
 * distribution-report tool for extreme outliers; the raw value survives
 * elsewhere.
 */
export function winsorize(
  values: ReadonlyArray<number | null>,
  low = 5,
  high = 95,
): Array<number | null> {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return [...values];
  const lo = percentile(finite, low)!;
  const hi = percentile(finite, high)!;
  return values.map((v) => (v === null || !Number.isFinite(v) ? v : Math.min(Math.max(v, lo), hi)));
}

/** Descriptive outlier flag using Tukey fences on the linear or log scale. */
export function outliers(values: ReadonlyArray<number>): { indices: number[]; low: number; high: number } {
  if (values.length < 4) return { indices: [], low: -Infinity, high: Infinity };
  const q1 = percentile(values, 25)!;
  const q3 = percentile(values, 75)!;
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const indices: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (v < low || v > high) indices.push(i);
  }
  return { indices, low, high };
}
