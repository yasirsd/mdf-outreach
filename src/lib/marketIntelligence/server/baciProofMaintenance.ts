import "server-only";

import { requireMdfSession } from "@/lib/auth/require";
import { BaciProviderError } from "../providers/baci/normalize";
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

export interface BaciProofMaintenanceResult {
  outcome: BaciProofMaintenanceOutcome;
  message?: string;
  report?: BaciDevelopmentReport;
  fetches?: Record<string, "fetched" | "use_cache">;
  observations?: { created: number; existing: number };
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
      return { outcome: "configuration_error", message: MESSAGES.configuration_error };
    }
    if (error instanceof BaciProviderError) {
      return { outcome: error.outcome, message: MESSAGES[error.outcome] };
    }
    if (error && typeof error === "object" && "name" in error &&
      error.name === "MarketIntelligenceServiceRoleConfigError") {
      return { outcome: "configuration_error", message: MESSAGES.configuration_error };
    }
    return { outcome: "database_error", message: MESSAGES.database_error };
  }
}
