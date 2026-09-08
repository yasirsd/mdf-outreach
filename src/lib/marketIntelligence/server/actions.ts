"use server";

import "server-only";

/**
 * MI1C — SERVER-ONLY Market Intelligence maintenance actions.
 *
 * The service-role capability is trusted; the person invoking it
 * MUST NOT be. Every action here validates the MDF session BEFORE
 * calling the writer. There is no browser affordance; these are
 * called from a server route or a maintenance script.
 *
 * MI1C ships exactly one action: the product-mapping registry sync.
 * `market_analysis_events` writes are deferred until the real
 * analysis orchestrator exists (MI1D+).
 */

import { requireMdfSession } from "@/lib/auth/require";
import {
  MI_PRODUCT_MAPPING_VERSION,
  ProductTradeMappingSnapshotError,
  serializeProductTradeMappingsSnapshot,
} from "../product";
import { getMarketIntelligenceWriter } from "./writer";
import type { ProductTradeMappingSyncSummary } from "./types";

export interface SyncMarketProductMappingsResult {
  outcome: "synced" | "invalid_registry" | "unauthorised";
  registryVersion: string;
  summary?: ProductTradeMappingSyncSummary;
  message?: string;
}

/**
 * Serialize the current TS registry and hand it to the service-role
 * writer. Every failure path returns a sanitized shape — no credentials,
 * no raw provider strings, no service-role client leakage.
 */
export async function syncMarketProductMappingsAction(): Promise<SyncMarketProductMappingsResult> {
  try {
    await requireMdfSession();
  } catch {
    return {
      outcome: "unauthorised",
      registryVersion: MI_PRODUCT_MAPPING_VERSION,
      message: "MDF session required to run market-mapping sync.",
    };
  }
  let snapshot;
  try {
    snapshot = serializeProductTradeMappingsSnapshot();
  } catch (err) {
    if (err instanceof ProductTradeMappingSnapshotError) {
      return {
        outcome: "invalid_registry",
        registryVersion: MI_PRODUCT_MAPPING_VERSION,
        message: err.message,
      };
    }
    throw err;
  }
  const writer = getMarketIntelligenceWriter();
  const summary = await writer.syncProductTradeMappings(snapshot);
  return {
    outcome: "synced",
    registryVersion: snapshot.registryVersion,
    summary,
  };
}
