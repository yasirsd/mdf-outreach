import "server-only";

/**
 * MI1J.1 — Owner-gated cohort score materializer with a DEEP classifier.
 *
 * MI1J's earlier classifier compared only version strings on the persisted
 * score row, so a country whose evidence or mapping watermark drifted
 * silently classified `current` and was never re-processed. This module
 * now delegates the freshness verdict to the existing MI1I authority:
 *
 *     buildMarketScoreWatermarks(...)   // canonical evidence/mapping fingerprint
 *     assessMarketScoreStaleness(...)   // authoritative stale contract
 *
 * plus `selectAuthoritativePersistedLedger` and `verifiedBaciSourceRights`
 * from persistedEvidence.ts. Nothing new is invented; every fingerprint,
 * hash, and version constant is reused.
 *
 * Cross-process concurrency: the score-level `pg_advisory_xact_lock`
 * inside the `refresh_market_intelligence` RPC (migration 0022) plus the
 * `market_product_scores_current_uidx` unique index + persistence-hash
 * short-circuit guarantee: two Vercel invocations picking the same
 * country produce ONE `created` followed by ONE `unchanged` — no
 * duplicate history, no duplicate current row.
 */

import { requireMdfSession } from "@/lib/auth/require";
import type { MdfMembership } from "@/lib/auth/membership";
import { calibrationCohort } from "../calibration/cohort";
import { DATA_CONFIDENCE_VERSION, MARKET_FIT_VERSION } from "../marketFit";
import type {
  MarketReadRepository,
  MarketReadRepositoryProductMapping,
  MarketReadRepositoryScore,
} from "../marketReadRepository";
import { MI_PRODUCT_MAPPING_VERSION } from "../product";
import { MI_PROVIDER_SELECTION_VERSION } from "../providerSelection";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  MALAYSIA_CHILLI_PRODUCT_ID,
} from "../providers/baci/contract";
import type { CountryAlpha2 } from "../types";
import {
  selectAuthoritativePersistedLedger,
  verifiedBaciSourceRights,
} from "./persistedEvidence";
import {
  assessMarketScoreStaleness,
  buildMarketScoreWatermarks,
  type MarketScoreStaleReason,
} from "./scorePersistence";
import type {
  ScoreRefreshDependencies,
  ScoreRefreshOutcome,
  ScoreRefreshResult,
} from "./scoreRefresh";
import { refreshPersistedMarketScore } from "./scoreRefresh";

export const COHORT_MATERIALIZE_PRODUCT_ID = MALAYSIA_CHILLI_PRODUCT_ID;
export const COHORT_MATERIALIZE_TOTAL_COUNT = 18;

export type CohortCountryClassification =
  | "current"
  | "needs_create"
  | "needs_refresh"
  | "blocked"
  | "insufficient_evidence";

export type CohortMaterializeOutcome =
  | "country_current"
  | "country_created"
  | "country_refreshed"
  | "country_blocked"
  | "country_insufficient_evidence"
  | "cohort_complete"
  | "unauthorised"
  | "forbidden"
  | "database_error";

/** Reasons union carried on classification rows. */
export type CohortClassificationReason =
  | "no_current_score"
  | "canonical_mapping_missing"
  | "verified_source_rights_missing"
  | MarketScoreStaleReason;

export interface CohortCountryClassificationRow {
  country: CountryAlpha2;
  classification: CohortCountryClassification;
  hasCurrentScore: boolean;
  reasons: CohortClassificationReason[];
  currentScoreId: string | null;
  currentMarketFitVersion: string | null;
  currentDataConfidenceVersion: string | null;
}

export interface CohortMaterializeProcessedResult {
  country: CountryAlpha2;
  refreshOutcome: ScoreRefreshOutcome;
  fit: number | null;
  confidence: number | null;
  recommendationStatus: ScoreRefreshResult["recommendationStatus"];
  scoreId: string | null;
  stale: boolean | undefined;
  staleReasons: string[] | undefined;
  message: string | undefined;
}

