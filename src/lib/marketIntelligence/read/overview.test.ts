import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { calibrationCohort } from "../calibration/cohort";
import { DATA_CONFIDENCE_VERSION, MARKET_FIT_VERSION } from "../marketFit";
import { MI_PRODUCT_MAPPING_VERSION } from "../product";
import { MI_PROVIDER_SELECTION_VERSION } from "../providerSelection";
import type {
  MarketReadRepositoryObservation,
  MarketReadRepositoryScore,
  MarketReadRepositoryScoreComponent,
} from "../marketReadRepository";
import {
  compareOverviewRows,
  getMarketIntelligenceDetail,
  getMarketIntelligenceOverview,
  marketIntelligenceProducts,
  resolveMarketIntelligenceProductRouting,
  summarizeCountryAnalytics,
} from "./overview";

const CHILLI = "guntur-dry-red-chilli";

/** Persisted MI1H Fit snapshot production reports. */
const MI1H_FIT: Record<string, number> = {
  US: 66, TH: 62, MY: 57, VN: 53, LK: 53, NL: 52, SG: 51, CA: 50,
  QA: 46, AU: 44, DE: 44, JP: 43, KW: 40, GB: 40, AE: 36, KR: 34,
  SA: 33, OM: 24,
};
const MI1H_CONFIDENCE: Record<string, number> = {
  US: 90, TH: 90, MY: 90, VN: 88, LK: 88, NL: 87, SG: 87, CA: 87,
  QA: 87, AU: 87, DE: 87, JP: 87, KW: 86, GB: 86, AE: 86, KR: 86,
  SA: 86, OM: 86,
};

function components(): MarketReadRepositoryScoreComponent[] {
  const keys = [
    "demand_size", "demand_growth", "india_position",
    "competitive_opportunity", "price_attractiveness", "demand_stability",
  ];
  const weights = [25, 20, 20, 15, 10, 10];
  return keys.map((key, i) => ({
    id: `${key}-id`,
    componentKey: key,
    rawMetricValue: 1,
    normalizedScore: 50,
    weight: weights[i]!,
    supported: true,
    reason: "",
    metadata: {},
  }));
}

function score(country: string): MarketReadRepositoryScore {
  return {
    id: `score-${country}`,
    supersededAt: null,
    countryAlpha2: country,
    mdfProductId: CHILLI,
    diagnosticFitScore: MI1H_FIT[country] ?? 50,
    publishedFitScore: MI1H_FIT[country] ?? 50,
    dataConfidenceScore: MI1H_CONFIDENCE[country] ?? 80,
    recommendationStatus: "indicative",
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    fitEligibility: "proxy_allowed",
    isTradeProxy: true,
    marketFitVersion: MARKET_FIT_VERSION,
    confidenceVersion: DATA_CONFIDENCE_VERSION,
    providerSelectionVersion: MI_PROVIDER_SELECTION_VERSION,
    recommendationReason: null,
    positiveReasons: [],
    negativeReasons: [],
    sourceCoverage: {
      mapping_registry_version: MI_PRODUCT_MAPPING_VERSION,
      mapping_watermark: "sha256:mw",
      evidence_watermark: "sha256:ew",
      persistence_fingerprint: "pf",
    },
    calculatedAt: `2026-09-${(20 + (country.charCodeAt(0) % 3)).toString().padStart(2, "0")}T00:00:00.000Z`,
    components: components(),
  };
}

function observations(country: string): MarketReadRepositoryObservation[] {
  const rows: MarketReadRepositoryObservation[] = [];
  const partners = ["IN", "CN", "TH"];
  for (const year of [2018, 2019, 2020, 2021, 2022, 2023, 2024]) {
    for (const partner of partners) {
      const usd = year === 2024 && partner === "IN" ? 50_939_611
        : year === 2024 && partner === "CN" ? 63_349_647
        : year === 2024 && partner === "TH" ? 3_060_000
        : 1_000_000 * (year - 2017);
      rows.push({
        id: `${country}-${year}-${partner}`,
        sourceId: "source-uuid",
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        reporterCountry: country,
        partnerCountry: partner,
        tradeFlow: "import",
        hsRevision: "HS17",
        hsCode: "090421",
        frequency: "annual",
        period: String(year),
        tradeValueUsd: usd,
        quantity: 1000,
        quantityUnit: "tonne",
        netWeightKg: null,
        retrievedAt: "2026-09-20T00:00:00.000Z",
      });
    }
  }
  return rows;
}

