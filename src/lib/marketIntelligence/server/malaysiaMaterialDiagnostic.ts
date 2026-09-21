import "server-only";

import { requireMdfSession } from "@/lib/auth/require";
import type { MdfMembership } from "@/lib/auth/membership";
import type { MarketReadRepository } from "../marketReadRepository";
import {
  BACI_OEC_DATASET_ID,
  MALAYSIA_CHILLI_PRODUCT_ID,
  MALAYSIA_CHILLI_HS17_CODE,
  buildCountryChilliQuery,
} from "../providers/baci/contract";
import {
  compareBaciObservationMaterial,
  type MaterialComparisonSummary,
} from "../providers/baci/materialComparison";
import { fetchBaciYearMembers } from "../providers/baci/metadata";
import {
  BaciProviderError,
  normalizeBaciBilateralRows,
} from "../providers/baci/normalize";
import { createBaciProviderRequestCounter } from "../providers/baci/requestAccounting";
import {
  BaciOecConfigError,
  fetchBaciQuery,
  type BaciCompleteQueryResult,
  type BaciHttpOptions,
} from "../providers/baci/server";

export const MAX_DIAGNOSTIC_PROVIDER_REQUESTS = 2;

type DiagnosticRepository = Pick<
  MarketReadRepository,
  | "listActiveProductMappings"
  | "getSourceByProviderDataset"
  | "listBilateralAnnualMaterialObservations"
>;

export type MalaysiaMaterialDiagnosticOutcome =
  | "comparison_complete"
  | "unauthorised"
  | "forbidden"
  | "mapping_error"
  | "source_error"
  | "metadata_error"
  | "configuration_error"
  | "provider_error"
  | "quota_exhausted"
  | "timeout"
  | "invalid_request"
  | "partial"
  | "database_error";

export interface MalaysiaMaterialDiagnosticResult extends Partial<MaterialComparisonSummary> {
  outcome: MalaysiaMaterialDiagnosticOutcome;
  providerRequestsUsed: number;
  analyticalYears?: number[];
  productMappingRegistryVersion?: string;
  message?: string;
}