export interface CohortMaterializeResult {
  outcome: CohortMaterializeOutcome;
  dryRun: boolean;
  /** The country the executor picked (dry-run OR live). */
  selectedCountry?: CountryAlpha2;
  /** Set only on a live run; the country whose persisted state actually changed / was verified. */
  processedCountry?: CountryAlpha2;
  processedResult?: CohortMaterializeProcessedResult;
  /** Only set for dry-run responses — projected outcome without any write. */
  projectedOutcome?: CohortMaterializeOutcome;
  classification: CohortCountryClassificationRow[];
  currentCountries: CountryAlpha2[];
  remainingCountries: CountryAlpha2[];
  blockedCountries: CountryAlpha2[];
  insufficientEvidenceCountries: CountryAlpha2[];
  currentCount: number;
  remainingCount: number;
  totalCount: typeof COHORT_MATERIALIZE_TOTAL_COUNT;
  databaseWrites: 0 | 1;
  providerCalls: 0;
  marketFitVersion: typeof MARKET_FIT_VERSION;
  dataConfidenceVersion: typeof DATA_CONFIDENCE_VERSION;
  productId: typeof COHORT_MATERIALIZE_PRODUCT_ID;
  message?: string;
}

export interface CohortMaterializeRequest {
  dryRun: boolean;
}

type ClassifierRepository = Pick<
  MarketReadRepository,
  | "getCurrentMarketScore"
  | "listActiveProductMappings"
  | "getSourceByProviderDataset"
  | "listBilateralAnnualObservations"
  | "listRecentLedgerEntriesForFingerprint"
  | "listRecentLedgerEntriesForReporter"
>;

export interface CohortMaterializeDependencies {
  requireSession?: () => Promise<{ membership: MdfMembership }>;
  loadRepository?: () => Promise<ClassifierRepository>;
  refreshScore?: typeof refreshPersistedMarketScore;
  refreshDependencies?: ScoreRefreshDependencies;
  now?: () => Date;
}

const inFlightCountries: Set<CountryAlpha2> = new Set();

// ---------------------------------------------------------------------------
// Deep per-country classifier
// ---------------------------------------------------------------------------

function pickCanonicalMapping(
  mappings: readonly MarketReadRepositoryProductMapping[],
): MarketReadRepositoryProductMapping | undefined {
  return mappings.find((candidate) =>
    candidate.mdfProductId === COHORT_MATERIALIZE_PRODUCT_ID &&
    candidate.hsRevision === "HS17" &&
    candidate.hsCode === MALAYSIA_CHILLI_HS17_CODE &&
    candidate.isActive
  );
}

/**
 * Classify a single country using the SAME watermark contract MI1I
 * uses inside `refreshPersistedMarketScore`. Requires the row-shaped
 * repository. Never writes.
 */
export async function classifyCohortCountry(
  repository: ClassifierRepository,
  country: CountryAlpha2,
  now: Date,
): Promise<Omit<CohortCountryClassificationRow, "country">> {
  const score = await repository.getCurrentMarketScore(country, COHORT_MATERIALIZE_PRODUCT_ID);

  if (!score) {
    return {
      classification: "needs_create",
      hasCurrentScore: false,
      reasons: ["no_current_score"],
      currentScoreId: null,
      currentMarketFitVersion: null,
      currentDataConfidenceVersion: null,
    };
  }

  const [mappings, source, observations] = await Promise.all([
    repository.listActiveProductMappings(),
    repository.getSourceByProviderDataset("baci_oec", BACI_OEC_DATASET_ID),
    repository.listBilateralAnnualObservations(
      country, "HS17", MALAYSIA_CHILLI_HS17_CODE, "baci_oec", BACI_OEC_DATASET_ID,
    ),
  ]);

  const mapping = pickCanonicalMapping(mappings);
  if (!mapping) {
    return {
      classification: "blocked",
      hasCurrentScore: true,
      reasons: ["canonical_mapping_missing"],
      currentScoreId: score.id,
      currentMarketFitVersion: score.marketFitVersion,
      currentDataConfidenceVersion: score.confidenceVersion,
    };
  }
  if (!verifiedBaciSourceRights(source)) {
    return {
      classification: "blocked",
      hasCurrentScore: true,
      reasons: ["verified_source_rights_missing"],
      currentScoreId: score.id,
      currentMarketFitVersion: score.marketFitVersion,
      currentDataConfidenceVersion: score.confidenceVersion,
    };
  }

  const ledger = await selectAuthoritativePersistedLedger(repository, country, observations, now);
  const watermarks = buildMarketScoreWatermarks({
    countryAlpha2: country,
    mdfProductId: COHORT_MATERIALIZE_PRODUCT_ID,
    mapping,
    source,
    observations,
    ledger,
  });
  const staleness = assessMarketScoreStaleness(score, watermarks);
  return {
    classification: staleness.stale ? "needs_refresh" : "current",
    hasCurrentScore: true,
    reasons: staleness.reasons,
    currentScoreId: score.id,
    currentMarketFitVersion: score.marketFitVersion,
    currentDataConfidenceVersion: score.confidenceVersion,
  };
}

