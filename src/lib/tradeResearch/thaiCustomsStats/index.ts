/**
 * TH04A — Thai Customs Statistics provider barrel.
 *
 * Market-level trade evidence for Thailand sourced from the
 * official Customs Data Catalog dataset `ctm_06_11` under the Open
 * Data Common license. Reuses the T11 generic executor, T10
 * durable checkpoints, and T12 v2 certification. No Thailand-
 * specific worker lifecycle. No DBD / FDA / operator-registry
 * scraping. ₹0 provider spend.
 */

export const THAI_CUSTOMS_STATS_SOURCE_URL =
  "https://catalog.customs.go.th/dataset/ctm_06_11" as const;

export const THAI_CUSTOMS_STATS_ATTRIBUTION =
  "Source: Thai Customs Department — Imports by country of origin (dataset ctm_06_11), published on the official Customs Data Catalog under the Open Data Common license." as const;

export {
  THAI_CUSTOMS_STATS_PARSER_VERSION,
  THAI_CUSTOMS_STATS_INTERPRETATION_VERSION,
  THAI_CUSTOMS_STATS_DATASET_ID,
  ThaiCustomsStatsParserError,
  parseThaiCustomsStatsCsv,
  filterThaiCustomsStatsRows,
  type ThaiCustomsStatsRow,
} from "./parser";

export {
  THAI_CUSTOMS_STATS_CATALOG_URL,
  ThaiCustomsStatsCatalogError,
  parseCkanResources,
  selectLatestReleasedResource,
  fetchThaiCustomsStatsCatalog,
  type ThaiCustomsStatsResource,
  type CkanPackageShowResponse,
} from "./catalog";

export {
  projectThaiCustomsMarketEvidence,
  type ThaiCustomsMarketProjection,
} from "./aggregate";
