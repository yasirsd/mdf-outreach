import { describe, expect, it, vi } from "vitest";
import type { MdfMembership } from "@/lib/auth/membership";
import { calibrationCohort } from "../calibration/cohort";
import type { MarketReadRepositoryObservation } from "../marketReadRepository";
import type { CountryAlpha2, MarketProviderFetchLedgerEntry } from "../types";
import { runCalibrationDistributionReport } from "./calibrationReport";

vi.mock("server-only", () => ({}));

function rowsFor(reporter: CountryAlpha2): MarketReadRepositoryObservation[] {
  return Array.from({ length: 7 }, (_, index) => 2018 + index).flatMap((year) => [
    {
      id: `${reporter}-${year}-CN`,
      sourceId: "source-1",
      providerId: "baci_oec",
      datasetId: "baci-hs17",
      reporterCountry: reporter,
      partnerCountry: "CN" as CountryAlpha2,
      tradeFlow: "import" as const,
      hsRevision: "HS17" as const,
      hsCode: "090421",
      frequency: "annual" as const,
      period: String(year),
      tradeValueUsd: 1_000_000 + year,
      quantity: 100,
      quantityUnit: "tonne",
      netWeightKg: null,
      retrievedAt: "2026-09-23T00:00:00.000Z",
    },
    {
      id: `${reporter}-${year}-IN`,
      sourceId: "source-1",
      providerId: "baci_oec",
      datasetId: "baci-hs17",
      reporterCountry: reporter,
      partnerCountry: "IN" as CountryAlpha2,
      tradeFlow: "import" as const,
      hsRevision: "HS17" as const,
      hsCode: "090421",
      frequency: "annual" as const,
      period: String(year),
      tradeValueUsd: 500_000 + year,
      quantity: 50,
      quantityUnit: "tonne",
      netWeightKg: null,
      retrievedAt: "2026-09-23T00:00:00.000Z",
    },
  ]);
}

function ledger(reporter: CountryAlpha2, fingerprint: string): MarketProviderFetchLedgerEntry {
  return {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    queryFingerprint: fingerprint,
    reporterCountry: reporter,
    partnerCountry: null,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: ["090421"],
    frequency: "annual",
    coverageStart: "2018",
    coverageEnd: "2024",
    providerSelectionVersion: "mi-select-v2",
    fetchedAt: "2026-09-23T00:00:00.000Z",
    freshUntil: "2026-10-23T00:00:00.000Z",
    outcome: "success",
    rowsReceived: 14,
    safeMetadata: {},
  };
}

describe("MI1G server report builder", () => {
  it("reads and returns all 18 canonical countries without provider calls or writes", async () => {
    const observationReads: string[] = [];
    const repository = {
      listActiveProductMappings: async () => [{
        id: "mapping-1",
        mdfProductId: "guntur-dry-red-chilli",
        hsRevision: "HS17" as const,
        hsLevel: 6 as const,
        hsCode: "090421",
        tradeLabel: "Dried chillies, not crushed or ground",
        mappingKind: "proxy" as const,
        mappingConfidence: 0.7,
        fitEligibility: "proxy_allowed" as const,
        scopeDescription: "fixture",
        isActive: true,
      }],
      getSourceByProviderDataset: async () => ({
        id: "source-1",
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        sourceTier: "A" as const,
        datasetSource: "BACI",
        distributionService: "OEC",
        serviceTermsVerified: true,
        storageAllowed: true,
        redistributionAllowed: false,
        licenceVerifiedAt: "2026-09-01T00:00:00.000Z",
        sourceUrl: "https://example.invalid",
        retrievedAt: "2026-09-01T00:00:00.000Z",
      }),
      listBilateralAnnualObservations: async (reporter: CountryAlpha2) => {
        observationReads.push(reporter);
        return rowsFor(reporter);
      },
      listRecentLedgerEntriesForFingerprint: async (
        _provider: string,
        _dataset: string,
        fingerprint: string,
      ) => {
        const reporter = fingerprint.split("|")[3] as CountryAlpha2;
        return [ledger(reporter, fingerprint)];
      },
      listRecentLedgerEntriesForReporter: async () => [],
    };

    const result = await runCalibrationDistributionReport({
      requireSession: async () => ({ membership: { role: "owner" } as MdfMembership }),
      loadRepository: async () => repository,
      now: () => new Date("2026-09-23T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("report_ready");
    expect(result.providerCalls).toBe(0);
    expect(result.databaseWrites).toBe(0);
    expect(observationReads).toEqual(calibrationCohort().map((entry) => entry.countryAlpha2));
    expect(result.report?.rows).toHaveLength(18);
    expect(result.report?.rows.every((row) => row.latestAvailableYear === 2024)).toBe(true);
    expect(result.report?.rows.every((row) => row.completeBilateralCoverage)).toBe(true);
    expect(result.report?.rows.every((row) => row.indiaPresence === "present")).toBe(true);
    expect(result.report?.rows.every((row) => row.recommendationStatus !== "actionable")).toBe(true);
    expect(result.report?.calibrationComparison.countries).toHaveLength(18);
    expect(result.report?.calibrationComparison.scenarioTests.every((scenario) => scenario.passed)).toBe(true);
    expect(result.report?.calibrationComparison.productionNormalizationReplaced).toBe(true);
    expect(result.report?.calibrationComparison.marketFitVersion).toBe("mi-fit-v2");
  });

  it("rejects non-owners before loading the repository", async () => {
    const loadRepository = vi.fn();
    const result = await runCalibrationDistributionReport({
      requireSession: async () => ({ membership: { role: "member" } as MdfMembership }),
      loadRepository,
    });
    expect(result.outcome).toBe("forbidden");
    expect(loadRepository).not.toHaveBeenCalled();
  });
});
