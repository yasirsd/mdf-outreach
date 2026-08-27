/**
 * Provider-neutral Buyer Finder usage model.
 * UI consumes this shape only — never raw Hunter JSON.
 */

export type UsageProviderId = "hunter";

export type UsageLevel = "normal" | "attention" | "low" | "critical";

export interface UsageBucket {
  used: number;
  available: number;
  remaining: number;
  percentUsed: number;
}

export interface ProviderUsage {
  provider: UsageProviderId;
  resetDate: string | null;
  unifiedCredits?: UsageBucket;
  searches?: UsageBucket;
  verifications?: UsageBucket;
  fetchedAt?: string;
}

function finiteNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function percentUsed(used: number, available: number): number {
  const safeUsed = finiteNonNegative(used);
  const safeAvailable = finiteNonNegative(available);
  if (safeAvailable <= 0) return 0;
  return clampPercent((safeUsed / safeAvailable) * 100);
}

export function toUsageBucket(used: number, available: number, remaining: number): UsageBucket {
  return {
    used: finiteNonNegative(used),
    available: finiteNonNegative(available),
    remaining: finiteNonNegative(remaining),
    percentUsed: percentUsed(used, available),
  };
}

export function usageLevel(percent: number): UsageLevel {
  const p = clampPercent(percent);
  if (p >= 95) return "critical";
  if (p >= 80) return "low";
  if (p >= 60) return "attention";
  return "normal";
}

/** Compact indicator prefers unified credits, then searches, then verifications. */
export function primaryUsageBucket(
  usage: ProviderUsage,
): { label: string; bucket: UsageBucket } | undefined {
  if (usage.unifiedCredits) return { label: "Credits", bucket: usage.unifiedCredits };
  if (usage.searches) return { label: "Search credits", bucket: usage.searches };
  if (usage.verifications) return { label: "Verification credits", bucket: usage.verifications };
  return undefined;
}

/**
 * Format Hunter reset_date as "Sep 17, 2026". Date-only strings are parsed
 * as calendar days (no local TZ shift). Returns null if missing/invalid.
 */
export function formatUsageResetDate(resetDate: string | null | undefined): string | null {
  if (!resetDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(resetDate.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
