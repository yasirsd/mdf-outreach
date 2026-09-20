import "server-only";

import { requireMdfSession } from "@/lib/auth/require";
import type { MdfMembership } from "@/lib/auth/membership";
import {
  MI_PRODUCT_MAPPING_VERSION,
  ProductTradeMappingSnapshotError,
  serializeProductTradeMappingsSnapshot,
} from "../product";
import type { ProductTradeMappingSyncSummary } from "./types";

/** The single application-level authority for global mapping maintenance. */
const PRIVILEGED_MDF_ROLES: ReadonlySet<MdfMembership["role"]> = new Set(["owner"]);

export type SyncMarketProductMappingsOutcome =
  | "synced"
  | "unauthorised"
  | "forbidden"
  | "invalid_registry"
  | "configuration_error"
  | "authorization_error"
  | "rpc_error"
  | "database_permission_error"
  | "network_error"
  | "unexpected_server_error";

export interface SyncMarketProductMappingsResult {
  outcome: SyncMarketProductMappingsOutcome;
  registryVersion: string;
  summary?: ProductTradeMappingSyncSummary;
  message?: string;
}

/**
 * Server-side classification of an RPC failure. Never surfaced to the
 * browser verbatim — the maintenance layer maps it to a sanitized
 * outcome + message. Logged (also sanitized) so an operator inspecting
 * server logs can see WHY a sync failed without exposing PostgREST /
 * secret internals to the client.
 */
export interface MarketSyncRpcClassification {
  outcome:
    | "authorization_error"
    | "rpc_error"
    | "database_permission_error"
    | "network_error"
    | "unexpected_server_error";
  code?: string;
  logLabel: string;
}

/**
 * Public for testing only. Pure function: given a caught error shape,
 * return the internal classification without leaking sensitive detail.
 */
export function classifySyncFailure(error: unknown): MarketSyncRpcClassification {
  const asRecord = (error ?? {}) as {
    message?: unknown;
    code?: unknown;
    name?: unknown;
    cause?: { code?: unknown };
  };
  const message = typeof asRecord.message === "string" ? asRecord.message : "";
  const code = typeof asRecord.code === "string" ? asRecord.code : undefined;
  const name = typeof asRecord.name === "string" ? asRecord.name : "";
  const causeCode =
    asRecord.cause && typeof asRecord.cause.code === "string" ? asRecord.cause.code : undefined;

  // Network / DNS / TCP / TLS shapes surfaced by node-fetch and undici.
  if (name === "AbortError" || name === "TypeError") {
    if (
      /fetch failed|network|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
        message,
      ) ||
      /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(causeCode ?? "")
    ) {
      return { outcome: "network_error", code: code ?? causeCode, logLabel: "network" };
    }
  }

  // PostgREST/PostgreSQL error codes:
  //   42501 = insufficient_privilege — service_role missing EXECUTE on RPC.
  //   28000 / PGRST301 = jwt/apikey rejected → authorization surface.
  //   PGRST202 / 42883 = function not found (schema cache stale or wrong project).
  if (code === "42501") {
    return { outcome: "database_permission_error", code, logLabel: "42501" };
  }
  if (code === "28000" || code === "PGRST301") {
    return { outcome: "authorization_error", code, logLabel: code };
  }
  if (code === "PGRST202" || code === "42883") {
    return { outcome: "rpc_error", code, logLabel: `${code}:function_not_found` };
  }
  if (code) {
    return { outcome: "rpc_error", code, logLabel: `code:${code}` };
  }
  // Fall through — a plain thrown Error with no code (our writer's
  // `throw new Error(scrub(error.message))`), or anything unclassified.
  if (/permission|not permitted|insufficient/i.test(message)) {
    return { outcome: "database_permission_error", logLabel: "text:permission" };
  }
  if (/function .* does not exist|schema cache/i.test(message)) {
    return { outcome: "rpc_error", logLabel: "text:function_not_found" };
  }
  if (/network|fetch failed/i.test(message)) {
    return { outcome: "network_error", logLabel: "text:network" };
  }
  return { outcome: "unexpected_server_error", logLabel: "unexpected" };
}

