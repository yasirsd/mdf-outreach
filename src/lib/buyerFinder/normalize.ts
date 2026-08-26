/**
 * Deterministic string helpers for Buyer Finder persistence.
 * No network, no extra dependencies.
 */

export function blankToUndefined(value: string | null | undefined): string | undefined {
  const s = (value ?? "").trim();
  return s.length > 0 ? s : undefined;
}

export function normalizeOptionalEmail(value: string | null | undefined): string | undefined {
  const s = blankToUndefined(value)?.toLowerCase();
  return s;
}

export function normalizeDomain(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return undefined;

  let host = raw;
  if (raw.includes("://")) {
    try {
      host = new URL(raw).hostname;
    } catch {
      host = raw.split("/")[0] ?? raw;
    }
  } else {
    host = raw.split("/")[0] ?? raw;
  }

  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return host.length > 0 ? host : undefined;
}

export function normalizeOptionalUrl(value: string | null | undefined): string | undefined {
  const s = blankToUndefined(value);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return undefined;
  return s;
}

export function assertScore(value: number | null | undefined, label: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a number between 0 and 100`);
  }
  return value;
}