export interface MalaysiaMaterialDiagnosticDependencies {
  requireSession?: () => Promise<{ membership: MdfMembership }>;
  loadRepository?: () => Promise<DiagnosticRepository>;
  fetchYears?: typeof fetchBaciYearMembers;
  fetchQuery?: (
    spec: ReturnType<typeof buildCountryChilliQuery>,
    options: BaciHttpOptions,
  ) => Promise<BaciCompleteQueryResult>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

const MESSAGES: Record<Exclude<MalaysiaMaterialDiagnosticOutcome, "comparison_complete">, string> = {
  unauthorised: "MDF session required to run the Malaysia material diagnostic.",
  forbidden: "The Malaysia material diagnostic requires an MDF owner role.",
  mapping_error: "The canonical Malaysia chilli trade-proxy mapping is unavailable.",
  source_error: "The canonical BACI source or its verified storage rights are unavailable.",
  metadata_error: "BACI supported-year metadata is unavailable.",
  configuration_error: "The BACI/OEC server credential is not configured.",
  provider_error: "BACI/OEC could not complete the read-only diagnostic query.",
  quota_exhausted: "BACI/OEC free access is temporarily exhausted.",
  timeout: "BACI/OEC did not respond before the diagnostic timeout.",
  invalid_request: "BACI/OEC rejected the diagnostic query contract.",
  partial: "BACI/OEC returned a diagnostic result that could not be proven complete.",
  database_error: "Persisted Malaysia observations could not be read for comparison.",
};

/** Owner-only, dry-run comparison. No writer or ledger recorder is loaded. */
export async function runMalaysiaMaterialDiagnostic(
  deps: MalaysiaMaterialDiagnosticDependencies = {},
): Promise<MalaysiaMaterialDiagnosticResult> {
  let session;
  try {
    session = deps.requireSession ? await deps.requireSession() : await requireMdfSession();
  } catch {
    return failure("unauthorised", 0);
  }
  if (session.membership.role !== "owner") return failure("forbidden", 0);

  let repository: DiagnosticRepository;
  try {
    repository = deps.loadRepository
      ? await deps.loadRepository()
      : await loadRepositoryFromRequest();
  } catch {
    return failure("database_error", 0);
  }

  let registryVersion: string | undefined;
  try {
    const mappings = await repository.listActiveProductMappings();
    const mapping = mappings.find((candidate) =>
      candidate.mdfProductId === MALAYSIA_CHILLI_PRODUCT_ID &&
      candidate.hsRevision === "HS17" &&
      candidate.hsCode === MALAYSIA_CHILLI_HS17_CODE &&
      candidate.mappingKind === "proxy" &&
      candidate.fitEligibility === "proxy_allowed" &&
      candidate.isActive
    );
    if (!mapping) return failure("mapping_error", 0);
    registryVersion = mapping.registryVersion;

    const source = await repository.getSourceByProviderDataset("baci_oec", BACI_OEC_DATASET_ID);
    if (!source || source.providerId !== "baci_oec" || source.datasetId !== BACI_OEC_DATASET_ID ||
        !source.serviceTermsVerified || source.storageAllowed !== true || !source.licenceVerifiedAt) {
      return failure("source_error", 0, registryVersion);
    }
  } catch {
    return failure("database_error", 0, registryVersion);
  }

  const yearsResult = await (deps.fetchYears ?? fetchBaciYearMembers)({ fetchImpl: deps.fetchImpl });
  if (yearsResult.outcome !== "ok" || yearsResult.years.length === 0) {
    return failure("metadata_error", 0, registryVersion);
  }
  const analyticalYears = yearsResult.years;
  const spec = buildCountryChilliQuery("MY", analyticalYears);
  const transport = createBaciProviderRequestCounter(
    deps.fetchImpl ?? fetch,
    MAX_DIAGNOSTIC_PROVIDER_REQUESTS,
  );

  try {
    const fetched = await (deps.fetchQuery ?? fetchBaciQuery)(spec, {
      fetchImpl: transport.fetchImpl,
      env: deps.env,
      persistentIngestion: false,
    });
    const normalized = normalizeBaciBilateralRows(
      fetched.rows,
      (deps.now ?? (() => new Date()))().toISOString(),
    );
    const persisted = await repository.listBilateralAnnualMaterialObservations(
      "MY", "HS17", MALAYSIA_CHILLI_HS17_CODE, "baci_oec", BACI_OEC_DATASET_ID,
    );
    const comparison = compareBaciObservationMaterial(normalized, persisted, fetched.rows, 10);
    return {
      outcome: "comparison_complete",
      providerRequestsUsed: transport.requestsUsed(),
      analyticalYears,
      productMappingRegistryVersion: registryVersion,
      ...comparison,
    };
  } catch (error) {
    if (error instanceof BaciOecConfigError) {
      return failure("configuration_error", transport.requestsUsed(), registryVersion, analyticalYears);
    }
    if (error instanceof BaciProviderError) {
      return failure(error.outcome, transport.requestsUsed(), registryVersion, analyticalYears);
    }
    return failure("database_error", transport.requestsUsed(), registryVersion, analyticalYears);
  }
}

function failure(
  outcome: Exclude<MalaysiaMaterialDiagnosticOutcome, "comparison_complete">,
  providerRequestsUsed: number,
  productMappingRegistryVersion?: string,
  analyticalYears?: number[],
): MalaysiaMaterialDiagnosticResult {
  return {
    outcome,
    providerRequestsUsed,
    message: MESSAGES[outcome],
    ...(analyticalYears ? { analyticalYears } : {}),
    ...(productMappingRegistryVersion ? { productMappingRegistryVersion } : {}),
  };
}

async function loadRepositoryFromRequest(): Promise<DiagnosticRepository> {
  const [{ cookies }, { createClient }, repositoryModule] = await Promise.all([
    import("next/headers"),
    import("@/utils/supabase/server"),
    import("../marketReadRepository"),
  ]);
  return repositoryModule.createMarketReadRepository(createClient(cookies()));
}
