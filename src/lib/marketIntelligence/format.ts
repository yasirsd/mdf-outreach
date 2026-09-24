/**
 * MI2A — display-only numeric formatters.
 *
 * Never mutates stored precision. Every formatter is a pure function;
 * `null` / non-finite inputs render as a single em-dash "—".
 */

const EM_DASH = "—";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * USD formatted with a compact suffix: 117_349_258 → "$117.3M";
 * 5_400 → "$5.4K"; 900 → "$900".
 */
export function formatUsdCompact(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  const negative = value < 0;
  const abs = Math.abs(value);
  if (abs < 1_000) return `${negative ? "-" : ""}$${Math.round(abs)}`;
  const [scale, suffix] =
    abs >= 1_000_000_000_000 ? [1_000_000_000_000, "T"] :
    abs >= 1_000_000_000     ? [1_000_000_000, "B"] :
    abs >= 1_000_000         ? [1_000_000, "M"] :
                               [1_000, "K"];
  const scaled = abs / scale;
  const digits = scaled >= 100 ? 1 : scaled >= 10 ? 1 : 1;
  // 1 significant fraction digit for compact USD is enough at every scale
  // (5_400 → $5.4K, 117_349_258 → $117.3M, 63_349_647 → $63.3M).
  const formatted = scaled.toFixed(digits);
  return `${negative ? "-" : ""}$${formatted}${suffix}`;
}

/** 0.434085 → "43.4%"; 0 → "0%"; null → "—" */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  const asPct = value * 100;
  if (Number.isFinite(asPct)) return `${asPct.toFixed(digits)}%`;
  return EM_DASH;
}

/** 3.4297 → "3.4%" (input is already a percent). */
export function formatPercentValue(value: number | null | undefined, digits = 1): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  return `${value.toFixed(digits)}%`;
}

/** 2.406999 → "$2.41/kg"; null → "—" */
export function formatUsdPerKg(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  return `$${value.toFixed(2)}/kg`;
}

/** 48753.344 → "48.8K t"; 900 → "900 t"; null → "—" */
export function formatTonnes(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  const abs = Math.abs(value);
  if (abs < 1_000) return `${value.toFixed(0)} t`;
  const scale = abs >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = scale === 1_000_000 ? "M" : "K";
  const scaled = value / scale;
  const digits = Math.abs(scaled) >= 100 ? 0 : 1;
  return `${scaled.toFixed(digits)}${suffix} t`;
}

/** 66 → "66 / 100"; null → "—" */
export function formatScoreOutOf100(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  return `${Math.round(value)} / 100`;
}

/** 1..N → "#1", "#2", … | null → "—" */
export function formatRank(value: number | null | undefined): string {
  if (!isFiniteNumber(value) || value < 1) return EM_DASH;
  return `#${Math.round(value)}`;
}

/** 2024 → "2024"; "2024-Q1" preserved as-is; null → "—" */
export function formatPeriodLabel(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  return value;
}

export const MI2A_EM_DASH = EM_DASH;