const OUTCOME_MESSAGES: Record<SyncMarketProductMappingsOutcome, string> = {
  synced: "",
  unauthorised: "MDF session required to run market-mapping sync.",
  forbidden: "Global market-mapping synchronisation requires an MDF owner role.",
  invalid_registry: "The canonical Product-to-HS registry is invalid.",
  configuration_error: "Market Intelligence server writer is not configured on this server.",
  authorization_error: "Market Intelligence writer credentials are not accepted by the database.",
  rpc_error:
    "Market Intelligence write endpoint could not process the request. Check server logs for the classified reason.",
  database_permission_error:
    "Market Intelligence writer role is missing execute permission on the sync operation.",
  network_error: "Market Intelligence writer could not reach the database.",
  unexpected_server_error: "Market mapping synchronization could not be completed.",
};

function isPrivilegedMdfMember(membership: MdfMembership): boolean {
  return PRIVILEGED_MDF_ROLES.has(membership.role);
}

/**
 * Owner-gated, server-only maintenance operation shared by the Server Action
 * and internal POST route. It accepts no caller-controlled mapping input.
 */
export async function syncCurrentMarketProductMappings(): Promise<SyncMarketProductMappingsResult> {
  let session;
  try {
    session = await requireMdfSession();
  } catch {
    return {
      outcome: "unauthorised",
      registryVersion: MI_PRODUCT_MAPPING_VERSION,
      message: "MDF session required to run market-mapping sync.",
    };
  }

  if (!isPrivilegedMdfMember(session.membership)) {
    return {
      outcome: "forbidden",
      registryVersion: MI_PRODUCT_MAPPING_VERSION,
      message: "Global market-mapping synchronisation requires an MDF owner role.",
    };
  }

  let snapshot;
  try {
    snapshot = serializeProductTradeMappingsSnapshot();
  } catch (error) {
    if (error instanceof ProductTradeMappingSnapshotError) {
      return {
        outcome: "invalid_registry",
        registryVersion: MI_PRODUCT_MAPPING_VERSION,
        message: "The canonical Product-to-HS registry is invalid.",
      };
    }
    return {
      outcome: "invalid_registry",
      registryVersion: MI_PRODUCT_MAPPING_VERSION,
      message: "The canonical Product-to-HS registry could not be prepared.",
    };
  }

  // Lazy import is deliberately after session, owner, and registry checks.
  // Neither denied callers nor invalid registries initialise the trusted writer.
  const writerModule = await import("./writer");
  let writer;
  try {
    writer = writerModule.getMarketIntelligenceWriter();
  } catch (error) {
    if (error instanceof writerModule.MarketIntelligenceServiceRoleConfigError) {
      return {
        outcome: "configuration_error",
        registryVersion: MI_PRODUCT_MAPPING_VERSION,
        message: "Market Intelligence server writer is not configured on this server.",
      };
    }
    return {
      outcome: "configuration_error",
      registryVersion: MI_PRODUCT_MAPPING_VERSION,
      message: "Market Intelligence server writer is unavailable.",
    };
  }

  try {
    const summary = await writer.syncProductTradeMappings(snapshot);
    return {
      outcome: "synced",
      registryVersion: snapshot.registryVersion,
      summary,
    };
  } catch (error) {
    // Never return PostgREST/Supabase details or stack traces to the caller.
    if (error instanceof writerModule.MarketIntelligenceServiceRoleConfigError) {
      // eslint-disable-next-line no-console
      console.error(
        "[MI mapping-sync] configuration_error: service-role client not configured",
      );
      return {
        outcome: "configuration_error",
        registryVersion: snapshot.registryVersion,
        message: OUTCOME_MESSAGES.configuration_error,
      };
    }
    const classification = classifySyncFailure(error);
    // Sanitized structured log. No secret, no snapshot payload, no stack.
    // eslint-disable-next-line no-console
    console.error(
      `[MI mapping-sync] ${classification.outcome} label=${classification.logLabel} code=${
        classification.code ?? "-"
      } registryVersion=${snapshot.registryVersion}`,
    );
    return {
      outcome: classification.outcome,
      registryVersion: snapshot.registryVersion,
      message: OUTCOME_MESSAGES[classification.outcome],
    };
  }
}
