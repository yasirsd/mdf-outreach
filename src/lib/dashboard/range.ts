import { workspaceRangeBounds } from "./timezone";

/**
 * MDF Outreach — F6 dashboard time range.
 *
 * Three ranges only: 7D, 30D, 90D. Default 30D.
 *
 * Range windows are anchored to the WORKSPACE timezone (see
 * ./timezone.ts). The instants returned by `rangeBounds()` are absolute
 * UTC ISO strings that correspond to workspace-calendar midnight so
 * PostgREST comparisons against `timestamptz` columns match the day
 * buckets the UI renders.
 */

export type DashboardRange = "7d" | "30d" | "90d";

export const DASHBOARD_RANGES: readonly DashboardRange[] = ["7d", "30d", "90d"] as const;

export const DEFAULT_RANGE: DashboardRange = "30d";

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === "string" && (DASHBOARD_RANGES as readonly string[]).includes(value);
}

export function parseDashboardRange(value: unknown): DashboardRange {
  return isDashboardRange(value) ? value : DEFAULT_RANGE;
}

export function rangeDays(range: DashboardRange): number {
  if (range === "7d") return 7;
  if (range === "90d") return 90;
  return 30;
}

export function rangeLabel(range: DashboardRange): string {
  if (range === "7d") return "Last 7 days";
  if (range === "90d") return "Last 90 days";
  return "Last 30 days";
}

/**
 * Absolute UTC bounds of the range's workspace-calendar window.
 *
 *   • fromIso   = 00:00 workspace wall-clock of (workspace-today − N + 1)
 *   • untilIso  = 00:00 workspace wall-clock of (workspace-tomorrow)   [exclusive]
 *
 * Handed to PostgREST as `.gte('created_at', fromIso).lt('created_at', untilIso)`.
 */
export function rangeBounds(
  range: DashboardRange,
  now: Date = new Date(),
): { fromIso: string; untilIso: string; days: number } {
  const days = rangeDays(range);
  return workspaceRangeBounds(days, now);
}
