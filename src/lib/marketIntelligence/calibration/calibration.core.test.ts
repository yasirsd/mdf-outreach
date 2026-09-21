import { describe, expect, it } from "vitest";
import type { MarketReadRepositoryObservation } from "../marketReadRepository";
import { toBaciCountryId } from "../providers/baci/country";
import {
  calibrationCohort,
  splitCohortByProviderAvailability,
} from "./cohort";
import { buildCalibrationEvidenceContext } from "./evidence";
import { computeCountryPrimitives } from "./primitives";
import { summarize, percentile, log10p1, outliers } from "./distribution";

const REQUESTED_HS = "090421";
const PROVIDER_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024] as const;

function bilateral(
  year: number,
  partner: string,
  usd: number,
  tonnes: number | null,
  overrides: Partial<MarketReadRepositoryObservation> = {},
): MarketReadRepositoryObservation {
  return {
    id: `${year}-${partner}`,
    sourceId: "src-1",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    reporterCountry: "MY",
    partnerCountry: partner,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCode: REQUESTED_HS,
    frequency: "annual",
    period: String(year),
    tradeValueUsd: usd,
    quantity: tonnes,
    quantityUnit: tonnes === null ? null : "tonne",
    netWeightKg: null,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function completeContext(rows: MarketReadRepositoryObservation[]) {
  return buildCalibrationEvidenceContext({
    reporterCountry: "MY",
    hsRevision: "HS17",
    hsCode: REQUESTED_HS,
    observations: rows,
    ledgerEntry: {
      outcome: "success",
      rowsReceived: rows.filter((r) => r.partnerCountry !== null).length,
      safeMetadata: {},
      fetchedAt: "2026-09-20T00:00:00.000Z",
      freshUntil: "2026-10-20T00:00:00.000Z",
    },
    requestedStartYear: 2017,
    requestedEndYear: 2024,
    providerSupportedYears: PROVIDER_YEARS,
  });
}

function incompleteContext(rows: MarketReadRepositoryObservation[]) {
  return buildCalibrationEvidenceContext({
    reporterCountry: "MY",
    hsRevision: "HS17",
    hsCode: REQUESTED_HS,
    observations: rows,
    ledgerEntry: {
      outcome: "partial",
      rowsReceived: rows.filter((r) => r.partnerCountry !== null).length + 50,
      safeMetadata: { failure_reason: "pagination_gap" },
      fetchedAt: "2026-09-20T00:00:00.000Z",
      freshUntil: "2026-09-20T00:00:00.000Z",
    },
    requestedStartYear: 2017,
    requestedEndYear: 2024,
    providerSupportedYears: PROVIDER_YEARS,
  });
}

describe("MI1E cohort", () => {
  it("resolves 18 canonical alpha-2 → BACI alpha-3 with no duplicates", () => {
    const cohort = calibrationCohort();
    expect(cohort).toHaveLength(18);
    for (const entry of cohort) {
      expect(entry.countryAlpha2).toMatch(/^[A-Z]{2}$/);
      expect(entry.baciImporterId).toMatch(/^[a-z]{3}$/);
      expect(entry.baciImporterId).toBe(toBaciCountryId(entry.countryAlpha2));
    }
    const codes = cohort.map((c) => c.countryAlpha2);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("marks unavailable countries when the provider roster omits them (case-insensitive)", () => {
    const cohort = calibrationCohort();
    const rosterMinusVN = cohort
      .filter((e) => e.countryAlpha2 !== "VN")
      .map((e) => e.baciImporterId.toUpperCase());
    const report = splitCohortByProviderAvailability(rosterMinusVN);
    expect(report.available.map((e) => e.countryAlpha2)).not.toContain("VN");
    expect(report.unavailable.map((e) => e.countryAlpha2)).toEqual(["VN"]);
    expect(report.totals).toEqual({ cohort: 18, available: 17, unavailable: 1 });
  });
});

describe("MI1E.1 evidence + primitives — India tri-state contract", () => {
  it("complete set + India present → observed value/share/rank", () => {
    const rows = [
      bilateral(2024, "CN", 60_000_000, 25_000),
      bilateral(2024, "IN", 50_000_000, 22_000),
      bilateral(2024, "TH",  7_000_000,  3_000),
    ];
    const ctx = completeContext(rows);
    expect(ctx.completeBilateralCoverage).toBe(true);
    expect(ctx.indiaPresence).toBe("present");
    const p = computeCountryPrimitives(ctx);
    expect(p.indiaImportsUsd).toBe(50_000_000);
    expect(p.indiaShare).toBeCloseTo(50_000_000 / 117_000_000, 5);
    expect(p.indiaRank).toBe(2);
    expect(p.completenessFlags.indiaPresence).toBe("present");
  });

  it("complete set + India absent → value 0, share 0, rank null, indiaPresence 'absent'", () => {
    const rows = [
      bilateral(2024, "CN", 100_000_000, 40_000),
      bilateral(2024, "TH",  10_000_000,  4_500),
    ];
    const ctx = completeContext(rows);
    expect(ctx.completeBilateralCoverage).toBe(true);
    expect(ctx.indiaPresence).toBe("absent");
    const p = computeCountryPrimitives(ctx);
    expect(p.indiaImportsUsd).toBe(0);
    expect(p.indiaShare).toBe(0);
    expect(p.indiaRank).toBeNull();
    expect(p.completenessFlags.indiaPresence).toBe("absent");
  });

  it("incomplete set → value/share/rank NULL and indiaPresence 'unknown' (never zero, never fabricated)", () => {
    const rows = [
      bilateral(2024, "CN", 60_000_000, 25_000),
      bilateral(2024, "TH",  7_000_000,  3_000),
    ];
    const ctx = incompleteContext(rows);
    expect(ctx.completeBilateralCoverage).toBe(false);
    expect(ctx.indiaPresence).toBe("unknown");
    const p = computeCountryPrimitives(ctx);
    expect(p.indiaImportsUsd).toBeNull();
    expect(p.indiaShare).toBeNull();
    expect(p.indiaRank).toBeNull();
    expect(p.completenessFlags.indiaPresence).toBe("unknown");
  });

  it("incomplete set → concentration/HHI/top-share/origin-count all NULL", () => {
    const rows = [
      bilateral(2024, "CN", 60_000_000, 25_000),
      bilateral(2024, "TH",  7_000_000,  3_000),
    ];
    const ctx = incompleteContext(rows);
    const p = computeCountryPrimitives(ctx);
    expect(p.hhi).toBeNull();
    expect(p.top1OriginShare).toBeNull();
    expect(p.top3OriginShare).toBeNull();
    expect(p.originCount).toBeNull();
    expect(p.latestImportsUsd).toBeNull();
  });

  it("complete set → concentration/HHI/top-share/origin-count are populated", () => {
    const rows = [
      bilateral(2024, "CN", 60_000_000, 25_000),
      bilateral(2024, "IN", 50_000_000, 22_000),
      bilateral(2024, "TH",  7_000_000,  3_000),
    ];
    const ctx = completeContext(rows);
    const p = computeCountryPrimitives(ctx);
    expect(p.hhi).toBeGreaterThan(0);
    expect(p.top1OriginShare).toBeGreaterThan(0);
    expect(p.top3OriginShare).toBeCloseTo(1, 5);
    expect(p.originCount).toBe(3);
    expect(p.latestImportsUsd).toBe(117_000_000);
  });

  it("analyticalCoveragePct uses the PROVIDER-SUPPORTED window (2018–2024), not raw request (2017–2024)", () => {
    // Rows for every provider-supported year.
    const rows: MarketReadRepositoryObservation[] = [];
    for (const year of PROVIDER_YEARS) rows.push(bilateral(year, "CN", 10_000_000, 5_000));
    const ctx = completeContext(rows);
    const p = computeCountryPrimitives(ctx);
    // Provider serves 7 years; 7/7 = 100%, not 7/8 = 87.5%.
    expect(p.analyticalCoveragePct).toBe(100);
    expect(ctx.coverage.analyticalYears).toEqual([...PROVIDER_YEARS]);
  });

  it("ledger 'empty' with 0 rows is a COMPLETE zero (not unknown)", () => {
    const ctx = buildCalibrationEvidenceContext({
      reporterCountry: "MY",
      hsRevision: "HS17",
      hsCode: REQUESTED_HS,
      observations: [],
      ledgerEntry: { outcome: "empty", rowsReceived: 0, safeMetadata: {}, fetchedAt: "2026-09-20T00:00:00.000Z", freshUntil: "2026-10-20T00:00:00.000Z" },
      requestedStartYear: 2017,
      requestedEndYear: 2024,
      providerSupportedYears: PROVIDER_YEARS,
    });
    expect(ctx.completeBilateralCoverage).toBe(true);
    expect(ctx.indiaPresence).toBe("absent");
  });

  it("no ledger row → completeBilateralCoverage false and indiaPresence 'unknown'", () => {
    const ctx = buildCalibrationEvidenceContext({
      reporterCountry: "MY",
      hsRevision: "HS17",
      hsCode: REQUESTED_HS,
      observations: [bilateral(2024, "IN", 50_000_000, 22_000)],
      ledgerEntry: undefined,
      requestedStartYear: 2017,
      requestedEndYear: 2024,
      providerSupportedYears: PROVIDER_YEARS,
    });
    expect(ctx.completeBilateralCoverage).toBe(false);
    expect(ctx.indiaPresence).toBe("unknown");
  });
});

describe("MI1E distribution stats", () => {
  it("percentile respects nearest rank; summarize skips nulls; log10p1 is monotonic", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    const s = summarize([1, 2, 3, 4, 5, null]);
    expect(s.n).toBe(5);
    expect(s.p50).toBe(3);
    expect(log10p1(0)).toBe(0);
    expect(log10p1(9)).toBeCloseTo(1, 5);
    const { indices } = outliers([10, 12, 11, 13, 12, 11, 500]);
    expect(indices).toContain(6);
  });
});