function baseResult(
  outcome: CohortMaterializeOutcome, dryRun: boolean, message?: string,
): CohortMaterializeResult {
  const cohort = calibrationCohort();
  return {
    outcome,
    dryRun,
    classification: [],
    currentCountries: [],
    remainingCountries: cohort.map((c) => c.countryAlpha2),
    blockedCountries: [],
    insufficientEvidenceCountries: [],
    currentCount: 0,
    remainingCount: COHORT_MATERIALIZE_TOTAL_COUNT,
    totalCount: COHORT_MATERIALIZE_TOTAL_COUNT,
    databaseWrites: 0,
    providerCalls: 0,
    marketFitVersion: MARKET_FIT_VERSION,
    dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
    productId: COHORT_MATERIALIZE_PRODUCT_ID,
    message,
  };
}

function mapOutcome(refresh: ScoreRefreshOutcome): CohortMaterializeOutcome {
  switch (refresh) {
    case "unchanged": return "country_current";
    case "created": return "country_created";
    case "superseded_and_created": return "country_refreshed";
    case "insufficient_evidence": return "country_insufficient_evidence";
    case "unauthorised": return "unauthorised";
    case "forbidden": return "forbidden";
    case "invalid_request":
    case "unsupported_product":
    case "mapping_error":
    case "source_error":
    case "database_error":
    default:
      return "country_blocked";
  }
}

/**
 * Owner-gated, resumable, one-country-per-request cohort materializer.
 * Server-authoritative: never accepts a body-supplied cohort, country,
 * product, or score version.
 */
