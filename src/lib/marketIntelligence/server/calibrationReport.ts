import "server-only";

import { requireMdfSession } from "@/lib/auth/require";
import type { MdfMembership } from "@/lib/auth/membership";
import { calibrationCohort } from "../calibration/cohort";
import { buildCalibrationEvidenceContext } from "../calibration/evidence";
import { buildCalibrationReport } from "../calibration/report";
import {
  buildCalibrationReviewReport,
  type CalibrationReviewReport,
} from "../calibration/review";
import {
  buildCalibrationComparison,
  type CalibrationComparison,
} from "../calibration/shadow";
import type {
  MarketReadRepository,
  MarketReadRepositoryObservation,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  MALAYSIA_CHILLI_PRODUCT_ID,
  baciQueryFingerprint,
  buildCountryChilliQuery,
} from "../providers/baci/contract";
import type { CountryAlpha2, MarketProviderFetchLedgerEntry } from "../types";

export const MI1G_ANALYTICAL_YEARS = Object.freeze([
  2018, 2019, 2020, 2021, 2022, 2023, 2024,
]);

type CalibrationReportRepository = Pick<
  MarketReadRepository,
  | "listActiveProductMappings"
  | "getSourceByProviderDataset"
  | "listBilateralAnnualObservations"
  | "listRecentLedgerEntriesForFingerprint"
  | "listRecentLedgerEntriesForReporter"
>;

export type CalibrationReportOutcome =
  | "report_ready"
  | "unauthorised"
  | "forbidden"
  | "mapping_error"
  | "source_error"
  | "database_error";

export interface CalibrationReportResult {
  outcome: CalibrationReportOutcome;
  report?: CalibrationReviewReport & { calibrationComparison: CalibrationComparison };
  message?: string;
  providerCalls: 0;
  databaseWrites: 0;
}

export interface CalibrationReportDependencies {
  requireSession?: () => Promise<{ membership: MdfMembership }>;
  loadRepository?: () => Promise<CalibrationReportRepository>;
  now?: () => Date;
}

const FRESH_COMPLETE = new Set(["success", "empty"]);

function sourceRightsValid(source: MarketReadRepositorySource | undefined): source is MarketReadRepositorySource {
  return Boolean(
    source &&
    source.providerId === "baci_oec" &&
    source.datasetId === BACI_OEC_DATASET_ID &&
    source.serviceTermsVerified &&
    source.storageAllowed === true &&
    source.redistributionAllowed === false &&
    source.licenceVerifiedAt,
  );
}

function freshComplete(entry: MarketProviderFetchLedgerEntry, now: Date): boolean {
  const freshUntil = Date.parse(entry.freshUntil);
  return FRESH_COMPLETE.has(entry.outcome) &&
    Number.isFinite(freshUntil) && freshUntil > now.getTime();
}

function compatibleIdentity(
  entry: MarketProviderFetchLedgerEntry,
  reporterCountry: CountryAlpha2,
): boolean {
  return entry.providerId === "baci_oec" &&
    entry.datasetId === BACI_OEC_DATASET_ID &&
    entry.reporterCountry === reporterCountry &&
    entry.partnerCountry === null &&
    entry.tradeFlow === "import" &&
    entry.hsRevision === "HS17" &&
    entry.hsCodes.length === 1 &&
    entry.hsCodes[0] === MALAYSIA_CHILLI_HS17_CODE &&
    entry.frequency === "annual";
}

function coverageIncludesAnalyticalYears(entry: MarketProviderFetchLedgerEntry): boolean {
  const start = Number(entry.coverageStart);
  const end = Number(entry.coverageEnd);
  return Number.isInteger(start) && Number.isInteger(end) && start <= 2018 && end >= 2024;
}

function rowsMatchCompatibleLedger(
  rows: readonly MarketReadRepositoryObservation[],
  ledger: MarketProviderFetchLedgerEntry,
  reporterCountry: CountryAlpha2,
): boolean {
  if (rows.length !== ledger.rowsReceived) return false;
  const analyticalYears = new Set(MI1G_ANALYTICAL_YEARS);
  const identities = new Set<string>();
  for (const row of rows) {
    const year = Number(row.period);
    const identity = `${row.period}|${row.partnerCountry ?? "__WORLD__"}`;
    if (
      row.providerId !== "baci_oec" ||
      row.datasetId !== BACI_OEC_DATASET_ID ||
      row.reporterCountry !== reporterCountry ||
      row.partnerCountry === null ||
      row.tradeFlow !== "import" ||
      row.hsRevision !== "HS17" ||
      row.hsCode !== MALAYSIA_CHILLI_HS17_CODE ||
      row.frequency !== "annual" ||
      !analyticalYears.has(year) ||
      identities.has(identity)
    ) return false;
    identities.add(identity);
  }
  return ledger.outcome === "empty" ? rows.length === 0 : true;
}

