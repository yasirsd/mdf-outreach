import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectAllMarketObservationPages,
  MARKET_OBSERVATION_READ_PAGE_SIZE,
  type MarketReadRepositoryObservation,
} from "../marketReadRepository";
import { calibrationCohort } from "./cohort";
import { buildCalibrationEvidenceContext } from "./evidence";
import { computeCountryPrimitives } from "./primitives";
import { summarize } from "./distribution";
import { buildCalibrationReport } from "./report";
import { buildCalibrationReviewReport } from "./review";

vi.mock("server-only", () => ({}));

const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024] as const;

function observation(
  reporter: string,
  year: number,
  partner: string | null,
  value: number,
  quantity: number | null = value / 1_000,
): MarketReadRepositoryObservation {
  return {
    id: `${reporter}-${year}-${partner ?? "world"}`,
    sourceId: "source-1",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    reporterCountry: reporter,
    partnerCountry: partner,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCode: "090421",
    frequency: "annual",
    period: String(year),
    tradeValueUsd: value,
    quantity,
    quantityUnit: quantity === null ? null : "tonne",
    netWeightKg: null,
    retrievedAt: "2026-09-23T00:00:00.000Z",
  };
}

function context(reporter: string, rows: MarketReadRepositoryObservation[]) {
  return buildCalibrationEvidenceContext({
    reporterCountry: reporter,
    hsRevision: "HS17",
    hsCode: "090421",
    observations: rows,
    ledgerEntry: {
      outcome: "success",
      rowsReceived: rows.filter((row) => row.partnerCountry !== null).length,
      fetchedAt: "2026-09-23T00:00:00.000Z",
      freshUntil: "2026-10-23T00:00:00.000Z",
      safeMetadata: {},
    },
    requestedStartYear: 2018,
    requestedEndYear: 2024,
    providerSupportedYears: YEARS,
  });
}

function cohortReport() {
  const evidence = new Map();
  calibrationCohort().forEach((entry, countryIndex) => {
    const rows = YEARS.flatMap((year, yearIndex) => {
      const scale = 1 + countryIndex * 0.25 + yearIndex * 0.05;
      return [
        observation(entry.countryAlpha2, year, "CN", 1_000_000 * scale),
        observation(entry.countryAlpha2, year, "IN", 500_000 * scale),
        observation(entry.countryAlpha2, year, "TH", 250_000 * scale),
      ];
    });
    // Deterministic material outlier without removing it from the report.
    if (entry.countryAlpha2 === "US") {
      rows.push(observation("US", 2024, "MX", 1_000_000_000));
    }
    evidence.set(entry.countryAlpha2, context(entry.countryAlpha2, rows));
  });
  return buildCalibrationReport({
    cohortAvailable: calibrationCohort(),
    cohortUnavailable: [],
    evidenceByCountry: evidence,
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    sourceTier: "A",
    currentYear: 2026,
    now: () => new Date("2026-09-23T00:00:00.000Z"),
  });
}

