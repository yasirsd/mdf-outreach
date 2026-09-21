/**
 * MI1E — per-country calibration primitives.
 *
 * MI1E.1 change: primitives consume a `CalibrationEvidenceContext`, not
 * raw rows. Origin-dependent primitives (India share/rank, top-N shares,
 * origin count, HHI) return `null` unless the context proves complete
 * bilateral coverage from the fetch ledger. India semantics follow the
 * tri-state contract: `present` → observed values; `absent` → 0/0/null;
 * `unknown` → null/null/null. Missing quantity remains `null`, never 0.
 *
 * Pure. No provider call, no DB write.
 */

import type { CalibrationEvidenceContext } from "./evidence";

export const INDIA_ALPHA2 = "IN";

export interface CountryPrimitives {
  countryAlpha2: string;
  latestYear: number | null;
  latestImportsUsd: number | null;
  latestQuantityTonnes: number | null;
  /** Derived unit value = trade_value_usd / quantity_kg. NEVER a market price. */
  latestDerivedUnitValueUsdPerKg: number | null;
  indiaImportsUsd: number | null;
  /** India share of latest-year total (0..1). `null` when set is unproven. */
  indiaShare: number | null;
  /** 1-indexed rank of India among latest-year origins; `null` unless proven. */
  indiaRank: number | null;
  originCount: number | null;
  top1OriginShare: number | null;
  top3OriginShare: number | null;
  /** Herfindahl-Hirschman Index on latest-year origin shares (0..1). */
  hhi: number | null;
  latestYoyPct: number | null;
  threeYearCagrPct: number | null;
  fiveYearCagrPct: number | null;
  /** Coefficient of variation on 5-year annual totals (SD / mean). */
  volatilityCv: number | null;
  validAnnualPeriods: number;
  /**
   * Coverage% of the ANALYTICAL window (provider-supported years within
   * the requested range), NOT the raw requested range. Malaysia proof:
   * requested 2017–2024, provider members currently [2018..2024] → the
   * denominator is 7, not 8. This keeps a year the provider legitimately
   * does not serve from lowering confidence.
   */
  analyticalCoveragePct: number;
  completenessFlags: {
    hasQuantityLatest: boolean;
    hasAtLeast3Periods: boolean;
    hasAtLeast5Periods: boolean;
    latestYearHasOrigins: boolean;
    completeBilateralCoverage: boolean;
    /** Tri-state — see CalibrationEvidenceContext.indiaPresence. */
    indiaPresence: "present" | "absent" | "unknown";
  };
}

interface AnnualBucket {
  year: number;
  totalUsd: number;
  totalKg: number;
  hasQuantity: boolean;
  origins: Map<string, number>;
}

function toKg(quantity: number | null, unit: string | null): number | null {
  if (quantity === null) return null;
  if (unit === "tonne") return quantity * 1000;
  if (unit === "kg") return quantity;
  return null;
}

function bucketByYear(context: CalibrationEvidenceContext): Map<number, AnnualBucket> {
  const byYear = new Map<number, AnnualBucket>();
  for (const row of context.observations) {
    if (row.partnerCountry === null) continue;
    const year = Number(row.period);
    if (!Number.isInteger(year)) continue;
    let bucket = byYear.get(year);
    if (!bucket) {
      bucket = { year, totalUsd: 0, totalKg: 0, hasQuantity: false, origins: new Map() };
      byYear.set(year, bucket);
    }
    if (typeof row.tradeValueUsd === "number" && row.tradeValueUsd >= 0) {
      bucket.totalUsd += row.tradeValueUsd;
      bucket.origins.set(
        row.partnerCountry,
        (bucket.origins.get(row.partnerCountry) ?? 0) + row.tradeValueUsd,
      );
    }
    const kg = toKg(row.quantity, row.quantityUnit);
    if (kg !== null) {
      bucket.totalKg += kg;
      bucket.hasQuantity = true;
    }
  }
  return byYear;
}

function cagr(startValue: number, endValue: number, years: number): number | null {
  if (!(startValue > 0) || !(endValue > 0) || !Number.isFinite(years) || years <= 0) return null;
  return ((endValue / startValue) ** (1 / years) - 1) * 100;
}

function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return null;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / mean;
}

