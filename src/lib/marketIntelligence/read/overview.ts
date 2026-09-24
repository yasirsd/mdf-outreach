import "server-only";

/**
 * MI2A — server-only Market Intelligence read model.
 *
 * Pure I/O over the existing `MarketReadRepository`. The UI consumes
 * only the shapes returned here — it never re-implements Market Fit,
 * never renormalises components, never fabricates missing values.
 *
 * No writer, no provider, no cohort materialization, no score refresh.
 * A missing primitive stays `null`; a missing score row means the
 * country is honestly `unavailable` for that product.
 */

import { calibrationCohort } from "../calibration/cohort";
import { countryDisplayName } from "../country";
import { DATA_CONFIDENCE_VERSION, MARKET_FIT_VERSION } from "../marketFit";
import type {
  MarketReadRepository,
  MarketReadRepositoryScore,
  MarketReadRepositoryScoreComponent,
} from "../marketReadRepository";
import { PRODUCTS, type CatalogueProduct } from "@/lib/catalogue/products";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  MALAYSIA_CHILLI_PRODUCT_ID,
} from "../providers/baci/contract";

export const MI2A_OVERVIEW_VERSION = "mi2a-overview-v1" as const;

/** Every MDF product allowed on the Market Intelligence page. */
export function marketIntelligenceProducts(): CatalogueProduct[] {
  return PRODUCTS.filter((product) => product.active);
}

/** Resolves an incoming productId to a canonical catalogue entry. */
export function findMarketIntelligenceProduct(productId: string | undefined | null):
  | CatalogueProduct
  | undefined
{
  if (!productId) return undefined;
  return marketIntelligenceProducts().find((product) => product.id === productId);
}

/**
 * MI2A.1 product routing decision. Pure function.
 *
 *   * `undefined` (no ?product) → `default` → guntur-dry-red-chilli.
 *   * Valid approved catalogue product → `valid` → that product.
 *   * Any other explicit value → `invalid` → NO product; do NOT silently
 *     fall back to chilli, which would render chilli data under the
 *     invalid parameter and mislead the operator.
 */
export type MarketIntelligenceProductRouting =
  | { kind: "default"; product: CatalogueProduct | undefined; requestedProductId: null }
  | { kind: "valid"; product: CatalogueProduct; requestedProductId: string }
  | { kind: "invalid"; product: undefined; requestedProductId: string };

export function resolveMarketIntelligenceProductRouting(
  requestedProductId: string | undefined | null,
  defaultProductId = "guntur-dry-red-chilli",
): MarketIntelligenceProductRouting {
  if (requestedProductId === undefined || requestedProductId === null) {
    const product = findMarketIntelligenceProduct(defaultProductId) ?? marketIntelligenceProducts()[0];
    return { kind: "default", product, requestedProductId: null };
  }
  const valid = findMarketIntelligenceProduct(requestedProductId);
  if (valid) return { kind: "valid", product: valid, requestedProductId };
  return { kind: "invalid", product: undefined, requestedProductId };
}

export type MarketMappingKind = "exact" | "proxy" | "composite";
export type MarketRecommendationStatus = "actionable" | "indicative" | "insufficient_evidence";
export type MarketFitEligibility = "exact" | "proxy_allowed" | "insufficient_specificity";

export interface ComponentSummary {
  key:
    | "demand_size" | "demand_growth" | "india_position"
    | "competitive_opportunity" | "price_attractiveness" | "demand_stability";
  normalizedScore: number | null;
  weight: number;
  supported: boolean;
}

export interface CountryOverviewRow {
  countryAlpha2: string;
  countryName: string;
  currentScoreId: string;
  marketFit: number | null;
  dataConfidence: number | null;
  recommendationStatus: MarketRecommendationStatus;
  isTradeProxy: boolean;
  mappingKind: MarketMappingKind;
  fitEligibility: MarketFitEligibility;
  latestImportValueUsd: number | null;
  latestImportQuantityTonnes: number | null;
  indiaImportValueUsd: number | null;
  indiaShare: number | null;
  indiaRank: number | null;
  yoyPct: number | null;
  cagr3Pct: number | null;
  cagr5Pct: number | null;
  derivedUnitValueUsdPerKg: number | null;
  hhi: number | null;
  top1Share: number | null;
  top3Share: number | null;
  components: ComponentSummary[];
  calculatedAt: string;
}

