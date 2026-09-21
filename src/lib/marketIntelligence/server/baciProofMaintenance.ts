import "server-only";

import { requireMdfSession } from "@/lib/auth/require";
import {
  BaciProviderError,
  type BaciErrorDiagnostic,
} from "../providers/baci/normalize";
import {
  BACI_OEC_DATASET_ID,
  BACI_LATEST_VERIFIED_YEAR,
  BACI_NATIVE_HS17_START_YEAR,
  MALAYSIA_CHILLI_HS17_CODE,
} from "../providers/baci/contract";
import type { BaciDevelopmentReport } from "../providers/baci/report";
import { BaciOecConfigError } from "../providers/baci/server";

export type BaciProofMaintenanceOutcome =
  | "completed"
  | "unauthorised"
  | "forbidden"
  | "configuration_error"
  | "blocked"
  | "provider_error"
  | "quota_exhausted"
  | "timeout"
  | "invalid_request"
  | "partial"
  | "source_conflict"
  | "observation_conflict"
  | "cache_incomplete"
  | "database_error"
  | "unexpected_server_error";

/**
 * Sanitized, browser-safe diagnostic surfaced when a provider failure
 * carries a classified cause. Never contains the API key, cookies, JWTs,
 * or full upstream bodies — only the operator-actionable classification
 * fields the provider already exposed through documented status codes.
 */
export interface BaciProofMaintenanceDiagnostic {
  stage: BaciErrorDiagnostic["stage"];
  category?: BaciErrorDiagnostic["category"];
  httpStatus?: number;
  responseContentType?: string;
  providerRequestId?: string;
  sanitizedBody?: string;
  scope: {
    dataset: string;
    importer: string;
    hsCode: string;
    yearsStart: number;
    yearsEnd: number;
  };
}

export interface BaciProofMaintenanceResult {
  outcome: BaciProofMaintenanceOutcome;
  message?: string;
  report?: BaciDevelopmentReport;
  fetches?: Record<string, "fetched" | "use_cache">;
  observations?: { created: number; existing: number };
  diagnostic?: BaciProofMaintenanceDiagnostic;
}

const MESSAGES: Record<Exclude<BaciProofMaintenanceOutcome, "completed">, string> = {
  unauthorised: "MDF session required to run the controlled BACI proof.",
  forbidden: "The controlled BACI proof requires an MDF owner role.",
  configuration_error: "The BACI/OEC server credential or Market Intelligence writer is not configured.",
  blocked: "The fetch ledger blocked this provider request.",
  provider_error: "BACI/OEC could not complete the controlled query.",
  quota_exhausted: "BACI/OEC free access is temporarily exhausted.",
  timeout: "BACI/OEC did not respond before the request timeout.",
  invalid_request: "BACI/OEC rejected the controlled query contract.",
  partial: "BACI/OEC returned a result that could not be proven complete.",
  source_conflict: "The registered BACI source provenance conflicts with the verified contract.",
  observation_conflict: "A persisted observation has different material values; nothing was overwritten.",
  cache_incomplete: "The fetch ledger is fresh but the persisted proof observations are incomplete.",
  database_error: "Market Intelligence persistence could not complete the controlled proof.",
  unexpected_server_error: "The controlled BACI proof could not be completed.",
};