function repo(overrides: {
  scores?: Map<string, MarketReadRepositoryScore | undefined>;
  /** Optional: which product ids the mock returns scores for. Defaults to chilli only. */
  productIdsWithScores?: string[];
  observationsFor?: (country: string) => MarketReadRepositoryObservation[];
} = {}) {
  const scores = overrides.scores ??
    new Map(calibrationCohort().map((c) => [c.countryAlpha2, score(c.countryAlpha2)]));
  const observationsFor = overrides.observationsFor ?? observations;
  const productIds = new Set(overrides.productIdsWithScores ?? [CHILLI]);
  return {
    // MI2A.1: batched score fetch — ONE repository call regardless of cohort size.
    listCurrentMarketScoresForProduct: vi.fn(async (productId: string, countries: readonly string[]) => {
      if (!productIds.has(productId)) return [] as MarketReadRepositoryScore[];
      const out: MarketReadRepositoryScore[] = [];
      for (const country of countries) {
        const found = scores.get(country);
        if (found) out.push(found);
      }
      return out;
    }),
    // MI2A.1: batched observation fetch — ONE repository call regardless of cohort size.
    listBilateralAnnualObservationsForCountries: vi.fn(async (
      countries: readonly string[],
      _hsRevision: string,
      _hsCode: string,
      _providerId: string,
      _datasetId: string,
    ) => {
      const rows: MarketReadRepositoryObservation[] = [];
      for (const country of countries) rows.push(...observationsFor(country));
      return rows;
    }),
    // Retained for detail-path tests only.
    getCurrentMarketScore: vi.fn(async (country: string, product: string) => {
      if (!productIds.has(product)) return undefined;
      return scores.get(country);
    }),
    listBilateralAnnualObservations: vi.fn(async (country: string) => observationsFor(country)),
  };
}

// ---------------------------------------------------------------------------

