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
  | "configuration_error";

export interface SyncMarketProductMappingsResult {
  outcome: SyncMarketProductMappingsOutcome;
  registryVersion: string;
  summary?: ProductTradeMappingSyncSummary;
  message?: string;
}

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
      return {
        outcome: "configuration_error",
        registryVersion: snapshot.registryVersion,
        message: "Market Intelligence server writer is not configured on this server.",
      };
    }
    return {
      outcome: "configuration_error",
      registryVersion: snapshot.registryVersion,
      message: "Market mapping synchronization could not be completed.",
    };
  }
}
