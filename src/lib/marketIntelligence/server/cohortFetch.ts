import "server-only";

/**
 * MI1F — Owner-gated calibration cohort fetch executor.
 *
 * Bounded resumable batches, server-authoritative, no client input.
 * Every provider call reuses the MI1D adapter, ledger, source, rights,
 * and writer stack. Nothing here writes production score tables or
 * touches Buyer Intelligence.
 *
 * Budgets:
 *   MAX_COUNTRIES_PER_INVOCATION           = 3
 *   MAX_PROVIDER_HTTP_REQUESTS_PER_INVOC.  = 6   (auth'd BACI /query)
 *   PROVIDER_METADATA_REQUESTS_PER_INVOC.  = 2   (year + importer roster,
 *                                                 counted separately)
 *
 *   Malaysia already has a fresh complete ledger row, so it should
 *   ALWAYS classify as `complete_fresh` on the first invocation and
 *   consume zero provider requests.
 */

import { requireMdfSession } from "@/lib/auth/require";
import type { MdfMembership } from "@/lib/auth/membership";
import { calibrationCohort } from "../calibration/cohort";
import { BaciProviderError } from "../providers/baci/normalize";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  buildCountryChilliQuery,
  baciQueryFingerprint,
} from "../providers/baci/contract";
import { createBaciProviderRequestCounter } from "../providers/baci/requestAccounting";
import type {
  MarketReadRepositoryObservation,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import { toBaciCountryId } from "../providers/baci/country";
import {
  fetchBaciImporterMembers,
  fetchBaciYearMembers,
} from "../providers/baci/metadata";
import { BaciOecConfigError } from "../providers/baci/server";
import type { CountryAlpha2, MarketProviderFetchLedgerEntry } from "../types";

export const MAX_COUNTRIES_PER_INVOCATION = 3;
export const MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION = 6;
/** Public-metadata reads used per invocation (year + importer roster). */
export const METADATA_HTTP_REQUESTS_PER_INVOCATION = 2;

/** MDF product bound to the controlled proxy calibration. */
const CANONICAL_PRODUCT_ID = "guntur-dry-red-chilli";
const CANONICAL_HS_REVISION = "HS17" as const;
const CANONICAL_HS_CODE = MALAYSIA_CHILLI_HS17_CODE;

const PRIVILEGED_MDF_ROLES: ReadonlySet<MdfMembership["role"]> = new Set(["owner"]);

export type CohortFetchOutcome =
  | "batch_completed"
  | "cohort_fetch_complete"
  | "unauthorised"
  | "forbidden"
  | "mapping_error"
  | "metadata_error"
  | "configuration_error"
  | "auth_stopped"
  | "quota_stopped"
  | "provider_stopped"
  | "unexpected_error";

export type CountryClassification =
  | "complete_fresh_exact"
  | "complete_fresh_compatible"
  | "needs_fetch"
  | "unavailable"
  | "blocked"
  | "skipped_budget";

export type CountryResult =
  | "use_cache"
  | "fetched"
  | "empty"
  | "unavailable"
  | "blocked"
  | "provider_error"
  | "invalid_request"
  | "quota_exhausted"
  | "timeout"
  | "partial"
  | "material_mismatch"
  | "source_conflict"
  | "cache_incomplete"
  | "skipped_budget";

export interface ProcessedCountry {
  country: CountryAlpha2;
  result: CountryResult;
  observationsCreated: number;
  observationsExisting: number;
  rowsReceived?: number;
  reason?: string;
}

export interface CohortFetchBatchResult {
  outcome: CohortFetchOutcome;
  analyticalYears: number[];
  processed: ProcessedCountry[];
  alreadyComplete: CountryAlpha2[];
  unavailable: CountryAlpha2[];
  blocked: Array<{ country: CountryAlpha2; reason: string }>;
  remaining: CountryAlpha2[];
  moreRemaining: boolean;
  providerRequestsUsed: number;
  metadataRequestsUsed: number;
  productMappingRegistryVersion?: string;
  message?: string;
}

/** Minimal repository shape consumed by the cohort orchestrator. */
export interface CohortRepositoryLike {
  listActiveProductMappings: () => Promise<Array<{
    mdfProductId: string;
    hsRevision: string;
    hsCode: string;
    mappingKind: "exact" | "proxy" | "composite";
    fitEligibility: "exact" | "proxy_allowed" | "insufficient_specificity";
    isActive: boolean;
    registryVersion?: string;
  }>>;
  listRecentLedgerEntriesForFingerprint: (
    providerId: string, datasetId: string, queryFingerprint: string, limit?: number,
  ) => Promise<MarketProviderFetchLedgerEntry[]>;
  listRecentLedgerEntriesForReporter: (
    providerId: string, datasetId: string, reporterCountry: CountryAlpha2, limit?: number,
  ) => Promise<MarketProviderFetchLedgerEntry[]>;
  getSourceByProviderDataset: (
    providerId: string, datasetId: string,
  ) => Promise<MarketReadRepositorySource | undefined>;
  listBilateralAnnualObservations: (
    countryAlpha2: CountryAlpha2,
    hsRevision: "HS17",
    hsCode: string,
    providerId: string,
    datasetId: string,
  ) => Promise<MarketReadRepositoryObservation[]>;
}

export type CohortProofOutcome =
  | { outcome: "completed"; fetches?: Record<string, "fetched" | "use_cache">; observations?: { created: number; existing: number } }
  | { outcome: "blocked"; reason: string }
  | { outcome: "source_conflict" }
  | { outcome: "observation_conflict"; reason: "material_mismatch" }
  | { outcome: "cache_incomplete" };

export interface CohortFetchDependencies {
  requireSession?: () => Promise<{ membership: MdfMembership }>;
  loadRepository?: () => Promise<CohortRepositoryLike & Record<string, unknown>>;
  loadWriter?: () => Promise<Record<string, unknown>>;
  loadProofExecutor?: () => Promise<{
    executeControlledChilliProof: (
      spec: ReturnType<typeof buildCountryChilliQuery>,
      deps: { repository: unknown; writer: unknown; now?: () => Date; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
    ) => Promise<CohortProofOutcome>;
  }>;
  fetchMetadata?: {
    fetchYearMembers?: typeof fetchBaciYearMembers;
    fetchImporterMembers?: typeof fetchBaciImporterMembers;
  };
  now?: () => Date;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

interface ClassifiedCountry {
  countryAlpha2: CountryAlpha2;
  baciImporterId: string;
  classification: CountryClassification;
  reason?: string;
}

const FRESH_LEDGER_OUTCOMES: ReadonlySet<string> = new Set(["success", "empty"]);

function sourceRightsAreValid(source: MarketReadRepositorySource | undefined): boolean {
  return Boolean(
    source &&
    source.providerId === "baci_oec" &&
    source.datasetId === BACI_OEC_DATASET_ID &&
    source.serviceTermsVerified &&
    source.storageAllowed === true &&
    source.licenceVerifiedAt,
  );
}

function inclusiveYearSet(entry: MarketProviderFetchLedgerEntry): Set<number> | undefined {
  const start = Number(entry.coverageStart);
  const end = Number(entry.coverageEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return undefined;
  return new Set(Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

function compatibleLedgerIdentity(
  entry: MarketProviderFetchLedgerEntry,
  reporterCountry: CountryAlpha2,
): boolean {
  return entry.providerId === "baci_oec" &&
    entry.datasetId === BACI_OEC_DATASET_ID &&
    entry.reporterCountry === reporterCountry &&
    entry.partnerCountry === null &&
    entry.tradeFlow === "import" &&
    entry.hsRevision === CANONICAL_HS_REVISION &&
    entry.hsCodes.length === 1 &&
    entry.hsCodes[0] === CANONICAL_HS_CODE &&
    entry.frequency === "annual";
}

function persistedRowsSatisfyCompatibleLedger(
  rows: readonly MarketReadRepositoryObservation[],
  entry: MarketProviderFetchLedgerEntry,
  reporterCountry: CountryAlpha2,
  supportedYears: ReadonlySet<number>,
): boolean {
  if (rows.length !== entry.rowsReceived) return false;
  const identities = new Set<string>();
  for (const row of rows) {
    const year = Number(row.period);
    if (
      row.providerId !== entry.providerId ||
      row.datasetId !== entry.datasetId ||
      row.reporterCountry !== reporterCountry ||
      row.partnerCountry === null ||
      row.tradeFlow !== entry.tradeFlow ||
      row.hsRevision !== entry.hsRevision ||
      row.hsCode !== CANONICAL_HS_CODE ||
      row.frequency !== entry.frequency ||
      !Number.isInteger(year) ||
      !supportedYears.has(year)
    ) return false;
    const identity = `${row.period}|${row.partnerCountry}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

/**
 * Find a fresh historical query whose exact identity remains untouched but
 * whose wider annual window safely satisfies the current metadata window.
 */
async function findCompatibleFreshLedger(
  repository: CohortRepositoryLike,
  reporterCountry: CountryAlpha2,
  analyticalYears: readonly number[],
  now: Date,
): Promise<MarketProviderFetchLedgerEntry | undefined> {
  const supportedYears = new Set(analyticalYears);
  const candidates = await repository.listRecentLedgerEntriesForReporter(
    "baci_oec", BACI_OEC_DATASET_ID, reporterCountry, 25,
  );
  // A failed/stale latest attempt for a fingerprint must not expose an older
  // successful row for that same fingerprint.
  const latestByFingerprint = new Map<string, MarketProviderFetchLedgerEntry>();
  for (const candidate of candidates) {
    if (!latestByFingerprint.has(candidate.queryFingerprint)) {
      latestByFingerprint.set(candidate.queryFingerprint, candidate);
    }
  }
  if (latestByFingerprint.size === 0) return undefined;

  const source = await repository.getSourceByProviderDataset("baci_oec", BACI_OEC_DATASET_ID);
  if (!sourceRightsAreValid(source)) return undefined;
  const rows = await repository.listBilateralAnnualObservations(
    reporterCountry, CANONICAL_HS_REVISION, CANONICAL_HS_CODE,
    "baci_oec", BACI_OEC_DATASET_ID,
  );

  for (const candidate of latestByFingerprint.values()) {
    const freshUntil = Date.parse(candidate.freshUntil);
    if (
      !compatibleLedgerIdentity(candidate, reporterCountry) ||
      !FRESH_LEDGER_OUTCOMES.has(candidate.outcome) ||
      !Number.isFinite(freshUntil) ||
      freshUntil <= now.getTime()
    ) continue;
    const priorYears = inclusiveYearSet(candidate);
    if (!priorYears) continue;
    // Current provider support must be wholly covered by the old request.
    if (analyticalYears.some((year) => !priorYears.has(year))) continue;
    // Metadata is the authority for support: every prior year outside the
    // current set is therefore explicitly unsupported in this invocation.
    const excludedPriorYears = [...priorYears].filter((year) => !supportedYears.has(year));
    if (!excludedPriorYears.every((year) => !supportedYears.has(year))) continue;
    if (!persistedRowsSatisfyCompatibleLedger(rows, candidate, reporterCountry, supportedYears)) continue;
    return candidate;
  }
  return undefined;
}

function isPrivilegedMember(m: MdfMembership | undefined | null): boolean {
  if (!m) return false;
  return PRIVILEGED_MDF_ROLES.has(m.role);
}

/**
 * Read the latest ledger row for the exact query fingerprint. FRESH
 * cache = `success` OR `empty` AND `fresh_until` in the future.
 */
function isLedgerFreshComplete(
  entries: readonly MarketProviderFetchLedgerEntry[],
  now: Date,
): { fresh: boolean; latest?: MarketProviderFetchLedgerEntry } {
  if (entries.length === 0) return { fresh: false };
  const latest = entries[0]!;
  const freshUntil = Date.parse(latest.freshUntil);
  if (!Number.isFinite(freshUntil) || freshUntil <= now.getTime()) return { fresh: false, latest };
  return { fresh: FRESH_LEDGER_OUTCOMES.has(latest.outcome), latest };
}

/**
 * Owner-gated resumable batch. Returns a safe, sanitized response
 * describing what was done and what remains.
 */
export async function runCohortFetchBatch(
  deps: CohortFetchDependencies = {},
): Promise<CohortFetchBatchResult> {
  const now = deps.now ?? (() => new Date());
  const cohort = calibrationCohort();

  // 1) Session + role gate.
  let session;
  try {
    session = deps.requireSession
      ? await deps.requireSession()
      : await requireMdfSession();
  } catch {
    return baseResult("unauthorised", cohort.map((c) => c.countryAlpha2));
  }
  if (!isPrivilegedMember(session.membership)) {
    return baseResult("forbidden", cohort.map((c) => c.countryAlpha2));
  }

  // 2) Repository + writer + product-mapping authority.
  const repositoryLoader = deps.loadRepository ?? loadRepositoryFromRequest;
  const writerLoader = deps.loadWriter ?? loadWriterModule;
  const proofLoader = deps.loadProofExecutor ?? loadProofExecutorModule;

  let repository;
  let writer;
  try {
    repository = await repositoryLoader();
    writer = await writerLoader();
  } catch (error) {
    if (
      error && typeof error === "object" && "name" in error &&
      (error as { name?: string }).name === "MarketIntelligenceServiceRoleConfigError"
    ) {
      return baseResult("configuration_error", cohort.map((c) => c.countryAlpha2));
    }
    return baseResult("configuration_error", cohort.map((c) => c.countryAlpha2));
  }

  // 3) Product-mapping authority — proxy 090421 must be active.
  const mappings = await repository.listActiveProductMappings();
  const mapping = mappings.find(
    (m) => m.mdfProductId === CANONICAL_PRODUCT_ID
      && m.hsRevision === CANONICAL_HS_REVISION
      && m.hsCode === CANONICAL_HS_CODE
      && m.isActive
      && m.mappingKind === "proxy"
      && m.fitEligibility === "proxy_allowed",
  );
  if (!mapping) {
    return {
      ...baseResult("mapping_error", cohort.map((c) => c.countryAlpha2)),
      message:
        "Active proxy mapping for guntur-dry-red-chilli / HS17 090421 not found; refusing to fetch.",
    };
  }

  // 4) Provider metadata (public, no auth). Fail closed if it errors —
  // we won't spend authenticated request budget without knowing the
  // supported years and importer roster.
  const metadataFetchers = deps.fetchMetadata ?? {};
  const yearRes = await (metadataFetchers.fetchYearMembers ?? fetchBaciYearMembers)({
    fetchImpl: deps.fetchImpl,
  });
  const importerRes = await (metadataFetchers.fetchImporterMembers ?? fetchBaciImporterMembers)({
    fetchImpl: deps.fetchImpl,
  });
  const metadataRequestsUsed = 2;
  if (yearRes.outcome !== "ok" || importerRes.outcome !== "ok") {
    return {
      ...baseResult("metadata_error", cohort.map((c) => c.countryAlpha2)),
      metadataRequestsUsed,
      message: `BACI metadata unavailable (year=${yearRes.outcome} importer=${importerRes.outcome}).`,
      productMappingRegistryVersion: mapping.registryVersion,
    };
  }
  const analyticalYears = yearRes.years;
  const importerRoster = new Set(importerRes.importerIds);

  // 5) Classify every cohort country.
  const classified: ClassifiedCountry[] = [];
  for (const entry of cohort) {
    if (!importerRoster.has(entry.baciImporterId)) {
      classified.push({
        countryAlpha2: entry.countryAlpha2,
        baciImporterId: entry.baciImporterId,
        classification: "unavailable",
        reason: "importer_not_on_roster",
      });
      continue;
    }
    const spec = buildCountryChilliQuery(entry.countryAlpha2, analyticalYears);
    const fingerprint = baciQueryFingerprint(spec);
    const entries = await repository.listRecentLedgerEntriesForFingerprint(
      "baci_oec", BACI_OEC_DATASET_ID, fingerprint, 1,
    );
    const { fresh, latest } = isLedgerFreshComplete(entries, now());
    if (fresh) {
      classified.push({
        countryAlpha2: entry.countryAlpha2,
        baciImporterId: entry.baciImporterId,
        classification: "complete_fresh_exact",
      });
    } else if (latest && !FRESH_LEDGER_OUTCOMES.has(latest.outcome) &&
        Date.parse(latest.freshUntil) > now().getTime()) {
      classified.push({
        countryAlpha2: entry.countryAlpha2,
        baciImporterId: entry.baciImporterId,
        classification: "blocked",
        reason: latest.outcome,
      });
    } else if (await findCompatibleFreshLedger(
      repository, entry.countryAlpha2, analyticalYears, now(),
    )) {
      classified.push({
        countryAlpha2: entry.countryAlpha2,
        baciImporterId: entry.baciImporterId,
        classification: "complete_fresh_compatible",
      });
    } else {
      classified.push({
        countryAlpha2: entry.countryAlpha2,
        baciImporterId: entry.baciImporterId,
        classification: "needs_fetch",
      });
    }
  }

  const alreadyComplete = classified.filter((c) =>
    c.classification === "complete_fresh_exact" || c.classification === "complete_fresh_compatible"
  ).map((c) => c.countryAlpha2);
  const unavailable = classified.filter((c) => c.classification === "unavailable").map((c) => c.countryAlpha2);
  const blocked = classified.filter((c) => c.classification === "blocked").map((c) => ({
    country: c.countryAlpha2, reason: c.reason ?? "blocked",
  }));
  const needsFetch = classified.filter((c) => c.classification === "needs_fetch");

  if (needsFetch.length === 0) {
    return {
      outcome: "cohort_fetch_complete",
      analyticalYears,
      processed: [],
      alreadyComplete,
      unavailable,
      blocked,
      remaining: [],
      moreRemaining: false,
      providerRequestsUsed: 0,
      metadataRequestsUsed,
      productMappingRegistryVersion: mapping.registryVersion,
    };
  }

  // 6) Bounded selection.
  const selected = needsFetch.slice(0, MAX_COUNTRIES_PER_INVOCATION);
  const processed: ProcessedCountry[] = [];
  const executor = await proofLoader();
  let stopReason: CohortFetchOutcome | null = null;
  const providerTransport = createBaciProviderRequestCounter(
    deps.fetchImpl ?? fetch,
    MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION,
  );

  for (const entry of selected) {
    // Reserve 2 request slots (worst case = 2 pages).
    if (providerTransport.requestsUsed() + 2 > MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION) {
      break;
    }
    const spec = buildCountryChilliQuery(entry.countryAlpha2, analyticalYears);
    try {
      const execDeps: {
        repository: unknown; writer: unknown; now?: () => Date;
        fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv;
      } = { repository, writer, now, fetchImpl: providerTransport.fetchImpl, env: deps.env };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await executor.executeControlledChilliProof(spec, execDeps as any);
      if (result.outcome === "completed") {
        const observations = result.observations ?? { created: 0, existing: 0 };
        const use_cache_hit = result.fetches?.canonical_bilateral === "use_cache";
        processed.push({
          country: entry.countryAlpha2,
          result: use_cache_hit ? "use_cache" : (observations.created === 0 && observations.existing === 0 ? "empty" : "fetched"),
          observationsCreated: observations.created,
          observationsExisting: observations.existing,
        });
        continue;
      }
      if (result.outcome === "source_conflict") {
        stopReason = "provider_stopped";
        processed.push({
          country: entry.countryAlpha2,
          result: "source_conflict",
          observationsCreated: 0,
          observationsExisting: 0,
          reason: "source_provenance_conflict",
        });
        break;
      }
      if (result.outcome === "observation_conflict") {
        // Material mismatch → country-level failure; stop for operator review.
        stopReason = "provider_stopped";
        processed.push({
          country: entry.countryAlpha2,
          result: "material_mismatch",
          observationsCreated: 0,
          observationsExisting: 0,
          reason: result.reason,
        });
        break;
      }
      if (result.outcome === "cache_incomplete") {
        processed.push({
          country: entry.countryAlpha2,
          result: "cache_incomplete",
          observationsCreated: 0,
          observationsExisting: 0,
        });
        continue;
      }
      if (result.outcome === "blocked") {
        processed.push({
          country: entry.countryAlpha2,
          result: "blocked",
          observationsCreated: 0,
          observationsExisting: 0,
          reason: result.reason,
        });
        continue;
      }
      // Any other outcome is treated as an unknown provider outcome → stop.
      processed.push({
        country: entry.countryAlpha2,
        result: "provider_error",
        observationsCreated: 0,
        observationsExisting: 0,
        reason: String((result as { outcome?: unknown }).outcome ?? "unknown"),
      });
      stopReason = "provider_stopped";
      break;
    } catch (error) {
      // Config error at the writer (missing server credential) → stop.
      if (error instanceof BaciOecConfigError) {
        return {
          outcome: "configuration_error",
          analyticalYears,
          processed,
          alreadyComplete,
          unavailable,
          blocked,
          remaining: canonicalRemaining(needsFetch.map((c) => c.countryAlpha2), processed),
          moreRemaining: true,
          providerRequestsUsed: providerTransport.requestsUsed(),
          metadataRequestsUsed,
          productMappingRegistryVersion: mapping.registryVersion,
          message: "BACI provider credential missing on the server.",
        };
      }
      if (error instanceof BaciProviderError) {
        const perCountry: CountryResult = ((): CountryResult => {
          switch (error.outcome) {
            case "invalid_request": return "invalid_request";
            case "provider_error": return "provider_error";
            case "quota_exhausted": return "quota_exhausted";
            case "timeout": return "timeout";
            case "partial": return "partial";
            default: return "provider_error";
          }
        })();
        processed.push({
          country: entry.countryAlpha2,
          result: perCountry,
          observationsCreated: 0,
          observationsExisting: 0,
          reason: error.reason ?? error.diagnostic?.category,
        });
        // Systemic errors stop the whole batch.
        if (
          error.outcome === "quota_exhausted" ||
          error.diagnostic?.category === "auth_error" ||
          error.diagnostic?.category === "network_error" ||
          error.diagnostic?.category === "upstream_error"
        ) {
          stopReason = error.outcome === "quota_exhausted"
            ? "quota_stopped"
            : error.diagnostic?.category === "auth_error"
              ? "auth_stopped"
              : "provider_stopped";
          break;
        }
        // Otherwise a per-country invalid_request / partial → continue.
        continue;
      }
      // Anything else → stop safely.
      return {
        outcome: "unexpected_error",
        analyticalYears,
        processed,
        alreadyComplete,
        unavailable,
        blocked,
        remaining: canonicalRemaining(needsFetch.map((c) => c.countryAlpha2), processed),
        moreRemaining: true,
        providerRequestsUsed: providerTransport.requestsUsed(),
        metadataRequestsUsed,
        productMappingRegistryVersion: mapping.registryVersion,
      };
    }
  }

  const finalRemainder = canonicalRemaining(
    needsFetch.map((c) => c.countryAlpha2), processed,
  );
  const outcome: CohortFetchOutcome =
    stopReason ??
    (finalRemainder.length === 0 && processed.length > 0 && processed.every((p) => p.result !== "provider_error")
      ? "batch_completed"
      : "batch_completed");

  return {
    outcome,
    analyticalYears,
    processed,
    alreadyComplete,
    unavailable,
    blocked,
    remaining: finalRemainder,
    moreRemaining: finalRemainder.length > 0,
    providerRequestsUsed: providerTransport.requestsUsed(),
    metadataRequestsUsed,
    productMappingRegistryVersion: mapping.registryVersion,
  };
}

function canonicalRemaining(
  needsFetch: CountryAlpha2[],
  processed: ProcessedCountry[],
): CountryAlpha2[] {
  const done = new Set(
    processed.filter((p) => p.result === "fetched" || p.result === "use_cache" || p.result === "empty")
      .map((p) => p.country),
  );
  // needsFetch was projected from calibrationCohort(), so filtering this
  // authoritative sequence preserves canonical order for retries and skips.
  return needsFetch.filter((country) => !done.has(country));
}

function baseResult(
  outcome: CohortFetchOutcome, remaining: CountryAlpha2[],
): CohortFetchBatchResult {
  return {
    outcome,
    analyticalYears: [],
    processed: [],
    alreadyComplete: [],
    unavailable: [],
    blocked: [],
    remaining,
    moreRemaining: remaining.length > 0,
    providerRequestsUsed: 0,
    metadataRequestsUsed: 0,
  };
}

/**
 * Default repository loader — reads via the request-scoped Supabase
 * client, exactly as `runControlledBaciProof()` does. Kept mockable for
 * tests through `CohortFetchDependencies.loadRepository`.
 */
async function loadRepositoryFromRequest() {
  const [{ cookies }, { createClient }, repositoryModule] = await Promise.all([
    import("next/headers"),
    import("@/utils/supabase/server"),
    import("../marketReadRepository"),
  ]);
  const supabase = createClient(cookies());
  return repositoryModule.createMarketReadRepository(supabase);
}

async function loadWriterModule() {
  const writerModule = await import("./writer");
  return writerModule.getMarketIntelligenceWriter();
}

async function loadProofExecutorModule() {
  const proofModule = await import("../providers/baci/proofExecution");
  return { executeControlledChilliProof: proofModule.executeControlledChilliProof };
}