/** Owner-only authority for the fixed Malaysia × HS17 090421 proof. */
export async function runControlledBaciProof(): Promise<BaciProofMaintenanceResult> {
  let session;
  try {
    session = await requireMdfSession();
  } catch {
    return { outcome: "unauthorised", message: MESSAGES.unauthorised };
  }
  if (session.membership.role !== "owner") {
    return { outcome: "forbidden", message: MESSAGES.forbidden };
  }

  try {
    const [{ cookies }, { createClient }, repositoryModule, writerModule, proofModule] =
      await Promise.all([
        import("next/headers"),
        import("@/utils/supabase/server"),
        import("../marketReadRepository"),
        import("./writer"),
        import("../providers/baci/proofExecution"),
      ]);
    const repository = repositoryModule.createMarketReadRepository(createClient(cookies()));
    const writer = writerModule.getMarketIntelligenceWriter();
    const result = await proofModule.executeControlledMalaysiaChilliProof({ repository, writer });
    if (result.outcome === "completed") {
      return {
        outcome: "completed",
        report: result.report,
        fetches: result.fetches,
        observations: result.observations,
      };
    }
    return { outcome: result.outcome, message: MESSAGES[result.outcome] };
  } catch (error) {
    if (error instanceof BaciOecConfigError) {
      // eslint-disable-next-line no-console
      console.error(baciLogLine("configuration_error", { stage: "provider_http" }));
      return { outcome: "configuration_error", message: MESSAGES.configuration_error };
    }
    if (error instanceof BaciProviderError) {
      const diagnostic = toBaciMaintenanceDiagnostic(error.diagnostic);
      // eslint-disable-next-line no-console
      console.error(baciLogLine(error.outcome, error.diagnostic, error.reason));
      return {
        outcome: error.outcome,
        message: MESSAGES[error.outcome],
        ...(diagnostic ? { diagnostic } : {}),
      };
    }
    if (error && typeof error === "object" && "name" in error &&
      error.name === "MarketIntelligenceServiceRoleConfigError") {
      // eslint-disable-next-line no-console
      console.error(baciLogLine("configuration_error", { stage: "provider_http" }, "writer_config"));
      return { outcome: "configuration_error", message: MESSAGES.configuration_error };
    }
    // eslint-disable-next-line no-console
    console.error(baciLogLine("database_error", undefined, "unknown"));
    return { outcome: "database_error", message: MESSAGES.database_error };
  }
}

const SCOPE = Object.freeze({
  dataset: BACI_OEC_DATASET_ID,
  importer: "mys",
  hsCode: MALAYSIA_CHILLI_HS17_CODE,
  yearsStart: BACI_NATIVE_HS17_START_YEAR,
  yearsEnd: BACI_LATEST_VERIFIED_YEAR,
});

function toBaciMaintenanceDiagnostic(
  diagnostic?: BaciErrorDiagnostic,
): BaciProofMaintenanceDiagnostic | undefined {
  if (!diagnostic) return undefined;
  return {
    stage: diagnostic.stage,
    category: diagnostic.category,
    httpStatus: diagnostic.httpStatus,
    responseContentType: diagnostic.responseContentType,
    providerRequestId: diagnostic.providerRequestId,
    sanitizedBody: diagnostic.sanitizedBody,
    scope: SCOPE,
  };
}

/**
 * Structured, sanitized single-line server log. Never contains the API
 * key, cookies, JWTs, or full upstream bodies — only the classification
 * fields required to diagnose the failure. Kept as one line so it survives
 * Vercel/Cloudflare log ingestion without truncation.
 */
function baciLogLine(
  outcome: BaciProofMaintenanceOutcome,
  diagnostic?: BaciErrorDiagnostic,
  reason?: string,
): string {
  const parts: string[] = [
    `[BACI proof]`,
    `outcome=${outcome}`,
    `dataset=${SCOPE.dataset}`,
    `importer=${SCOPE.importer}`,
    `hs=${SCOPE.hsCode}`,
    `years=${SCOPE.yearsStart}-${SCOPE.yearsEnd}`,
  ];
  if (diagnostic?.stage) parts.push(`stage=${diagnostic.stage}`);
  if (diagnostic?.category) parts.push(`category=${diagnostic.category}`);
  if (diagnostic?.httpStatus !== undefined) parts.push(`http=${diagnostic.httpStatus}`);
  if (diagnostic?.responseContentType) parts.push(`content_type=${diagnostic.responseContentType}`);
  if (diagnostic?.providerRequestId) parts.push(`provider_request=${diagnostic.providerRequestId}`);
  if (reason) parts.push(`reason=${reason}`);
  if (diagnostic?.sanitizedBody) parts.push(`body="${diagnostic.sanitizedBody}"`);
  return parts.join(" ");
}