export interface MarketIntelligenceOverview {
  version: typeof MI2A_OVERVIEW_VERSION;
  product: { id: string; displayName: string; shortName: string };
  productSupported: boolean;
  isTradeProxyOnly: boolean;
  hsRevision: string | null;
  hsCode: string | null;
  marketFitVersion: string;
  dataConfidenceVersion: string;
  totalMarkets: number;
  latestEvidenceYear: number | null;
  latestScoreCalculatedAt: string | null;
  markets: CountryOverviewRow[];
}

type BatchedMarketReadRepository = Pick<
  MarketReadRepository,
  "listCurrentMarketScoresForProduct" | "listBilateralAnnualObservationsForCountries"
>;

type BatchedObservations = Awaited<
  ReturnType<MarketReadRepository["listBilateralAnnualObservationsForCountries"]>
>;

interface LoadedMarketEvidence {
  product: CatalogueProduct;
  isChilli: boolean;
  scoresByCountry: Map<string, MarketReadRepositoryScore>;
  observationsByCountry: Map<string, BatchedObservations>;
}

async function loadMarketEvidence(
  product: CatalogueProduct,
  countryAlpha2s: readonly string[],
  repository: BatchedMarketReadRepository,
): Promise<LoadedMarketEvidence> {
  const isChilli = product.id === MALAYSIA_CHILLI_PRODUCT_ID;
  const scores = await repository.listCurrentMarketScoresForProduct(product.id, countryAlpha2s);
  const scoresByCountry = new Map<string, MarketReadRepositoryScore>();
  for (const score of scores) scoresByCountry.set(score.countryAlpha2, score);

  const observations = isChilli
    ? await repository.listBilateralAnnualObservationsForCountries(
        countryAlpha2s,
        "HS17",
        MALAYSIA_CHILLI_HS17_CODE,
        "baci_oec",
        BACI_OEC_DATASET_ID,
      )
    : [];
  const observationsByCountry = new Map<string, BatchedObservations>();
  for (const row of observations) {
    let bucket = observationsByCountry.get(row.reporterCountry);
    if (!bucket) {
      bucket = [];
      observationsByCountry.set(row.reporterCountry, bucket);
    }
    bucket.push(row);
  }

  return { product, isChilli, scoresByCountry, observationsByCountry };
}

function buildOverviewFromEvidence(
  evidence: LoadedMarketEvidence,
): MarketIntelligenceOverview {
  const rows: CountryOverviewRow[] = [];
  let latestEvidenceYear: number | null = null;
  let latestScoreCalculatedAt: string | null = null;

  for (const entry of calibrationCohort()) {
    const score = evidence.scoresByCountry.get(entry.countryAlpha2);
    if (!score) continue;
    const countryObservations = evidence.observationsByCountry.get(entry.countryAlpha2) ?? [];
    const analytics = summarizeCountryAnalytics(countryObservations);
    latestEvidenceYear = maxYear(latestEvidenceYear, analytics.latestYear);
    latestScoreCalculatedAt = maxIso(latestScoreCalculatedAt, score.calculatedAt);
    rows.push(toOverviewRow(entry.countryAlpha2, entry.displayName, score, analytics));
  }

  rows.sort(compareOverviewRows);

  return {
    version: MI2A_OVERVIEW_VERSION,
    product: {
      id: evidence.product.id,
      displayName: evidence.product.displayName,
      shortName: evidence.product.shortName,
    },
    productSupported: evidence.isChilli && rows.length > 0,
    isTradeProxyOnly: evidence.isChilli,
    hsRevision: evidence.isChilli ? "HS17" : null,
    hsCode: evidence.isChilli ? MALAYSIA_CHILLI_HS17_CODE : null,
    marketFitVersion: MARKET_FIT_VERSION,
    dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
    totalMarkets: rows.length,
    latestEvidenceYear,
    latestScoreCalculatedAt,
    markets: rows,
  };
}