export async function runCohortMaterializeStep(
  input: CohortMaterializeRequest,
  deps: CohortMaterializeDependencies = {},
): Promise<CohortMaterializeResult> {
  let session;
  try {
    session = deps.requireSession ? await deps.requireSession() : await requireMdfSession();
  } catch {
    return baseResult("unauthorised", input.dryRun, "MDF session required to materialize the cohort.");
  }
  if (session.membership.role !== "owner") {
    return baseResult("forbidden", input.dryRun, "Cohort materialization requires an MDF owner role.");
  }

  let repository: ClassifierRepository;
  try {
    repository = deps.loadRepository ? await deps.loadRepository() : await loadRepositoryFromRequest();
  } catch {
    return baseResult("database_error", input.dryRun, "Persisted market scores could not be read.");
  }

  const cohort = calibrationCohort();
  const now = (deps.now ?? (() => new Date()))();
  const classification: CohortCountryClassificationRow[] = [];
  try {
    for (const entry of cohort) {
      const row = await classifyCohortCountry(repository, entry.countryAlpha2, now);
      classification.push({ country: entry.countryAlpha2, ...row });
    }
  } catch {
    return baseResult("database_error", input.dryRun, "Cohort classification could not be completed.");
  }

  const currentCountries = classification
    .filter((c) => c.classification === "current")
    .map((c) => c.country);
  const blockedCountries = classification
    .filter((c) => c.classification === "blocked")
    .map((c) => c.country);
  const insufficientEvidenceCountries = classification
    .filter((c) => c.classification === "insufficient_evidence")
    .map((c) => c.country);
  const needsWork = classification
    .filter((c) => c.classification === "needs_create" || c.classification === "needs_refresh")
    .map((c) => c.country);

  // Terminal cohort_complete requires the deep classifier to report every
  // cohort country `current`. Blocked / insufficient / needs-work all
  // prevent the terminal state.
  if (needsWork.length === 0 && blockedCountries.length === 0 && insufficientEvidenceCountries.length === 0) {
    return {
      ...baseResult("cohort_complete", input.dryRun),
      classification,
      currentCountries,
      remainingCountries: [],
      blockedCountries: [],
      insufficientEvidenceCountries: [],
      currentCount: currentCountries.length,
      remainingCount: 0,
    };
  }

  const candidate = needsWork.find((c) => !inFlightCountries.has(c));
  if (!candidate) {
    // Either everything is blocked/insufficient, or every needs-work
    // country is already being materialized in this process.
    return {
      ...baseResult("country_current", input.dryRun,
        needsWork.length === 0
          ? "No country is eligible for materialization in this cohort state."
          : "Every remaining country is being materialized by another in-process request; retry."),
      classification,
      currentCountries,
      blockedCountries,
      insufficientEvidenceCountries,
      remainingCountries: needsWork,
      currentCount: currentCountries.length,
      remainingCount: needsWork.length,
    };
  }

  inFlightCountries.add(candidate);
  let refreshResult: ScoreRefreshResult;
  try {
    const refreshFn = deps.refreshScore ?? refreshPersistedMarketScore;
    refreshResult = await refreshFn(
      { country: candidate, product: COHORT_MATERIALIZE_PRODUCT_ID, dryRun: input.dryRun },
      deps.refreshDependencies ?? {},
    );
  } finally {
    inFlightCountries.delete(candidate);
  }

  const outcome = mapOutcome(refreshResult.outcome);
  const isDryRun = input.dryRun;

  // Dry-run MUST NOT rewrite cohort progress state. Actual persisted
  // state is unchanged; only projectedOutcome differs.
  const projectedCountryResolves =
    !isDryRun &&
    (outcome === "country_current" ||
      outcome === "country_created" ||
      outcome === "country_refreshed");

  const nextCurrentCountries = projectedCountryResolves
    ? [...currentCountries, candidate]
    : currentCountries;
  const nextBlocked = !isDryRun && outcome === "country_blocked"
    ? [...blockedCountries, candidate]
    : blockedCountries;
  const nextInsufficient = !isDryRun && outcome === "country_insufficient_evidence"
    ? [...insufficientEvidenceCountries, candidate]
    : insufficientEvidenceCountries;
  const nextRemaining = projectedCountryResolves
    ? needsWork.filter((c) => c !== candidate)
    : needsWork;

  const responseOutcome: CohortMaterializeOutcome = isDryRun
    ? // Dry-run response outcome is *what would happen*; we surface it
      // both as `outcome` and separately as `projectedOutcome`.
      outcome
    : outcome;

  return {
    outcome: responseOutcome,
    dryRun: isDryRun,
    selectedCountry: candidate,
    processedCountry: isDryRun ? undefined : candidate,
    processedResult: {
      country: candidate,
      refreshOutcome: refreshResult.outcome,
      fit: refreshResult.fit ?? null,
      confidence: refreshResult.confidence ?? null,
      recommendationStatus: refreshResult.recommendationStatus,
      scoreId: refreshResult.scoreId ?? null,
      stale: refreshResult.stale,
      staleReasons: refreshResult.staleReasons,
      message: refreshResult.message,
    },
    projectedOutcome: isDryRun ? outcome : undefined,
    classification,
    currentCountries: nextCurrentCountries,
    remainingCountries: nextRemaining,
    blockedCountries: nextBlocked,
    insufficientEvidenceCountries: nextInsufficient,
    currentCount: nextCurrentCountries.length,
    remainingCount: nextRemaining.length,
    totalCount: COHORT_MATERIALIZE_TOTAL_COUNT,
    databaseWrites: refreshResult.databaseWrites,
    providerCalls: 0,
    marketFitVersion: MARKET_FIT_VERSION,
    dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
    productId: COHORT_MATERIALIZE_PRODUCT_ID,
    message: refreshResult.message,
  };
}

// ---------------------------------------------------------------------------
// Deep read-only cohort verification
// ---------------------------------------------------------------------------

