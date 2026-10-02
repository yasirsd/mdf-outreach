/**
 * TH04A — Thai Customs market-level evidence projection.
 *
 * The Thai Customs Data Catalog ctm_06_11 dataset is INHERENTLY
 * MARKET-LEVEL: it reports Thailand's import flows aggregated to
 * (year, month, HS8, statistical code, origin country) with no
 * company identity. The provider therefore NEVER emits
 * company-level evidence. The following projection rules match
 * TH01/TH02's contract:
 *
 *   observed Thailand imports at HS 09042110        → market_import_activity: observed
 *   observed India-origin rows at HS 09042110       → india_origin_market_activity: observed
 *                                                     AND product_relevance: observed
 *   valid empty result for HS 09042110              → market not_observed
 *   valid HS result but zero India rows             → india not_observed, market observed
 *   infrastructure failure                          → unknown (never not_observed)
 *   parser / schema failure                         → quarantined (via T12 v2)
 *
 * `company_shipment_activity` is NEVER touched — it stays the
 * TH02 type-pinned literal `"UNKNOWN"`.
 */

import type { ThaiCustomsStatsRow } from "./parser";

export interface ThaiCustomsMarketProjection {
  readonly productRelevance: "observed" | "not_observed" | "unknown";
  readonly marketImportActivity: "observed" | "not_observed" | "unknown";
  readonly indiaOriginMarketActivity: "observed" | "not_observed" | "unknown";
  /** For audit; the aggregator reports these but does NOT promote them to shipment claims. */
  readonly totalMarketImportValueThb: number;
  readonly indiaMarketImportValueThb: number;
  readonly totalMarketRows: number;
  readonly indiaMarketRows: number;
  readonly observedStatisticalCodes: readonly string[];
  readonly sourcePeriod: string;
  readonly indiaSourceKey: "IN";
}

/**
 * Project filtered Thailand-import rows into market-level evidence.
 * `hsRows` are rows that already pass `hs8 === "09042110"` (or the
 * configured HS8). `sourcePeriod` is the actual period of the
 * downloaded CSV resource.
 */
export function projectThaiCustomsMarketEvidence(input: {
  hsRows: readonly ThaiCustomsStatsRow[];
  indiaSourceKey?: string;
  sourcePeriod: string;
}): ThaiCustomsMarketProjection {
  const indiaKey = (input.indiaSourceKey ?? "IN").toUpperCase();
  const hsRows = input.hsRows;
  const indiaRows = hsRows.filter((r) => r.originCountryCode === indiaKey);

  // Aggregate value / quantity — never per-company, always market-wide.
  const totalMarketImportValueThb = sumValues(hsRows);
  const indiaMarketImportValueThb = sumValues(indiaRows);
  const observedStatisticalCodes = Array.from(
    new Set(hsRows.map((r) => r.statisticalCode).filter((c): c is string => c !== null)),
  ).sort();

  const productRelevance: "observed" | "not_observed" | "unknown" =
    hsRows.length > 0 ? "observed" : "not_observed";
  const marketImportActivity: "observed" | "not_observed" | "unknown" =
    hsRows.length > 0 ? "observed" : "not_observed";
  const indiaOriginMarketActivity: "observed" | "not_observed" | "unknown" =
    indiaRows.length > 0 ? "observed" : "not_observed";

  return {
    productRelevance,
    marketImportActivity,
    indiaOriginMarketActivity,
    totalMarketImportValueThb,
    indiaMarketImportValueThb,
    totalMarketRows: hsRows.length,
    indiaMarketRows: indiaRows.length,
    observedStatisticalCodes,
    sourcePeriod: input.sourcePeriod,
    indiaSourceKey: "IN",
  };
}

function sumValues(rows: readonly ThaiCustomsStatsRow[]): number {
  let sum = 0;
  for (const r of rows) if (typeof r.importValueThb === "number") sum += r.importValueThb;
  return sum;
}