/**
 * Read the current persisted overview for a product. Every row is a
 * `market_product_scores` CURRENT row; nothing is fabricated. Rows are
 * sorted deterministically by Market Fit desc, Data Confidence desc,
 * country name asc, alpha-2 asc.
 *
 * Read path (MI2A.1): bounded and batched — three total repository
 * calls regardless of cohort size:
 *   1) `listCurrentMarketScoresForProduct(productId, cohortCountries)` — 2 DB queries
 *      (scores IN + components IN).
 *   2) `listBilateralAnnualObservationsForCountries(cohortCountries, HS17, 090421, baci_oec, baci-hs17)` — 1 paginated DB query.
 *   Total: 3 DB queries. Never 18 × getCurrentMarketScore.
 */
export async function getMarketIntelligenceOverview(
  productId: string,
  repository: BatchedMarketReadRepository,
): Promise<MarketIntelligenceOverview | undefined> {
  const product = findMarketIntelligenceProduct(productId);
  if (!product) return undefined;
  const countryAlpha2s = calibrationCohort().map((entry) => entry.countryAlpha2);
  return buildOverviewFromEvidence(
    await loadMarketEvidence(product, countryAlpha2s, repository),
  );
}

// ---------------------------------------------------------------------------
// Deterministic sort
// ---------------------------------------------------------------------------

export function compareOverviewRows(a: CountryOverviewRow, b: CountryOverviewRow): number {
  const fitDelta = (b.marketFit ?? -1) - (a.marketFit ?? -1);
  if (fitDelta !== 0) return fitDelta;
  const confDelta = (b.dataConfidence ?? -1) - (a.dataConfidence ?? -1);
  if (confDelta !== 0) return confDelta;
  const nameDelta = a.countryName.localeCompare(b.countryName);
  if (nameDelta !== 0) return nameDelta;
  return a.countryAlpha2.localeCompare(b.countryAlpha2);
}

// ---------------------------------------------------------------------------
// Persisted-row → overview projection
// ---------------------------------------------------------------------------

interface CountryAnalytics {
  latestYear: number | null;
  latestImportValueUsd: number | null;
  latestImportQuantityTonnes: number | null;
  indiaImportValueUsd: number | null;
  indiaShare: number | null;
  indiaRank: number | null;
  yoyPct: number | null;
  cagr3Pct: number | null;
  cagr5Pct: number | null;
  derivedUnitValueUsdPerKg: number | null;
  hhi: number | null;
  top1Share: number | null;
  top3Share: number | null;
  originsLatestYear: Array<{ partnerCountry: string; valueUsd: number }>;
}

function toKg(row: { quantity: number | null; quantityUnit: string | null }): number | null {
  if (row.quantity === null) return null;
  if (row.quantityUnit === "tonne") return row.quantity * 1000;
  if (row.quantityUnit === "kg") return row.quantity;
  return null;
}