describe("MI1G deterministic complete reads", () => {
  it("retrieves more than 1,000 rows without truncation", async () => {
    const source = Array.from({ length: 1_205 }, (_, index) => index);
    const ranges: Array<[number, number]> = [];
    const result = await collectAllMarketObservationPages(async (from, to) => {
      ranges.push([from, to]);
      return source.slice(from, to + 1);
    });

    expect(MARKET_OBSERVATION_READ_PAGE_SIZE).toBe(500);
    expect(result).toEqual(source);
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
});

describe("MI1G latest-year and primitive semantics", () => {
  it("derives totals, India position, concentration, growth, and volatility from bilateral rows", () => {
    const rows = YEARS.flatMap((year, index) => [
      observation("MY", year, "CN", 100 + index * 10, 1),
      observation("MY", year, "IN", 50 + index * 5, 0.5),
    ]);
    rows.push(observation("MY", 2024, null, 999_999, 999));
    const primitives = computeCountryPrimitives(context("MY", rows));

    expect(primitives.latestYear).toBe(2024);
    expect(primitives.latestImportsUsd).toBe(240);
    expect(primitives.indiaImportsUsd).toBe(80);
    expect(primitives.indiaShare).toBeCloseTo(1 / 3);
    expect(primitives.indiaRank).toBe(2);
    expect(primitives.topOriginCountry).toBe("CN");
    expect(primitives.top1OriginShare).toBeCloseTo(2 / 3);
    expect(primitives.top3OriginShare).toBe(1);
    expect(primitives.hhi).toBeCloseTo((2 / 3) ** 2 + (1 / 3) ** 2);
    expect(primitives.latestYoyPct).toBeCloseTo((240 / 225 - 1) * 100);
    expect(primitives.threeYearCagrPct).toBeCloseTo((240 / 195) ** (1 / 3) * 100 - 100);
    expect(primitives.fiveYearCagrPct).toBeCloseTo((240 / 165) ** (1 / 5) * 100 - 100);
    expect(primitives.volatilityCv).not.toBeNull();
    expect(primitives.observedYears).toEqual([...YEARS]);
  });

  it("uses latest observed year and refuses a partial quantity denominator", () => {
    const rows = [
      observation("AE", 2022, "CN", 100, 1),
      observation("AE", 2023, "CN", 120, 1),
      observation("AE", 2023, "IN", 20, null),
    ];
    const primitives = computeCountryPrimitives(context("AE", rows));
    expect(primitives.latestYear).toBe(2023);
    expect(primitives.latestQuantityTonnes).toBeNull();
    expect(primitives.latestDerivedUnitValueUsdPerKg).toBeNull();
  });
});

describe("MI1G review projection", () => {
  it("includes exactly the canonical 18 countries with provisional proxy outputs", () => {
    const review = buildCalibrationReviewReport(cohortReport());
    expect(review.cohortSize).toBe(18);
    expect(review.rows.map((row) => row.countryAlpha2)).toEqual(
      calibrationCohort().map((entry) => entry.countryAlpha2),
    );
    expect(new Set(review.rows.map((row) => row.countryAlpha2)).size).toBe(18);
    expect(review.normalization.isProvisional).toBe(true);
    expect(review.label).toBe("PROVISIONAL — NOT CALIBRATED");
    expect(review.rows.every((row) => row.mappingKind === "proxy")).toBe(true);
    expect(review.rows.every((row) => row.recommendationStatus !== "actionable")).toBe(true);
  });

  it("reports confidence, supported weight, missingness, and all required distributions", () => {
    const review = buildCalibrationReviewReport(cohortReport());
    expect(review.rows.every((row) => Object.keys(row.confidenceContributors).length === 6)).toBe(true);
    expect(review.rows.every((row) => row.meetsSupportedWeightThreshold)).toBe(true);
    expect(review.missingnessMatrix).toHaveLength(18);
    expect(review.distributions.latestImportValueUsd.count).toBe(18);
    expect(review.distributions.dataConfidenceScore.count).toBe(18);
    expect(review.demandSizeDistribution.rawUsd.count).toBe(18);
    expect(review.demandSizeDistribution.log10ValuePlusOne.count).toBe(18);
    expect(review.percentileMethod).toBe("nearest_rank_type_1");
  });

  it("excludes missing values from percentiles and detects outliers deterministically", () => {
    const summary = summarize([1, 2, null, 3, undefined, Number.NaN, 100]);
    expect(summary.count).toBe(4);
    expect(summary.missingCount).toBe(3);
    expect(summary.p10).toBe(1);
    expect(summary.p50).toBe(2);

    const review = buildCalibrationReviewReport(cohortReport());
    expect(review.outliers.some((item) =>
      item.countryAlpha2 === "US" && item.primitive === "latestImportValueUsd"
    )).toBe(true);
    expect(review.outliers.every((item) => item.method === "tukey_1_5_iqr")).toBe(true);
  });
});

describe("MI1G static safety boundary", () => {
  const files = [
    "src/lib/marketIntelligence/calibration/review.ts",
    "src/lib/marketIntelligence/calibration/shadow.ts",
    "src/lib/marketIntelligence/server/calibrationReport.ts",
    "src/app/api/internal/market-intelligence/calibration/report/route.ts",
  ];
  const source = files.map((file) => readFileSync(path.resolve(process.cwd(), file), "utf8")).join("\n");

  it("contains no provider transport and no production/BI write surface", () => {
    expect(source).not.toMatch(/providers\/baci\/(server|metadata|proofExecution)/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/market_product_scores|market_product_score_components/);
    expect(source).not.toMatch(/market_trade_metrics|market_analysis_events/);
    expect(source).not.toMatch(/buyer_trade_observations|buyer_intelligence_/);
    expect(source).not.toMatch(/getMarketIntelligenceWriter|ingestTradeObservation|recordFetchResult/);
  });

  it("keeps the route POST-only, bodyless, same-origin, and owner-gated by the runner", () => {
    const route = readFileSync(path.resolve(
      process.cwd(),
      "src/app/api/internal/market-intelligence/calibration/report/route.ts",
    ), "utf8");
    const runner = readFileSync(path.resolve(
      process.cwd(),
      "src/lib/marketIntelligence/server/calibrationReport.ts",
    ), "utf8");
    expect(route).toContain("export async function POST");
    expect(route).not.toMatch(/export async function GET/);
    expect(route).not.toMatch(/request\.(json|text|formData|arrayBuffer)\(/);
    expect(route).toContain("isSameOriginPost");
    expect(runner).toContain('session.membership.role !== "owner"');
  });
});
