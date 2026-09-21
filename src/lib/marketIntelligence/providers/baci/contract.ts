import { marketQueryFingerprint } from "../../fetchLedger";
import { MI_PROVIDER_SELECTION_VERSION } from "../../providerSelection";
import type {
  CountryAlpha2,
  MarketProviderCapability,
} from "../../types";
import { toBaciCountryId } from "./country";

export const BACI_OEC_DATASET_ID = "baci-hs17";
export const BACI_OEC_DATASET_PAGE =
  "https://botmarket.oec.world/dataset/baci-hs17";
/** Public metadata/schema endpoint; no credential required. */
export const BACI_OEC_METADATA_ENDPOINT =
  "https://botmarket.oec.world/api/datasets/baci-hs17";
/** Public 100-row compatibility sample; no credential required. */
export const BACI_OEC_SAMPLE_ENDPOINT =
  "https://botmarket.oec.world/api/datasets/baci-hs17/sample";
/** Authenticated filtered endpoint; never used by public-sample verification. */
export const BACI_OEC_QUERY_ENDPOINT =
  "https://botmarket.oec.world/api/datasets/baci-hs17/query";
export const BACI_OEC_QUERY_LIMIT = 1000;
export const BACI_NATIVE_HS17_START_YEAR = 2017;
export const BACI_LATEST_VERIFIED_YEAR = 2024;
export const MALAYSIA_CHILLI_PRODUCT_ID = "guntur-dry-red-chilli";
export const MALAYSIA_CHILLI_HS17_CODE = "090421";
export const EXCLUDED_GROUND_CHILLI_HS17_CODE = "090422";

export type BaciProofQueryKind = "canonical_bilateral";

export interface BaciQuerySpec {
  kind: BaciProofQueryKind;
  capability: MarketProviderCapability;
  reporterCountry: CountryAlpha2;
  partnerCountry: CountryAlpha2 | null;
  years: number[];
  hsCode: typeof MALAYSIA_CHILLI_HS17_CODE;
  importerId: string;
  exporterId?: string;
  limit: number;
}

function inclusiveYears(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/**
 * The one approved MI1D.1 logical query. Pagination is a transport detail:
 * every page shares this scope and fingerprint.
 */
export function buildMalaysiaChilliProofQuery(): BaciQuerySpec {
  const years = inclusiveYears(BACI_NATIVE_HS17_START_YEAR, BACI_LATEST_VERIFIED_YEAR);
  return buildCountryChilliQuery("MY", years);
}

/**
 * MI1F — cohort-generic country query. Same HS 090421 trade proxy scope
 * as the MI1D Malaysia proof, but reporter/importer + analytical years
 * are supplied. `years` MUST be the current provider-supported analytical
 * window; the orchestrator obtains it from `fetchBaciYearMembers()`.
 * Freezes the returned spec so pagination cannot mutate it.
 */
export function buildCountryChilliQuery(
  reporterCountry: CountryAlpha2,
  years: readonly number[],
): BaciQuerySpec {
  if (!Number.isInteger(years[0]) || years.length === 0) {
    throw new Error("buildCountryChilliQuery requires a non-empty year list");
  }
  return Object.freeze({
    kind: "canonical_bilateral" as const,
    capability: "origin_breakdown" as const,
    reporterCountry,
    partnerCountry: null,
    years: [...years].sort((a, b) => a - b),
    hsCode: MALAYSIA_CHILLI_HS17_CODE,
    importerId: toBaciCountryId(reporterCountry),
    limit: BACI_OEC_QUERY_LIMIT,
  });
}

export function baciQueryUrl(spec: BaciQuerySpec, offset = 0): string {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("BACI query offset must be a non-negative integer");
  const url = new URL(BACI_OEC_QUERY_ENDPOINT);
  for (const year of spec.years) url.searchParams.append("year", String(year));
  url.searchParams.set("importer_id", spec.importerId);
  if (spec.exporterId) url.searchParams.set("exporter_id", spec.exporterId);
  url.searchParams.set("hs_code", spec.hsCode);
  url.searchParams.set("limit", String(spec.limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("format", "json");
  return url.toString();
}

export function baciQueryFingerprint(spec: BaciQuerySpec): string {
  const coverageStart = String(Math.min(...spec.years));
  const coverageEnd = String(Math.max(...spec.years));
  return marketQueryFingerprint({
    providerId: "baci_oec",
    datasetId: BACI_OEC_DATASET_ID,
    reporterCountry: spec.reporterCountry,
    partnerCountry: spec.partnerCountry,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: [spec.hsCode],
    frequency: "annual",
    coverageStart,
    coverageEnd,
    providerSelectionVersion: MI_PROVIDER_SELECTION_VERSION,
  });
}
