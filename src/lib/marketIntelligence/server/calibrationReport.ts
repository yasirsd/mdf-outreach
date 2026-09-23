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
import type { MarketReadRepository } from "../marketReadRepository";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  MALAYSIA_CHILLI_PRODUCT_ID,
} from "../providers/baci/contract";
import {
  MARKET_SCORE_ANALYTICAL_YEARS,
  selectAuthoritativePersistedLedger,
  verifiedBaciSourceRights,
} from "./persistedEvidence";

export const MI1G_ANALYTICAL_YEARS = MARKET_SCORE_ANALYTICAL_YEARS;

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
    if (!verifiedBaciSourceRights(source)) {
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
      const ledger = await selectAuthoritativePersistedLedger(
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
