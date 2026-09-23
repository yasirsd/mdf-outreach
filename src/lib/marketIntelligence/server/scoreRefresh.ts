import "server-only";

import { requireMdfSession } from "@/lib/auth/require";
import type { MdfMembership } from "@/lib/auth/membership";
import { buildCalibrationEvidenceContext } from "../calibration/evidence";
import { buildCalibrationReport } from "../calibration/report";
import { alpha2ToAlpha3, countryDisplayName, toCountryAlpha2 } from "../country";
import { DATA_CONFIDENCE_VERSION } from "../marketFit";
import type {
  MarketReadRepository,
  MarketReadRepositoryProductMapping,
} from "../marketReadRepository";
import {
  MI_PRODUCT_MAPPING_VERSION,
  PRODUCT_TRADE_MAPPINGS,
  knownMdfProduct,
  mappingFitEligibility,
} from "../product";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  MALAYSIA_CHILLI_PRODUCT_ID,
} from "../providers/baci/contract";
import type { CountryAlpha2 } from "../types";
import type { MarketIntelligenceWriter } from "./writer";
import {
  MARKET_SCORE_ANALYTICAL_YEARS,
  selectAuthoritativePersistedLedger,
  verifiedBaciSourceRights,
} from "./persistedEvidence";
import {
  assessMarketScoreStaleness,
  buildMarketScorePersistencePlan,
  marketScorePersistenceFingerprint,
} from "./scorePersistence";

type ScoreRefreshRepository = Pick<
  MarketReadRepository,
  | "listActiveProductMappings"
  | "getSourceByProviderDataset"
  | "listBilateralAnnualObservations"
  | "listRecentLedgerEntriesForFingerprint"
  | "listRecentLedgerEntriesForReporter"
  | "getCurrentMarketScore"
>;

export type ScoreRefreshOutcome =
  | "created"
  | "unchanged"
  | "superseded_and_created"
  | "insufficient_evidence"
  | "unauthorised"
  | "forbidden"
  | "invalid_request"
  | "unsupported_product"
  | "mapping_error"
  | "source_error"
  | "database_error";

export interface ScoreRefreshRequest {
  country: string;
  product: string;
  dryRun: boolean;
}

export interface ScoreRefreshResult {
  outcome: ScoreRefreshOutcome;
  dryRun: boolean;
  country?: string;
  product?: string;
  marketFitVersion?: string;
  dataConfidenceVersion?: string;
  fit?: number | null;
  confidence?: number | null;
  recommendationStatus?: "actionable" | "indicative" | "insufficient_evidence";
  supportedWeight?: number;
  componentCount?: number;
  components?: Array<{
    key: string;
    score: number | null;
    weight: number;
    supported: boolean;
    rawMetricValue: number | null;
  }>;
  evidenceWatermark?: string;
  mappingWatermark?: string;
  stale?: boolean;
  staleReasons?: string[];
  preRefreshStale?: boolean;
  preRefreshStaleReasons?: string[];
  resultingScoreStale?: boolean | null;
  scoreId?: string | null;
  providerCalls: 0;
  databaseWrites: 0 | 1;
  message?: string;
}

export interface ScoreRefreshDependencies {
  requireSession?: () => Promise<{ membership: MdfMembership }>;
  loadRepository?: () => Promise<ScoreRefreshRepository>;
  loadWriter?: () => Promise<MarketIntelligenceWriter>;
  now?: () => Date;
}

function failure(
  outcome: Exclude<ScoreRefreshOutcome, "created" | "unchanged" | "superseded_and_created" | "insufficient_evidence">,
  dryRun: boolean,
  message: string,
): ScoreRefreshResult {
  return { outcome, dryRun, providerCalls: 0, databaseWrites: 0, message };
}