export function computeCountryPrimitives(
  context: CalibrationEvidenceContext,
): CountryPrimitives {
  const byYear = bucketByYear(context);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1]! : null;
  const latest = latestYear !== null ? byYear.get(latestYear)! : undefined;
  const complete = context.completeBilateralCoverage;

  const latestImportsUsd = complete && latest ? latest.totalUsd : null;
  const latestQuantityKg = complete && latest && latest.hasQuantity ? latest.totalKg : null;
  const latestQuantityTonnes = latestQuantityKg !== null ? latestQuantityKg / 1000 : null;
  const latestDerivedUnitValueUsdPerKg =
    latestImportsUsd !== null && latestQuantityKg && latestQuantityKg > 0
      ? latestImportsUsd / latestQuantityKg
      : null;

  // India tri-state contract.
  const latestIndiaValue = latest ? latest.origins.get(INDIA_ALPHA2) ?? null : null;
  let indiaImportsUsd: number | null;
  let indiaShare: number | null;
  let indiaRank: number | null;
  if (!complete) {
    indiaImportsUsd = null;
    indiaShare = null;
    indiaRank = null;
  } else if (context.indiaPresence === "present") {
    indiaImportsUsd = latestIndiaValue ?? 0;
    indiaShare =
      latestImportsUsd && latestImportsUsd > 0 && latestIndiaValue !== null
        ? latestIndiaValue / latestImportsUsd
        : 0;
    if (latest) {
      const ranked = [...latest.origins.entries()].sort(([, a], [, b]) => b - a);
      const idx = ranked.findIndex(([code]) => code === INDIA_ALPHA2);
      indiaRank = idx >= 0 ? idx + 1 : null;
    } else {
      indiaRank = null;
    }
  } else {
    // complete + absent
    indiaImportsUsd = 0;
    indiaShare = 0;
    indiaRank = null;
  }

  const originCount = complete && latest ? latest.origins.size : null;
  const originsRanked = complete && latest
    ? [...latest.origins.entries()].sort(([, a], [, b]) => b - a)
    : [];
  const top1OriginShare =
    complete && originsRanked.length > 0 && latestImportsUsd && latestImportsUsd > 0
      ? originsRanked[0]![1] / latestImportsUsd
      : null;
  const top3OriginShare =
    complete && originsRanked.length > 0 && latestImportsUsd && latestImportsUsd > 0
      ? originsRanked.slice(0, 3).reduce((s, [, v]) => s + v, 0) / latestImportsUsd
      : null;
  const hhi =
    complete && latest && latestImportsUsd && latestImportsUsd > 0
      ? [...latest.origins.values()].reduce((s, v) => s + (v / latestImportsUsd) ** 2, 0)
      : null;

  // YoY / CAGR remain informational; they use the year totals from the
  // observations and are not scoped by completeness alone (single-year
  // percentiles can be diagnostically useful).
  const totalsByYear = new Map(years.map((y) => [y, byYear.get(y)!.totalUsd]));
  const yoyLatest =
    latestYear !== null && totalsByYear.has(latestYear - 1)
      ? (() => {
          const prev = totalsByYear.get(latestYear - 1)!;
          const curr = totalsByYear.get(latestYear)!;
          return prev > 0 ? ((curr - prev) / prev) * 100 : null;
        })()
      : null;
  const threeYearCagrPct =
    latestYear !== null && totalsByYear.has(latestYear - 3)
      ? cagr(totalsByYear.get(latestYear - 3)!, totalsByYear.get(latestYear)!, 3)
      : null;
  const fiveYearCagrPct =
    latestYear !== null && totalsByYear.has(latestYear - 5)
      ? cagr(totalsByYear.get(latestYear - 5)!, totalsByYear.get(latestYear)!, 5)
      : null;

  const recentValues = years.slice(-5).map((y) => totalsByYear.get(y)!).filter((v) => v > 0);
  const volatilityCv = recentValues.length >= 2 ? coefficientOfVariation(recentValues) : null;

  const analyticalWindow = context.coverage.analyticalYears.length;
  const observedYearsInAnalyticalWindow = years.filter((y) =>
    context.coverage.analyticalYears.includes(y),
  ).length;
  const analyticalCoveragePct =
    analyticalWindow > 0 ? (observedYearsInAnalyticalWindow / analyticalWindow) * 100 : 0;

  return {
    countryAlpha2: context.reporterCountry,
    latestYear,
    latestImportsUsd,
    latestQuantityTonnes,
    latestDerivedUnitValueUsdPerKg,
    indiaImportsUsd,
    indiaShare,
    indiaRank,
    originCount,
    top1OriginShare,
    top3OriginShare,
    hhi,
    latestYoyPct: yoyLatest,
    threeYearCagrPct,
    fiveYearCagrPct,
    volatilityCv,
    validAnnualPeriods: years.length,
    analyticalCoveragePct,
    completenessFlags: {
      hasQuantityLatest: latestQuantityKg !== null,
      hasAtLeast3Periods: years.length >= 3,
      hasAtLeast5Periods: years.length >= 5,
      latestYearHasOrigins: latest ? latest.origins.size > 0 : false,
      completeBilateralCoverage: complete,
      indiaPresence: context.indiaPresence,
    },
  };
}