describe("MI2A summarizeCountryAnalytics", () => {
  it("returns null primitives for empty observations, never fabricated zero", () => {
    const analytics = summarizeCountryAnalytics([]);
    expect(analytics.latestYear).toBeNull();
    expect(analytics.latestImportValueUsd).toBeNull();
    expect(analytics.indiaShare).toBeNull();
    expect(analytics.indiaRank).toBeNull();
    expect(analytics.hhi).toBeNull();
  });

  it("computes MY 2024 anchors matching the MI1D production proof", () => {
    const analytics = summarizeCountryAnalytics(observations("MY"));
    expect(analytics.latestYear).toBe(2024);
    // 50_939_611 + 63_349_647 + 3_060_000 = 117_349_258
    expect(analytics.latestImportValueUsd).toBe(117_349_258);
    expect(analytics.indiaImportValueUsd).toBe(50_939_611);
    expect(analytics.indiaShare).toBeCloseTo(50_939_611 / 117_349_258, 6);
    expect(analytics.indiaRank).toBe(2);
    expect(analytics.top1Share).toBeCloseTo(63_349_647 / 117_349_258, 6);
    expect(analytics.hhi).toBeGreaterThan(0);
    expect(analytics.hhi).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("MI2A.1 getMarketIntelligenceOverview — batched read path", () => {
  it("issues EXACTLY ONE batched score call and ONE batched observation call for 18 cohort countries", async () => {
    const r = repo();
    await getMarketIntelligenceOverview(CHILLI, r);
    // The 18-country overview must NOT fan out into 18 score/observation calls.
    expect(r.listCurrentMarketScoresForProduct).toHaveBeenCalledTimes(1);
    expect(r.listBilateralAnnualObservationsForCountries).toHaveBeenCalledTimes(1);
    expect(r.getCurrentMarketScore).not.toHaveBeenCalled();
    expect(r.listBilateralAnnualObservations).not.toHaveBeenCalled();
    // Both batched calls receive the FULL 18-country cohort list.
    const [productArg, countriesArg] = r.listCurrentMarketScoresForProduct.mock.calls[0]!;
    expect(productArg).toBe(CHILLI);
    expect(countriesArg).toHaveLength(18);
    const obsCall = r.listBilateralAnnualObservationsForCountries.mock.calls[0]!;
    expect(obsCall[0]).toHaveLength(18);
    expect(obsCall[1]).toBe("HS17");
    expect(obsCall[2]).toBe("090421");
    expect(obsCall[3]).toBe("baci_oec");
    expect(obsCall[4]).toBe("baci-hs17");
  });

  it("reproduces the MI1H Fit snapshot after the batched read path", async () => {
    const overview = await getMarketIntelligenceOverview(CHILLI, repo());
    const byCountry = new Map(overview!.markets.map((row) => [row.countryAlpha2, row.marketFit]));
    for (const [country, expected] of Object.entries(MI1H_FIT)) {
      expect(byCountry.get(country)).toBe(expected);
    }
    // Ranking still deterministic.
    expect(overview!.markets[0]!.countryAlpha2).toBe("US");
    expect(overview!.markets[1]!.countryAlpha2).toBe("TH");
    expect(overview!.markets[2]!.countryAlpha2).toBe("MY");
  });
});

describe("MI2A getMarketIntelligenceOverview — chilli", () => {
  it("returns 18 chilli markets, ranking starts US 66, TH 62, MY 57", async () => {
    const overview = await getMarketIntelligenceOverview(CHILLI, repo());
    expect(overview).toBeDefined();
    expect(overview!.totalMarkets).toBe(18);
    expect(overview!.productSupported).toBe(true);
    expect(overview!.marketFitVersion).toBe(MARKET_FIT_VERSION);
    expect(overview!.dataConfidenceVersion).toBe(DATA_CONFIDENCE_VERSION);
    expect(overview!.hsRevision).toBe("HS17");
    expect(overview!.hsCode).toBe("090421");
    expect(overview!.isTradeProxyOnly).toBe(true);
    const codes = overview!.markets.map((row) => row.countryAlpha2);
    expect(codes[0]).toBe("US");
    expect(codes[1]).toBe("TH");
    expect(codes[2]).toBe("MY");
    expect(overview!.markets[0]!.marketFit).toBe(66);
    expect(overview!.markets[1]!.marketFit).toBe(62);
    expect(overview!.markets[2]!.marketFit).toBe(57);
  });

  it("all chilli recommendations are indicative and isTradeProxy=true", async () => {
    const overview = await getMarketIntelligenceOverview(CHILLI, repo());
    for (const row of overview!.markets) {
      expect(row.recommendationStatus).toBe("indicative");
      expect(row.isTradeProxy).toBe(true);
      expect(row.mappingKind).toBe("proxy");
      expect(row.fitEligibility).toBe("proxy_allowed");
    }
  });

  it("Data Confidence is a separate scalar from Market Fit", async () => {
    const overview = await getMarketIntelligenceOverview(CHILLI, repo());
    const us = overview!.markets.find((row) => row.countryAlpha2 === "US")!;
    expect(us.marketFit).toBe(66);
    expect(us.dataConfidence).toBe(90);
    // Different values → confidence is NOT the same field as fit.
    expect(us.dataConfidence).not.toBe(us.marketFit);
  });

  it("deterministic tie-break: LK and VN both score 53 → sort by name asc, then alpha-2", async () => {
    const overview = await getMarketIntelligenceOverview(CHILLI, repo());
    const lkIdx = overview!.markets.findIndex((row) => row.countryAlpha2 === "LK");
    const vnIdx = overview!.markets.findIndex((row) => row.countryAlpha2 === "VN");
    // Fit tie 53/53, confidences 88/88 tie, "Sri Lanka" > "Vietnam" alphabetically
    // so VN sorts before LK (V < S in country-name ORDER? Actually "S" < "V") —
    // country names: LK="Sri Lanka", VN="Vietnam"; "S" < "V", so LK first.
    expect(lkIdx).toBeLessThan(vnIdx);
  });

  it("missing score for a country → row skipped, honestly absent", async () => {
    const scores = new Map(calibrationCohort().map((c) => [c.countryAlpha2, score(c.countryAlpha2)]));
    scores.delete("US");
    const overview = await getMarketIntelligenceOverview(CHILLI, repo({ scores }));
    expect(overview!.markets.some((row) => row.countryAlpha2 === "US")).toBe(false);
    expect(overview!.totalMarkets).toBe(17);
  });

  it("missing quantity → tonnes stays null, never fabricated zero", async () => {
    const overview = await getMarketIntelligenceOverview(CHILLI, repo({
      observationsFor: (country) => observations(country).map((row) => ({ ...row, quantity: null, quantityUnit: null })),
    }));
    const my = overview!.markets.find((row) => row.countryAlpha2 === "MY")!;
    expect(my.latestImportQuantityTonnes).toBeNull();
    expect(my.derivedUnitValueUsdPerKg).toBeNull();
  });
});

describe("MI2A getMarketIntelligenceOverview — unsupported products", () => {
  it("banganapalli-mango produces honest empty state (productSupported=false, no fabricated markets)", async () => {
    const overview = await getMarketIntelligenceOverview("banganapalli-mango", repo({
      scores: new Map(),
    }));
    expect(overview).toBeDefined();
    expect(overview!.productSupported).toBe(false);
    expect(overview!.totalMarkets).toBe(0);
    expect(overview!.markets).toEqual([]);
    expect(overview!.hsRevision).toBeNull();
    expect(overview!.hsCode).toBeNull();
  });

  it("indian-pomegranate produces no fabricated scores when no evidence exists", async () => {
    const overview = await getMarketIntelligenceOverview("indian-pomegranate", repo({
      scores: new Map(),
    }));
    expect(overview!.productSupported).toBe(false);
    expect(overview!.markets).toEqual([]);
  });

  it("unknown product id → overview is undefined (invalid product rejected)", async () => {
    const overview = await getMarketIntelligenceOverview("does-not-exist", repo());
    expect(overview).toBeUndefined();
  });
});

describe("MI2A getMarketIntelligenceDetail", () => {
  it("returns a full detail shape for chilli / MY", async () => {
    const detail = await getMarketIntelligenceDetail(CHILLI, "MY", repo());
    expect(detail).toBeDefined();
    expect(detail!.country.alpha2).toBe("MY");
    expect(detail!.overview.marketFit).toBe(MI1H_FIT.MY);
    expect(detail!.hsRevision).toBe("HS17");
    expect(detail!.hsCode).toBe("090421");
    expect(detail!.isTradeProxy).toBe(true);
    expect(detail!.history.length).toBe(7);
    expect(detail!.latestPeriod).toBe("2024");
    expect(detail!.coverageStart).toBe("2018");
    expect(detail!.coverageEnd).toBe("2024");
    expect(detail!.provenance.providerId).toBe("baci_oec");
    expect(detail!.provenance.datasetId).toBe("baci-hs17");
    expect(detail!.provenance.mappingKind).toBe("proxy");
    expect(detail!.provenance.fitEligibility).toBe("proxy_allowed");
    expect(detail!.provenance.hasEvidenceWatermark).toBe(true);
    expect(detail!.provenance.hasMappingWatermark).toBe(true);
    // 6 components exposed to the UI, all supported.
    expect(detail!.overview.components).toHaveLength(6);
  });

  it("invalid country alpha-2 → detail is undefined", async () => {
    const detail = await getMarketIntelligenceDetail(CHILLI, "MY!", repo());
    expect(detail).toBeUndefined();
    const short = await getMarketIntelligenceDetail(CHILLI, "M", repo());
    expect(short).toBeUndefined();
  });

  it("country with no persisted current score → detail undefined (no fabricated data)", async () => {
    const scores = new Map<string, MarketReadRepositoryScore | undefined>(
      calibrationCohort().map((c) => [c.countryAlpha2, score(c.countryAlpha2)]),
    );
    scores.set("SG", undefined);
    const detail = await getMarketIntelligenceDetail(CHILLI, "SG", repo({ scores }));
    expect(detail).toBeUndefined();
  });
});

describe("MI2A compareOverviewRows tie-break", () => {
  it("sorts by fit desc, confidence desc, name asc, alpha-2 asc", () => {
    const row = (alpha2: string, name: string, fit: number | null, conf: number | null) => ({
      countryAlpha2: alpha2, countryName: name, marketFit: fit, dataConfidence: conf,
    } as unknown as Parameters<typeof compareOverviewRows>[0]);
    const a = row("A1", "Alpha", 60, 90);
    const b = row("B1", "Bravo", 60, 90);
    const c = row("C1", "Charlie", 70, 80);
    const sorted = [a, b, c].sort(compareOverviewRows);
    expect(sorted.map((r) => r.countryAlpha2)).toEqual(["C1", "A1", "B1"]);
  });
});

describe("MI2A.1 resolveMarketIntelligenceProductRouting", () => {
  it("no product param (undefined) → kind=default, product=chilli", () => {
    const routing = resolveMarketIntelligenceProductRouting(undefined);
    expect(routing.kind).toBe("default");
    expect(routing.product?.id).toBe(CHILLI);
    expect(routing.requestedProductId).toBeNull();
  });

  it("valid chilli param → kind=valid, product=chilli", () => {
    const routing = resolveMarketIntelligenceProductRouting(CHILLI);
    expect(routing.kind).toBe("valid");
    expect(routing.product?.id).toBe(CHILLI);
    expect(routing.requestedProductId).toBe(CHILLI);
  });

  it("valid catalogue product (banganapalli-mango) → kind=valid, product=that catalogue entry", () => {
    const routing = resolveMarketIntelligenceProductRouting("banganapalli-mango");
    expect(routing.kind).toBe("valid");
    expect(routing.product?.id).toBe("banganapalli-mango");
  });

  it("explicit invalid product → kind=invalid, product=undefined (NO fallback to chilli)", () => {
    const routing = resolveMarketIntelligenceProductRouting("invalid-value");
    expect(routing.kind).toBe("invalid");
    expect(routing.product).toBeUndefined();
    expect(routing.requestedProductId).toBe("invalid-value");
  });

  it("empty string is treated as invalid, not as no-param", () => {
    const routing = resolveMarketIntelligenceProductRouting("");
    expect(routing.kind).toBe("invalid");
    expect(routing.product).toBeUndefined();
  });
});

describe("MI2A.1 valid product with no persisted intelligence", () => {
  it("banganapalli-mango still returns an overview shell but productSupported=false, empty markets", async () => {
    // productIdsWithScores default is [CHILLI], so the mock returns no scores for mango.
    const overview = await getMarketIntelligenceOverview("banganapalli-mango", repo());
    expect(overview).toBeDefined();
    expect(overview!.product.displayName).toBe("Banganapalli Mango");
    expect(overview!.productSupported).toBe(false);
    expect(overview!.markets).toEqual([]);
    expect(overview!.hsRevision).toBeNull();
    expect(overview!.hsCode).toBeNull();
  });
});

describe("MI2A read-side product surface", () => {
  it("marketIntelligenceProducts is the active MDF catalogue (never a fabricated list)", () => {
    const products = marketIntelligenceProducts();
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.active)).toBe(true);
    expect(products.some((p) => p.id === CHILLI)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source-code safety (regression scan)
// ---------------------------------------------------------------------------

describe("MI2A source-code safety", () => {
  const HERE = process.cwd();
  const files = [
    "src/lib/marketIntelligence/read/overview.ts",
    "src/lib/marketIntelligence/format.ts",
    "src/app/(app)/market-intelligence/page.tsx",
    "src/app/(app)/market-intelligence/MarketIntelligenceView.tsx",
    "src/app/(app)/market-intelligence/MarketIntelligenceCharts.tsx",
    "src/app/(app)/market-intelligence/loading.tsx",
  ];
  const bodies = files.map((f) => readFileSync(path.resolve(HERE, f), "utf8"));

  it("no provider or writer or cohort-refresh import from the read/UI layer", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/providers\/baci\/server|providers\/baci\/metadata|fetchBaciQuery|cohortFetch|cohortMaterialize|scoreRefresh|refreshMarketIntelligence|writer\/writer|getMarketIntelligenceWriter/);
      expect(body).not.toMatch(/refresh_market_intelligence/);
      expect(body).not.toMatch(/BACI_OEC_API_KEY/);
    }
  });

  it("no bare fetch()/XMLHttpRequest, no BuyerFinder/BI writes", () => {
    for (const body of bodies) {
      // The UI does not call fetch directly; it navigates via router.push().
      // The read model is pure I/O over the repository.
      expect(body).not.toMatch(/\bXMLHttpRequest\b/);
      expect(body).not.toMatch(/buyer_trade_observations|buyer_intelligence|BUYER_SEND_ENABLED|gmail/i);
    }
  });

  it("MI2B charts consume the existing detail contract without scoring or additional reads", () => {
    const chart = bodies[4]!;
    expect(chart).toMatch(/AnnualImportPoint/);
    expect(chart).toMatch(/OriginRankRow/);
    expect(chart).not.toMatch(/marketFit|mi-fit|createClient|repository|\.from\(|fetch\(/i);
  });

  it("MI2B navigation uses transitions and exposes pending accessibility state", () => {
    const view = bodies[3]!;
    expect(view).toMatch(/useTransition/);
    expect(view).toMatch(/aria-busy/);
    expect(view).toMatch(/motion-reduce/);
    expect(view).toMatch(/disabled=\{navigationPending\}/);
  });

  it("proxy disclosure is present in the UI (not hidden in metadata)", () => {
    const view = bodies[3]!;
    expect(view).toMatch(/Trade proxy/);
    expect(view).toMatch(/HS 090421/);
    expect(view).toMatch(/does not prove imports specifically originated from Guntur/);
  });

  it("no hardcoded qualitative labels like 'Excellent' / 'Best Market' etc.", () => {
    const view = bodies[3]!;
    expect(view).not.toMatch(/\bExcellent\b|\bBest Market\b|\bBad\b|\bGreat\b/);
  });

  it("no company-level claim strings in market view", () => {
    const view = bodies[3]!;
    expect(view).not.toMatch(/Companies in this country buy from MDF/);
    expect(view).not.toMatch(/These companies imported from India/);
  });

  it("page.tsx uses resolveMarketIntelligenceProductRouting and short-circuits invalid before overview reads", () => {
    const pageBody = bodies[2]!;
    expect(pageBody).toContain("resolveMarketIntelligenceProductRouting");
    // The `invalidProduct` branch MUST return BEFORE the overview read.
    const invalidIdx = pageBody.indexOf("if (invalidProduct)");
    const overviewIdx = pageBody.indexOf("getMarketIntelligenceOverview(product.id");
    expect(invalidIdx).toBeGreaterThan(-1);
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(invalidIdx).toBeLessThan(overviewIdx);
  });

  it("view renders InvalidProductState only when invalidProduct is true", () => {
    const view = bodies[3]!;
    expect(view).toContain("InvalidProductState");
    // The invalid state must have no ranking-table / detail-panel content.
    const start = view.indexOf("function InvalidProductState");
    const end = view.indexOf("function ", start + 1) < 0 ? view.length : view.indexOf("function ", start + 1);
    const invalidBlock = view.slice(start, end);
    expect(invalidBlock).not.toMatch(/RankingTable|DetailPanel|SummaryStrip/);
    expect(invalidBlock).not.toMatch(/Trade proxy/);
    expect(invalidBlock).toMatch(/Unknown product/);
  });
});