function isCurrentCanonicalMapping(mapping: MarketReadRepositoryProductMapping): boolean {
  const canonical = PRODUCT_TRADE_MAPPINGS.find((candidate) =>
    candidate.mdfProductId === MALAYSIA_CHILLI_PRODUCT_ID &&
    candidate.hsRevision === "HS17" &&
    candidate.hsCode === MALAYSIA_CHILLI_HS17_CODE
  );
  return Boolean(
    canonical &&
    mapping.registryVersion === MI_PRODUCT_MAPPING_VERSION &&
    mapping.mappingKind === canonical.mappingKind &&
    mapping.mappingConfidence === canonical.mappingConfidence &&
    mapping.fitEligibility === mappingFitEligibility(canonical.mappingKind) &&
    mapping.hsLevel === canonical.hsLevel &&
    mapping.weight === canonical.weight,
  );
}

/**
 * Owner-only, bounded score lifecycle. Reads one country/product from persisted
 * evidence and invokes the existing locked RPC only when dryRun is false.
 */
export async function refreshPersistedMarketScore(
  input: ScoreRefreshRequest,
  deps: ScoreRefreshDependencies = {},
): Promise<ScoreRefreshResult> {
  let session;
  try {
    session = deps.requireSession ? await deps.requireSession() : await requireMdfSession();
  } catch {
    return failure("unauthorised", input.dryRun, "MDF session required to refresh a market score.");
  }
  if (session.membership.role !== "owner") {
    return failure("forbidden", input.dryRun, "Market score refresh requires an MDF owner role.");
  }

  const countryAlpha2 = toCountryAlpha2(input.country);
  if (!countryAlpha2 || countryAlpha2 !== input.country.trim().toUpperCase()) {
    return failure("invalid_request", input.dryRun, "A canonical country alpha-2 code is required.");
  }
  if (!knownMdfProduct(input.product)) {
    return failure("invalid_request", input.dryRun, "A canonical MDF product id is required.");
  }
  if (input.product !== MALAYSIA_CHILLI_PRODUCT_ID) {
    return failure(
      "unsupported_product",
      input.dryRun,
      "The calibrated persisted-evidence scorer currently supports guntur-dry-red-chilli only.",
    );
  }

  let repository: ScoreRefreshRepository;
  try {
    repository = deps.loadRepository ? await deps.loadRepository() : await loadRepositoryFromRequest();
  } catch {
    return failure("database_error", input.dryRun, "Persisted Market Intelligence evidence could not be read.");
  }

  const now = (deps.now ?? (() => new Date()))();
  try {
    const [mappings, source, observations, current] = await Promise.all([
      repository.listActiveProductMappings(),
      repository.getSourceByProviderDataset("baci_oec", BACI_OEC_DATASET_ID),
      repository.listBilateralAnnualObservations(
        countryAlpha2, "HS17", MALAYSIA_CHILLI_HS17_CODE, "baci_oec", BACI_OEC_DATASET_ID,
      ),
      repository.getCurrentMarketScore(countryAlpha2, input.product),
    ]);
    const mapping = mappings.find((candidate) =>
      candidate.mdfProductId === input.product &&
      candidate.hsRevision === "HS17" &&
      candidate.hsCode === MALAYSIA_CHILLI_HS17_CODE &&
      candidate.isActive
    );
    if (!mapping || !isCurrentCanonicalMapping(mapping)) {
      return failure("mapping_error", input.dryRun, "The current canonical chilli mapping is unavailable or stale.");
    }
    if (!verifiedBaciSourceRights(source)) {
      return failure("source_error", input.dryRun, "The verified BACI source/storage-rights record is unavailable.");
    }

    const ledger = await selectAuthoritativePersistedLedger(repository, countryAlpha2, observations, now);
    const context = buildCalibrationEvidenceContext({
      reporterCountry: countryAlpha2,
      hsRevision: "HS17",
      hsCode: MALAYSIA_CHILLI_HS17_CODE,
      observations,
      ledgerEntry: ledger,
      requestedStartYear: ledger ? Number(ledger.coverageStart) : 2018,
      requestedEndYear: ledger ? Number(ledger.coverageEnd) : 2024,
      providerSupportedYears: MARKET_SCORE_ANALYTICAL_YEARS,
    });
    const alpha3 = alpha2ToAlpha3(countryAlpha2);
    if (!alpha3) {
      return failure("invalid_request", input.dryRun, "The country cannot be mapped to canonical ISO alpha-3.");
    }
    const report = buildCalibrationReport({
      cohortAvailable: [{
        countryAlpha2,
        displayName: countryDisplayName(countryAlpha2) ?? countryAlpha2,
        role: "focus",
        baciImporterId: alpha3.toLowerCase(),
      }],
      cohortUnavailable: [],
      evidenceByCountry: new Map([[countryAlpha2, context]]),
      mappingKind: mapping.mappingKind,
      mappingConfidence: mapping.mappingConfidence,
      sourceTier: source.sourceTier,
      currentYear: now.getUTCFullYear(),
      now: () => now,
    });
    const calculation = report.countries[0]!;
    const plan = buildMarketScorePersistencePlan({
      countryAlpha2,
      mdfProductId: input.product,
      mapping,
      source,
      observations,
      ledger,
      calculation,
    });
    const staleState = assessMarketScoreStaleness(current, plan.watermarks);
    const identical = marketScorePersistenceFingerprint(current) === plan.persistenceFingerprint;
    const fit = calculation.fit;
    const confidence = calculation.confidence.supported ? calculation.confidence.score : null;

    const base: Omit<ScoreRefreshResult, "outcome" | "databaseWrites"> = {
      dryRun: input.dryRun,
      country: countryAlpha2,
      product: input.product,
      marketFitVersion: fit.calculationVersion,
      dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
      fit: fit.publishedFitScore,
      confidence,
      recommendationStatus: fit.recommendationStatus,
      supportedWeight: fit.supportedWeight,
      componentCount: plan.components.length,
      components: plan.components.map((component) => ({
        key: component.component_key,
        score: component.normalized_score,
        weight: component.weight,
        supported: component.supported,
        rawMetricValue: component.raw_metric_value === null
          ? null
          : Number(component.raw_metric_value),
      })),
      evidenceWatermark: plan.watermarks.evidenceWatermark,
      mappingWatermark: plan.watermarks.mappingWatermark,
      stale: staleState.stale,
      staleReasons: staleState.reasons,
      preRefreshStale: staleState.stale,
      preRefreshStaleReasons: staleState.reasons,
      resultingScoreStale: input.dryRun ? (identical ? false : null) : false,
      scoreId: current?.id ?? null,
      providerCalls: 0,
    };

    if (input.dryRun) {
      return {
        ...base,
        outcome: fit.diagnosticFitScore === null ? "insufficient_evidence" : identical ? "unchanged" : current ? "superseded_and_created" : "created",
        databaseWrites: 0,
      };
    }

    const writer = deps.loadWriter ? await deps.loadWriter() : await loadWriter();
    const written = await writer.refreshMarketIntelligence({
      countryAlpha2,
      mdfProductId: input.product,
      payload: plan.payload,
    });
    const unchanged = written.scoreId === current?.id;
    return {
      ...base,
      outcome: fit.diagnosticFitScore === null
        ? "insufficient_evidence"
        : unchanged
          ? "unchanged"
          : current ? "superseded_and_created" : "created",
      scoreId: written.scoreId,
      databaseWrites: unchanged ? 0 : 1,
    };
  } catch {
    return failure("database_error", input.dryRun, "The market score lifecycle could not be completed.");
  }
}

async function loadRepositoryFromRequest(): Promise<ScoreRefreshRepository> {
  const [{ cookies }, { createClient }, repositoryModule] = await Promise.all([
    import("next/headers"),
    import("@/utils/supabase/server"),
    import("../marketReadRepository"),
  ]);
  return repositoryModule.createMarketReadRepository(createClient(cookies()));
}

async function loadWriter(): Promise<MarketIntelligenceWriter> {
  const { getMarketIntelligenceWriter } = await import("./writer");
  return getMarketIntelligenceWriter();
}