async function authoritativeLedger(
  repository: CalibrationReportRepository,
  reporterCountry: CountryAlpha2,
  rows: readonly MarketReadRepositoryObservation[],
  now: Date,
): Promise<MarketProviderFetchLedgerEntry | undefined> {
  const exactFingerprint = baciQueryFingerprint(
    buildCountryChilliQuery(reporterCountry, MI1G_ANALYTICAL_YEARS),
  );
  const exact = (
    await repository.listRecentLedgerEntriesForFingerprint(
      "baci_oec", BACI_OEC_DATASET_ID, exactFingerprint, 1,
    )
  )[0];
  if (exact && freshComplete(exact, now)) return exact;

  // Preserve MI1F blocked semantics: a fresh failed exact attempt cannot be
  // hidden by an older compatible success.
  if (exact && Date.parse(exact.freshUntil) > now.getTime() && !FRESH_COMPLETE.has(exact.outcome)) {
    return undefined;
  }

  const recent = await repository.listRecentLedgerEntriesForReporter(
    "baci_oec", BACI_OEC_DATASET_ID, reporterCountry, 25,
  );
  const latestByFingerprint = new Map<string, MarketProviderFetchLedgerEntry>();
  for (const candidate of recent) {
    if (!latestByFingerprint.has(candidate.queryFingerprint)) {
      latestByFingerprint.set(candidate.queryFingerprint, candidate);
    }
  }
  for (const candidate of latestByFingerprint.values()) {
    if (
      compatibleIdentity(candidate, reporterCountry) &&
      freshComplete(candidate, now) &&
      coverageIncludesAnalyticalYears(candidate) &&
      rowsMatchCompatibleLedger(rows, candidate, reporterCountry)
    ) return candidate;
  }
  return undefined;
}

function failure(
  outcome: Exclude<CalibrationReportOutcome, "report_ready">,
  message: string,
): CalibrationReportResult {
  return { outcome, message, providerCalls: 0, databaseWrites: 0 };
}

/** Owner-only, read-only report generation from persisted MI evidence. */
export async function runCalibrationDistributionReport(
  deps: CalibrationReportDependencies = {},
): Promise<CalibrationReportResult> {
  let session;
  try {
    session = deps.requireSession ? await deps.requireSession() : await requireMdfSession();
  } catch {
    return failure("unauthorised", "MDF session required to generate the calibration report.");
  }
  if (session.membership.role !== "owner") {
    return failure("forbidden", "The calibration report requires an MDF owner role.");
  }

  let repository: CalibrationReportRepository;
  try {
    repository = deps.loadRepository ? await deps.loadRepository() : await loadRepositoryFromRequest();
  } catch {
    return failure("database_error", "Persisted Market Intelligence evidence could not be read.");
  }

  const now = (deps.now ?? (() => new Date()))();
  try {
    const [mappings, source] = await Promise.all([
      repository.listActiveProductMappings(),
      repository.getSourceByProviderDataset("baci_oec", BACI_OEC_DATASET_ID),
    ]);
    const mapping = mappings.find((candidate) =>
      candidate.mdfProductId === MALAYSIA_CHILLI_PRODUCT_ID &&
      candidate.hsRevision === "HS17" &&
      candidate.hsCode === MALAYSIA_CHILLI_HS17_CODE &&
      candidate.mappingKind === "proxy" &&
      candidate.fitEligibility === "proxy_allowed" &&
      candidate.isActive
    );
    if (!mapping) {
      return failure("mapping_error", "The active chilli HS17 090421 proxy mapping is unavailable.");
    }
    if (!sourceRightsValid(source)) {
      return failure("source_error", "The verified BACI source/storage-rights record is unavailable.");
    }

    const evidenceByCountry = new Map();
    for (const entry of calibrationCohort()) {
      const observations = await repository.listBilateralAnnualObservations(
        entry.countryAlpha2,
        "HS17",
        MALAYSIA_CHILLI_HS17_CODE,
        "baci_oec",
        BACI_OEC_DATASET_ID,
      );
      const ledger = await authoritativeLedger(
        repository, entry.countryAlpha2, observations, now,
      );
      evidenceByCountry.set(entry.countryAlpha2, buildCalibrationEvidenceContext({
        reporterCountry: entry.countryAlpha2,
        hsRevision: "HS17",
        hsCode: MALAYSIA_CHILLI_HS17_CODE,
        observations,
        ledgerEntry: ledger,
        requestedStartYear: ledger ? Number(ledger.coverageStart) : 2018,
        requestedEndYear: ledger ? Number(ledger.coverageEnd) : 2024,
        providerSupportedYears: MI1G_ANALYTICAL_YEARS,
      }));
    }

    const base = buildCalibrationReport({
      cohortAvailable: calibrationCohort(),
      cohortUnavailable: [],
      evidenceByCountry,
      mappingKind: mapping.mappingKind,
      mappingConfidence: mapping.mappingConfidence,
      sourceTier: source.sourceTier,
      currentYear: now.getUTCFullYear(),
      now: () => now,
    });
    const review = buildCalibrationReviewReport(base);
    return {
      outcome: "report_ready",
      report: {
        ...review,
        calibrationComparison: buildCalibrationComparison(review),
      },
      providerCalls: 0,
      databaseWrites: 0,
    };
  } catch {
    return failure("database_error", "Persisted calibration evidence could not be assembled.");
  }
}

async function loadRepositoryFromRequest(): Promise<CalibrationReportRepository> {
  const [{ cookies }, { createClient }, repositoryModule] = await Promise.all([
    import("next/headers"),
    import("@/utils/supabase/server"),
    import("../marketReadRepository"),
  ]);
  return repositoryModule.createMarketReadRepository(createClient(cookies()));
}