export function summarizeCountryAnalytics(
  observations: readonly {
    partnerCountry: string | null;
    period: string;
    tradeValueUsd: number | null;
    quantity: number | null;
    quantityUnit: string | null;
  }[],
): CountryAnalytics {
  const byYear = new Map<number, {
    totalUsd: number;
    totalKg: number;
    hasQuantity: boolean;
    origins: Map<string, number>;
  }>();
  for (const row of observations) {
    if (row.partnerCountry === null) continue;
    const year = Number(row.period);
    if (!Number.isInteger(year)) continue;
    let bucket = byYear.get(year);
    if (!bucket) {
      bucket = { totalUsd: 0, totalKg: 0, hasQuantity: false, origins: new Map() };
      byYear.set(year, bucket);
    }
    if (typeof row.tradeValueUsd === "number" && row.tradeValueUsd >= 0) {
      bucket.totalUsd += row.tradeValueUsd;
      bucket.origins.set(
        row.partnerCountry,
        (bucket.origins.get(row.partnerCountry) ?? 0) + row.tradeValueUsd,
      );
    }
    const kg = toKg(row);
    if (kg !== null) {
      bucket.totalKg += kg;
      bucket.hasQuantity = true;
    }
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const latestYear = years.length > 0 ? years[years.length - 1]! : null;
  const latest = latestYear !== null ? byYear.get(latestYear)! : undefined;
  const latestImportValueUsd = latest ? latest.totalUsd : null;
  const latestQuantityKg = latest && latest.hasQuantity ? latest.totalKg : null;
  const latestImportQuantityTonnes = latestQuantityKg !== null ? latestQuantityKg / 1000 : null;
  const derivedUnitValueUsdPerKg =
    latestImportValueUsd !== null && latestQuantityKg && latestQuantityKg > 0
      ? latestImportValueUsd / latestQuantityKg
      : null;
  const originsRanked = latest
    ? [...latest.origins.entries()].sort(([, a], [, b]) => b - a)
    : [];
  const indiaValue = latest ? latest.origins.get("IN") ?? null : null;
  const indiaShare =
    latestImportValueUsd && latestImportValueUsd > 0 && indiaValue !== null
      ? indiaValue / latestImportValueUsd
      : null;
  const indiaRank = latest
    ? (() => {
        const idx = originsRanked.findIndex(([code]) => code === "IN");
        return idx >= 0 ? idx + 1 : null;
      })()
    : null;
  const top1Share =
    latest && originsRanked.length > 0 && latestImportValueUsd && latestImportValueUsd > 0
      ? originsRanked[0]![1] / latestImportValueUsd
      : null;
  const top3Share =
    latest && originsRanked.length > 0 && latestImportValueUsd && latestImportValueUsd > 0
      ? originsRanked.slice(0, 3).reduce((s, [, v]) => s + v, 0) / latestImportValueUsd
      : null;
  const hhi =
    latest && latestImportValueUsd && latestImportValueUsd > 0
      ? [...latest.origins.values()].reduce((s, v) => s + (v / latestImportValueUsd) ** 2, 0)
      : null;
  const totalsByYear = new Map(years.map((y) => [y, byYear.get(y)!.totalUsd]));
  const yoyPct =
    latestYear !== null && totalsByYear.has(latestYear - 1)
      ? (() => {
          const prev = totalsByYear.get(latestYear - 1)!;
          const curr = totalsByYear.get(latestYear)!;
          return prev > 0 ? ((curr - prev) / prev) * 100 : null;
        })()
      : null;
  const cagrN = (n: number): number | null => {
    if (latestYear === null || !totalsByYear.has(latestYear - n)) return null;
    const start = totalsByYear.get(latestYear - n)!;
    const end = totalsByYear.get(latestYear)!;
    if (!(start > 0) || !(end > 0)) return null;
    return ((end / start) ** (1 / n) - 1) * 100;
  };
  const cagr3Pct = cagrN(3);
  const cagr5Pct = cagrN(5);

  return {
    latestYear,
    latestImportValueUsd,
    latestImportQuantityTonnes,
    indiaImportValueUsd: indiaValue,
    indiaShare,
    indiaRank,
    yoyPct,
    cagr3Pct,
    cagr5Pct,
    derivedUnitValueUsdPerKg,
    hhi,
    top1Share,
    top3Share,
    originsLatestYear: originsRanked.map(([partnerCountry, valueUsd]) => ({ partnerCountry, valueUsd })),
  };
}

function componentSummary(component: MarketReadRepositoryScoreComponent): ComponentSummary {
  return {
    key: component.componentKey as ComponentSummary["key"],
    normalizedScore: component.normalizedScore,
    weight: component.weight,
    supported: component.supported,
  };
}

function toOverviewRow(
  countryAlpha2: string,
  displayNameFromCohort: string,
  score: MarketReadRepositoryScore,
  analytics: CountryAnalytics,
): CountryOverviewRow {
  return {
    countryAlpha2,
    countryName: countryDisplayName(countryAlpha2) ?? displayNameFromCohort,
    currentScoreId: score.id,
    marketFit: score.publishedFitScore,
    dataConfidence: score.dataConfidenceScore,
    recommendationStatus: score.recommendationStatus,
    isTradeProxy: score.isTradeProxy,
    mappingKind: score.mappingKind,
    fitEligibility: score.fitEligibility,
    latestImportValueUsd: analytics.latestImportValueUsd,
    latestImportQuantityTonnes: analytics.latestImportQuantityTonnes,
    indiaImportValueUsd: analytics.indiaImportValueUsd,
    indiaShare: analytics.indiaShare,
    indiaRank: analytics.indiaRank,
    yoyPct: analytics.yoyPct,
    cagr3Pct: analytics.cagr3Pct,
    cagr5Pct: analytics.cagr5Pct,
    derivedUnitValueUsdPerKg: analytics.derivedUnitValueUsdPerKg,
    hhi: analytics.hhi,
    top1Share: analytics.top1Share,
    top3Share: analytics.top3Share,
    components: [...score.components].map(componentSummary),
    calculatedAt: score.calculatedAt,
  };
}

function maxYear(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// ---------------------------------------------------------------------------
// Detail read model
// ---------------------------------------------------------------------------

export interface AnnualImportPoint {
  period: string;
  totalUsd: number | null;
  totalTonnes: number | null;
  indiaValueUsd: number | null;
  indiaShare: number | null;
}

export interface OriginRankRow {
  partnerCountry: string;
  partnerCountryName: string | null;
  valueUsd: number;
  share: number | null;
}

export interface MarketIntelligenceDetail {
  version: typeof MI2A_OVERVIEW_VERSION;
  product: { id: string; displayName: string; shortName: string };
  country: { alpha2: string; name: string };
  hsRevision: string | null;
  hsCode: string | null;
  isTradeProxy: boolean;
  overview: CountryOverviewRow;
  history: AnnualImportPoint[];
  originsLatestYear: OriginRankRow[];
  latestPeriod: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  provenance: {
    providerId: string | null;
    datasetId: string | null;
    hsRevision: string | null;
    hsCode: string | null;
    mappingKind: MarketMappingKind;
    mappingConfidence: number;
    fitEligibility: MarketFitEligibility;
    hasEvidenceWatermark: boolean;
    hasMappingWatermark: boolean;
  };
}

function buildDetailFromEvidence(
  product: CatalogueProduct,
  country: string,
  score: MarketReadRepositoryScore,
  observations: BatchedObservations,
): MarketIntelligenceDetail {
  const isChilli = product.id === MALAYSIA_CHILLI_PRODUCT_ID;
  const analytics = summarizeCountryAnalytics(observations);

  const byYear = new Map<number, { total: number; india: number; tonnes: number; hasQuantity: boolean }>();
  for (const row of observations) {
    if (row.partnerCountry === null) continue;
    const year = Number(row.period);
    if (!Number.isInteger(year)) continue;
    let b = byYear.get(year);
    if (!b) {
      b = { total: 0, india: 0, tonnes: 0, hasQuantity: false };
      byYear.set(year, b);
    }
    if (typeof row.tradeValueUsd === "number" && row.tradeValueUsd >= 0) {
      b.total += row.tradeValueUsd;
      if (row.partnerCountry === "IN") b.india += row.tradeValueUsd;
    }
    const kg = toKg(row);
    if (kg !== null) {
      b.tonnes += kg / 1000;
      b.hasQuantity = true;
    }
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const history: AnnualImportPoint[] = years.map((year) => {
    const b = byYear.get(year)!;
    return {
      period: String(year),
      totalUsd: b.total,
      totalTonnes: b.hasQuantity ? b.tonnes : null,
      indiaValueUsd: b.india,
      indiaShare: b.total > 0 ? b.india / b.total : null,
    };
  });

  const originsLatestYear: OriginRankRow[] = analytics.originsLatestYear.map((row) => ({
    partnerCountry: row.partnerCountry,
    partnerCountryName: countryDisplayName(row.partnerCountry) ?? null,
    valueUsd: row.valueUsd,
    share:
      analytics.latestImportValueUsd && analytics.latestImportValueUsd > 0
        ? row.valueUsd / analytics.latestImportValueUsd
        : null,
  }));

  const overview = toOverviewRow(
    country,
    countryDisplayName(country) ?? country,
    score,
    analytics,
  );
  const evidenceWatermark = score.sourceCoverage.evidence_watermark;
  const mappingWatermark = score.sourceCoverage.mapping_watermark;

  return {
    version: MI2A_OVERVIEW_VERSION,
    product: { id: product.id, displayName: product.displayName, shortName: product.shortName },
    country: { alpha2: country, name: countryDisplayName(country) ?? country },
    hsRevision: isChilli ? "HS17" : null,
    hsCode: isChilli ? MALAYSIA_CHILLI_HS17_CODE : null,
    isTradeProxy: score.isTradeProxy,
    overview,
    history,
    originsLatestYear,
    latestPeriod: analytics.latestYear === null ? null : String(analytics.latestYear),
    coverageStart: years.length > 0 ? String(years[0]!) : null,
    coverageEnd: analytics.latestYear === null ? null : String(analytics.latestYear),
    provenance: {
      providerId: isChilli ? "baci_oec" : null,
      datasetId: isChilli ? BACI_OEC_DATASET_ID : null,
      hsRevision: isChilli ? "HS17" : null,
      hsCode: isChilli ? MALAYSIA_CHILLI_HS17_CODE : null,
      mappingKind: score.mappingKind,
      mappingConfidence: score.mappingConfidence,
      fitEligibility: score.fitEligibility,
      hasEvidenceWatermark: typeof evidenceWatermark === "string" && evidenceWatermark.length > 0,
      hasMappingWatermark: typeof mappingWatermark === "string" && mappingWatermark.length > 0,
    },
  };
}

export async function getMarketIntelligenceDetail(
  productId: string,
  countryAlpha2: string,
  repository: Pick<MarketReadRepository, "getCurrentMarketScore" | "listBilateralAnnualObservations">,
): Promise<MarketIntelligenceDetail | undefined> {
  const product = findMarketIntelligenceProduct(productId);
  if (!product) return undefined;
  const country = countryAlpha2?.toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) return undefined;

  const score = await repository.getCurrentMarketScore(country, product.id);
  if (!score) return undefined;

  const isChilli = product.id === MALAYSIA_CHILLI_PRODUCT_ID;
  const observations = isChilli
    ? await repository.listBilateralAnnualObservations(
        country, "HS17", MALAYSIA_CHILLI_HS17_CODE, "baci_oec", BACI_OEC_DATASET_ID,
      )
    : [];
  return buildDetailFromEvidence(product, country, score, observations);
}

// ---------------------------------------------------------------------------
// Comparison and page workspace read models
// ---------------------------------------------------------------------------

export const MARKET_COMPARISON_LIMIT = 4;

export interface MarketIntelligenceComparison {
  product: { id: string; displayName: string; shortName: string };
  marketFitVersion: string;
  dataConfidenceVersion: string;
  countryAlpha2s: string[];
  countries: MarketIntelligenceDetail[];
}

export interface MarketIntelligenceWorkspace {
  overview: MarketIntelligenceOverview;
  selectedDetail: MarketIntelligenceDetail | undefined;
  comparison: MarketIntelligenceComparison;
}

/**
 * Parses comparison state as canonical alpha-2 values, removes duplicates and
 * invalid values, orders by the supplied canonical registry, and caps at four.
 */
export function canonicalizeComparisonCountries(
  input: string | readonly string[] | undefined | null,
  canonicalCountryOrder: readonly string[],
): string[] {
  const inputValues: readonly string[] = typeof input === "string"
    ? input.split(",")
    : (input ?? []);
  const requested = inputValues
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));
  const requestedSet = new Set(requested);
  return canonicalCountryOrder
    .map((value) => value.toUpperCase())
    .filter((value, index, all) => all.indexOf(value) === index && requestedSet.has(value))
    .slice(0, MARKET_COMPARISON_LIMIT);
}