export interface CohortVerificationRow {
  country: CountryAlpha2;
  hasCurrentScore: boolean;
  scoreId: string | null;
  marketFitVersion: string | null;
  dataConfidenceVersion: string | null;
  providerSelectionVersion: string | null;
  mappingRegistryVersion: string | null;
  fit: number | null;
  confidence: number | null;
  recommendationStatus: string | null;
  isTradeProxy: boolean;
  fitEligibility: string | null;
  mappingKind: string | null;
  componentCount: number;
  componentWeightSum: number;
  supportedWeight: number | null;
  authoritativeFit: number | null;
  authoritativeConfidence: number | null;
  authoritativeSupportedWeight: number | null;
  authoritativeComponentCount: number;
  authoritativeStale: boolean | null;
  authoritativeStaleReasons: string[];
  authoritativeRefreshOutcome: ScoreRefreshOutcome | null;
  authoritativeEvidenceWatermark: string | null;
  authoritativeMappingWatermark: string | null;
  passes: {
    scoreExists: boolean;
    marketFitVersionMatches: boolean;
    dataConfidenceVersionMatches: boolean;
    providerSelectionVersionMatches: boolean;
    mappingRegistryVersionMatches: boolean;
    evidenceWatermarkMatches: boolean;
    mappingWatermarkMatches: boolean;
    scoreNotStale: boolean;
    recommendationIsIndicative: boolean;
    hasSixComponents: boolean;
    componentWeightSumIs100: boolean;
    isTradeProxyTrue: boolean;
    fitMatchesAuthoritative: boolean;
    confidenceMatchesAuthoritative: boolean;
    supportedWeightMatchesAuthoritative: boolean;
  };
}

export interface CohortVerificationReport {
  totalCount: typeof COHORT_MATERIALIZE_TOTAL_COUNT;
  currentCount: number;
  countries: CohortVerificationRow[];
  allCurrent: boolean;
  allPass: boolean;
  productId: typeof COHORT_MATERIALIZE_PRODUCT_ID;
  marketFitVersion: typeof MARKET_FIT_VERSION;
  dataConfidenceVersion: typeof DATA_CONFIDENCE_VERSION;
  providerCalls: 0;
}

export interface CohortVerificationDependencies {
  repository: ClassifierRepository;
  /** Read-only dry-run authoritative recompute — never writes. */
  refreshScore?: typeof refreshPersistedMarketScore;
  refreshDependencies?: ScoreRefreshDependencies;
  now?: () => Date;
}

