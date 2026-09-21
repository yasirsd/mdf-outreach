import { cagr, yearOverYear } from "../../series";
import { canonicalizeBaciNumber } from "./numeric";

export interface BaciReportObservation {
  period: string;
  partnerCountry: string | null;
  tradeValueUsd?: number | null;
  quantity?: number | null;
  quantityUnit?: string | null;
}

export interface BaciDevelopmentReport {
  mdfProduct: "Guntur Dry Red Chilli";
  tradeClassification: "HS17 090421";
  mapping: "TRADE PROXY";
  rawEvidence: "BACI bilateral exporter-to-Malaysia observations";
  worldTotalDerivation: "MDF sum of complete BACI bilateral observations";
  latestAvailableYear: string | null;
  totalImportValueUsd: number | null;
  totalImportQuantityTonnes: number | null;
  indiaImportValueUsd: number | null;
  indiaShare: number | null;
  indiaRank: number | null;
  topOrigins: Array<{ country: string; tradeValueUsd: number | null }>;
  annualImports: Array<{
    year: string;
    tradeValueUsd: number | null;
    quantityTonnes: number | null;
  }>;
  annualImportsFromIndia: Array<{ year: string; tradeValueUsd: number | null }>;
  yoy: number | null;
  cagr3Year: number | null;
  cagr5Year: number | null;
  usdPerKg: number | null;
}

function sumComplete(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return canonicalizeBaciNumber(
    (values as readonly number[]).reduce((sum, value) => sum + value, 0),
  );
}

function sumCompatibleTonnes(rows: readonly BaciReportObservation[]): number | null {
  if (rows.length === 0 || rows.some((row) => row.quantity === null || row.quantityUnit !== "tonne")) {
    return null;
  }
  return canonicalizeBaciNumber(
    (rows as readonly (BaciReportObservation & { quantity: number })[])
      .reduce((sum, row) => sum + row.quantity, 0),
  );
}

/** Derive every analytical view from one complete set of raw bilateral rows. */
export function buildBaciDevelopmentReport(
  bilateral: readonly BaciReportObservation[],
): BaciDevelopmentReport {
  const canonicalBilateral = bilateral.map((row): BaciReportObservation => ({
    ...row,
    tradeValueUsd: typeof row.tradeValueUsd === "number"
      ? canonicalizeBaciNumber(row.tradeValueUsd)
      : row.tradeValueUsd,
    quantity: typeof row.quantity === "number"
      ? canonicalizeBaciNumber(row.quantity)
      : row.quantity,
  }));
  const byYear = new Map<string, BaciReportObservation[]>();
  for (const row of canonicalBilateral) {
    const bucket = byYear.get(row.period) ?? [];
    bucket.push(row);
    byYear.set(row.period, bucket);
  }
  const annualImports = [...byYear]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, rows]) => ({
      year,
      tradeValueUsd: sumComplete(rows.map((row) => row.tradeValueUsd ?? null)),
      quantityTonnes: sumCompatibleTonnes(rows),
    }));
  const indiaRows = canonicalBilateral
    .filter((row) => row.partnerCountry === "IN")
    .sort((a, b) => a.period.localeCompare(b.period));
  const annualImportsFromIndia = indiaRows.map((row) => ({
    year: row.period,
    tradeValueUsd: row.tradeValueUsd ?? null,
  }));
  const latest = annualImports.at(-1);
  const latestRows = latest ? byYear.get(latest.year) ?? [] : [];
  const latestIndia = latestRows.find((row) => row.partnerCountry === "IN");
  const rankedOrigins = latestRows
    .filter((row) => row.partnerCountry !== null && typeof row.tradeValueUsd === "number")
    .sort((a, b) => (b.tradeValueUsd ?? 0) - (a.tradeValueUsd ?? 0));
  const indiaIndex = rankedOrigins.findIndex((row) => row.partnerCountry === "IN");
  const totalValue = latest?.tradeValueUsd ?? null;
  const totalQuantity = latest?.quantityTonnes ?? null;
  const indiaValue = latestIndia?.tradeValueUsd ?? null;
  const totalSeries = annualImports.map((row) => ({ period: row.year, value: row.tradeValueUsd }));
  return {
    mdfProduct: "Guntur Dry Red Chilli",
    tradeClassification: "HS17 090421",
    mapping: "TRADE PROXY",
    rawEvidence: "BACI bilateral exporter-to-Malaysia observations",
    worldTotalDerivation: "MDF sum of complete BACI bilateral observations",
    latestAvailableYear: latest?.year ?? null,
    totalImportValueUsd: totalValue,
    totalImportQuantityTonnes: totalQuantity,
    indiaImportValueUsd: indiaValue,
    indiaShare:
      totalValue !== null && totalValue > 0 && indiaValue !== null
        ? indiaValue / totalValue
        : null,
    indiaRank: indiaIndex >= 0 ? indiaIndex + 1 : null,
    topOrigins: rankedOrigins.slice(0, 10).map((row) => ({
      country: row.partnerCountry!,
      tradeValueUsd: row.tradeValueUsd ?? null,
    })),
    annualImports,
    annualImportsFromIndia,
    yoy: yearOverYear(totalSeries).percent,
    cagr3Year: cagr(totalSeries, 3).percent,
    cagr5Year: cagr(totalSeries, 5).percent,
    usdPerKg:
      totalQuantity !== null && totalQuantity > 0 && totalValue !== null
        ? totalValue / (totalQuantity * 1000)
        : null,
  };
}