function buildComparisonFromEvidence(
  evidence: LoadedMarketEvidence,
  countryAlpha2s: readonly string[],
): MarketIntelligenceComparison {
  const countries: MarketIntelligenceDetail[] = [];
  for (const country of countryAlpha2s) {
    const score = evidence.scoresByCountry.get(country);
    if (!score) continue;
    countries.push(
      buildDetailFromEvidence(
        evidence.product,
        country,
        score,
        evidence.observationsByCountry.get(country) ?? [],
      ),
    );
  }
  return {
    product: {
      id: evidence.product.id,
      displayName: evidence.product.displayName,
      shortName: evidence.product.shortName,
    },
    marketFitVersion: MARKET_FIT_VERSION,
    dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
    countryAlpha2s: countries.map((country) => country.country.alpha2),
    countries,
  };
}

/**
 * Standalone MI3 comparison reader. It performs one batched score read
 * (repository-internal score + component queries) and one batched observation
 * read, then groups every country in memory.
 */
export async function getMarketIntelligenceComparison(
  productId: string,
  countryAlpha2s: readonly string[],
  repository: BatchedMarketReadRepository,
): Promise<MarketIntelligenceComparison | undefined> {
  const product = findMarketIntelligenceProduct(productId);
  if (!product) return undefined;
  const canonicalRegistry = calibrationCohort()
    .map((entry) => entry.countryAlpha2)
    .sort((a, b) => a.localeCompare(b));
  const countries = canonicalizeComparisonCountries(countryAlpha2s, canonicalRegistry);
  if (countries.length === 0) {
    return {
      product: { id: product.id, displayName: product.displayName, shortName: product.shortName },
      marketFitVersion: MARKET_FIT_VERSION,
      dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
      countryAlpha2s: [],
      countries: [],
    };
  }
  const evidence = await loadMarketEvidence(product, countries, repository);
  return buildComparisonFromEvidence(evidence, countries);
}