/** Deep read-only cohort verification. Never writes. */
export async function verifyCohortMaterialization(
  deps: CohortVerificationDependencies,
): Promise<CohortVerificationReport> {
  const cohort = calibrationCohort();
  const now = (deps.now ?? (() => new Date()))();
  const refresh = deps.refreshScore ?? refreshPersistedMarketScore;
  const countries: CohortVerificationRow[] = [];
  let allCurrent = true;
  let allPass = true;
  for (const entry of cohort) {
    const country = entry.countryAlpha2;
    const score = await deps.repository.getCurrentMarketScore(country, COHORT_MATERIALIZE_PRODUCT_ID);
    // Authoritative recompute via the MI1I dryRun path — proves both the
    // watermark contract AND the Fit/confidence values without writing.
    const authoritative = await refresh(
      { country, product: COHORT_MATERIALIZE_PRODUCT_ID, dryRun: true },
      deps.refreshDependencies ?? {},
    );

    const authoritativeEvidenceWatermark = authoritative.evidenceWatermark ?? null;
    const authoritativeMappingWatermark = authoritative.mappingWatermark ?? null;
    const componentWeightSum = (score?.components ?? []).reduce((sum, c) => sum + (c.weight ?? 0), 0);
    const supportedWeight = (score?.components ?? [])
      .filter((c) => c.supported)
      .reduce((sum, c) => sum + (c.weight ?? 0), 0);
    const mappingRegistryVersion =
      typeof score?.sourceCoverage.mapping_registry_version === "string"
        ? score.sourceCoverage.mapping_registry_version
        : null;
    const evidenceWatermarkPersisted =
      typeof score?.sourceCoverage.evidence_watermark === "string"
        ? score.sourceCoverage.evidence_watermark
        : null;
    const mappingWatermarkPersisted =
      typeof score?.sourceCoverage.mapping_watermark === "string"
        ? score.sourceCoverage.mapping_watermark
        : null;

    const passes = {
      scoreExists: Boolean(score),
      marketFitVersionMatches: score?.marketFitVersion === MARKET_FIT_VERSION,
      dataConfidenceVersionMatches: score?.confidenceVersion === DATA_CONFIDENCE_VERSION,
      providerSelectionVersionMatches: score?.providerSelectionVersion === MI_PROVIDER_SELECTION_VERSION,
      mappingRegistryVersionMatches: mappingRegistryVersion === MI_PRODUCT_MAPPING_VERSION,
      evidenceWatermarkMatches:
        Boolean(authoritativeEvidenceWatermark) &&
        evidenceWatermarkPersisted === authoritativeEvidenceWatermark,
      mappingWatermarkMatches:
        Boolean(authoritativeMappingWatermark) &&
        mappingWatermarkPersisted === authoritativeMappingWatermark,
      scoreNotStale: authoritative.preRefreshStale === false,
      recommendationIsIndicative: score?.recommendationStatus === "indicative",
      hasSixComponents: (score?.components.length ?? 0) === 6,
      componentWeightSumIs100: componentWeightSum === 100,
      isTradeProxyTrue: score?.isTradeProxy === true,
      fitMatchesAuthoritative:
        Boolean(score) &&
        (authoritative.fit ?? null) === (score!.publishedFitScore ?? null),
      confidenceMatchesAuthoritative:
        Boolean(score) &&
        (authoritative.confidence ?? null) === (score!.dataConfidenceScore ?? null),
      supportedWeightMatchesAuthoritative:
        typeof authoritative.supportedWeight === "number" &&
        supportedWeight === authoritative.supportedWeight,
    };
    const rowAllPass = Object.values(passes).every((v) => v === true);
    if (!passes.scoreExists || !passes.marketFitVersionMatches || !passes.scoreNotStale) {
      allCurrent = false;
    }
    if (!rowAllPass) allPass = false;

    countries.push({
      country,
      hasCurrentScore: Boolean(score),
      scoreId: score?.id ?? null,
      marketFitVersion: score?.marketFitVersion ?? null,
      dataConfidenceVersion: score?.confidenceVersion ?? null,
      providerSelectionVersion: score?.providerSelectionVersion ?? null,
      mappingRegistryVersion,
      fit: score?.publishedFitScore ?? null,
      confidence: score?.dataConfidenceScore ?? null,
      recommendationStatus: score?.recommendationStatus ?? null,
      isTradeProxy: score?.isTradeProxy ?? false,
      fitEligibility: score?.fitEligibility ?? null,
      mappingKind: score?.mappingKind ?? null,
      componentCount: score?.components.length ?? 0,
      componentWeightSum,
      supportedWeight,
      authoritativeFit: authoritative.fit ?? null,
      authoritativeConfidence: authoritative.confidence ?? null,
      authoritativeSupportedWeight: authoritative.supportedWeight ?? null,
      authoritativeComponentCount: authoritative.componentCount ?? 0,
      authoritativeStale: authoritative.preRefreshStale ?? null,
      authoritativeStaleReasons: authoritative.preRefreshStaleReasons ?? [],
      authoritativeRefreshOutcome: authoritative.outcome,
      authoritativeEvidenceWatermark,
      authoritativeMappingWatermark,
      passes,
    });
  }
  const currentCount = countries.filter((c) =>
    c.passes.scoreExists && c.passes.scoreNotStale && c.passes.marketFitVersionMatches,
  ).length;
  // Guard against a caller resetting `now` between the loop; we don't need it after.
  void now;
  return {
    totalCount: COHORT_MATERIALIZE_TOTAL_COUNT,
    currentCount,
    countries,
    allCurrent,
    allPass,
    productId: COHORT_MATERIALIZE_PRODUCT_ID,
    marketFitVersion: MARKET_FIT_VERSION,
    dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
    providerCalls: 0,
  };
}

async function loadRepositoryFromRequest() {
  const [{ cookies }, { createClient }, repositoryModule] = await Promise.all([
    import("next/headers"),
    import("@/utils/supabase/server"),
    import("../marketReadRepository"),
  ]);
  return repositoryModule.createMarketReadRepository(createClient(cookies()));
}

export function __resetCohortMaterializeInFlightForTests(): void {
  inFlightCountries.clear();
}