/**
 * The page-level reader shares the overview evidence batch with the focused
 * country and comparison views. Its database query count is constant as the
 * comparison grows from zero to four countries.
 */
export async function getMarketIntelligenceWorkspace(
  productId: string,
  requestedDetailCountry: string | undefined | null,
  requestedComparison: string | readonly string[] | undefined | null,
  repository: BatchedMarketReadRepository,
): Promise<MarketIntelligenceWorkspace | undefined> {
  const product = findMarketIntelligenceProduct(productId);
  if (!product) return undefined;
  const cohortCountries = calibrationCohort().map((entry) => entry.countryAlpha2);
  const evidence = await loadMarketEvidence(product, cohortCountries, repository);
  const overview = buildOverviewFromEvidence(evidence);
  const canonicalCountryOrder = overview.markets.map((market) => market.countryAlpha2);
  const requestedCountry = requestedDetailCountry?.trim().toUpperCase();
  const detailCountry = requestedCountry && canonicalCountryOrder.includes(requestedCountry)
    ? requestedCountry
    : canonicalCountryOrder[0];
  const detailScore = detailCountry ? evidence.scoresByCountry.get(detailCountry) : undefined;
  const selectedDetail = detailCountry && detailScore
    ? buildDetailFromEvidence(
        product,
        detailCountry,
        detailScore,
        evidence.observationsByCountry.get(detailCountry) ?? [],
      )
    : undefined;
  const comparisonCountries = canonicalizeComparisonCountries(
    requestedComparison,
    canonicalCountryOrder,
  );
  return {
    overview,
    selectedDetail,
    comparison: buildComparisonFromEvidence(evidence, comparisonCountries),
  };
}
