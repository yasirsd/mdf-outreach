import "server-only";

/**
 * MI1C — MARKET INTELLIGENCE writer.
 *
 * The ONLY module (with the sync action beside it) authorised to hold
 * the service-role Supabase client. Exposes a narrow, contract-shaped
 * surface — no `.from(table)`, no arbitrary `.rpc(name)`, no SQL,
 * no generic insert/update/delete.
 *
 * Session authority MUST be established by the caller BEFORE
 * obtaining this writer (a `requireMdfSession()` gate in the
 * server-action layer). The writer itself has no user context; it is
 * a trust-elevated capability that must never be reachable by a
 * browser client.
 */

import {
  getMarketIntelligenceServiceRoleClient,
  MarketIntelligenceServiceRoleConfigError,
} from "./serviceRoleClient";
import type {
  ProductTradeMappingSnapshot,
  ProductTradeMappingSyncSummary,
  MarketFetchLedgerWriteInput,
  MarketSourceIngestionInput,
  MarketSourceVerificationInput,
  MarketTradeObservationIngestionInput,
  MarketRefreshInput,
  MarketRefreshSummary,
  MarketIngestionResult,
  MarketFetchLedgerRecordResult,
} from "./types";

export { MarketIntelligenceServiceRoleConfigError };

/**
 * The complete server-side MI mutation contract. Every future
 * MI-triggered server action MUST go through this interface. There
 * is no `.from`, `.rpc`, or generic SQL escape hatch.
 */
export interface MarketIntelligenceWriter {
  ingestSource(input: MarketSourceIngestionInput): Promise<MarketIngestionResult>;
  verifySourceRights(input: MarketSourceVerificationInput): Promise<{ outcome: "verified"; id: string }>;
  ingestTradeObservation(
    input: MarketTradeObservationIngestionInput,
  ): Promise<MarketIngestionResult>;
  recordFetchResult(input: MarketFetchLedgerWriteInput): Promise<MarketFetchLedgerRecordResult>;
  refreshMarketIntelligence(input: MarketRefreshInput): Promise<MarketRefreshSummary>;
  syncProductTradeMappings(
    snapshot: ProductTradeMappingSnapshot,
  ): Promise<ProductTradeMappingSyncSummary>;
}

class SupabaseMarketIntelligenceWriter implements MarketIntelligenceWriter {
  async ingestSource(input: MarketSourceIngestionInput): Promise<MarketIngestionResult> {
    const supabase = getMarketIntelligenceServiceRoleClient();
    const { data, error } = await supabase.rpc("ingest_market_intelligence_source", {
      p_input: input,
    });
    if (error) throw new Error(scrub(error.message));
    return parseIngestionResult(data);
  }

  async verifySourceRights(input: MarketSourceVerificationInput) {
    const supabase = getMarketIntelligenceServiceRoleClient();
    const { data, error } = await supabase.rpc("verify_market_intelligence_source", {
      p_source_id: input.sourceId,
      p_verification: input.verification,
    });
    if (error) throw new Error(scrub(error.message));
    const outcome = (data as { outcome?: string; id?: string } | undefined)?.outcome;
    const id = (data as { outcome?: string; id?: string } | undefined)?.id ?? input.sourceId;
    if (outcome !== "verified") throw new Error("verify_market_intelligence_source returned unexpected outcome");
    return { outcome: "verified" as const, id };
  }

  async ingestTradeObservation(
    input: MarketTradeObservationIngestionInput,
  ): Promise<MarketIngestionResult> {
    const supabase = getMarketIntelligenceServiceRoleClient();
    const { data, error } = await supabase.rpc("ingest_market_trade_observation", {
      p_source_id: input.sourceId,
      p_input: input.observation,
    });
    if (error) throw new Error(scrub(error.message));
    return parseIngestionResult(data);
  }

  async recordFetchResult(
    input: MarketFetchLedgerWriteInput,
  ): Promise<MarketFetchLedgerRecordResult> {
    const supabase = getMarketIntelligenceServiceRoleClient();
    const { data, error } = await supabase.rpc("record_market_fetch_result", {
      p_input: input,
    });
    if (error) throw new Error(scrub(error.message));
    const parsed = (data ?? {}) as { outcome?: string; id?: string };
    if (parsed.outcome !== "recorded" || !parsed.id) {
      throw new Error("record_market_fetch_result returned unexpected payload");
    }
    return { outcome: "recorded", id: parsed.id };
  }

  async refreshMarketIntelligence(input: MarketRefreshInput): Promise<MarketRefreshSummary> {
    const supabase = getMarketIntelligenceServiceRoleClient();
    const { data, error } = await supabase.rpc("refresh_market_intelligence", {
      p_country_alpha2: input.countryAlpha2,
      p_mdf_product_id: input.mdfProductId,
      p_input: input.payload,
    });
    if (error) throw new Error(scrub(error.message));
    const parsed = (data ?? {}) as {
      outcome?: string;
      country_alpha2?: string;
      mdf_product_id?: string;
      score_id?: string | null;
    };
    if (parsed.outcome !== "refreshed") {
      throw new Error("refresh_market_intelligence returned unexpected payload");
    }
    return {
      outcome: "refreshed",
      countryAlpha2: parsed.country_alpha2 ?? input.countryAlpha2,
      mdfProductId: parsed.mdf_product_id ?? input.mdfProductId,
      scoreId: parsed.score_id ?? null,
    };
  }

  async syncProductTradeMappings(
    snapshot: ProductTradeMappingSnapshot,
  ): Promise<ProductTradeMappingSyncSummary> {
    const supabase = getMarketIntelligenceServiceRoleClient();
    const { data, error } = await supabase.rpc("sync_product_trade_mappings", {
      p_input: snapshot,
    });
    if (error) throw new Error(scrub(error.message));
    const parsed = (data ?? {}) as Partial<ProductTradeMappingSyncSummary>;
    return {
      outcome: parsed.outcome ?? "synced",
      created: parsed.created ?? 0,
      updated: parsed.updated ?? 0,
      reactivated: parsed.reactivated ?? 0,
      deactivated: parsed.deactivated ?? 0,
      unchanged: parsed.unchanged ?? 0,
      registryVersion: parsed.registryVersion ?? snapshot.registryVersion,
    };
  }
}

let cachedWriter: MarketIntelligenceWriter | undefined;

/**
 * The single approved factory. Callers ONLY ever get an interface
 * value — the underlying client stays hidden inside this file.
 */
export function getMarketIntelligenceWriter(): MarketIntelligenceWriter {
  if (!cachedWriter) cachedWriter = new SupabaseMarketIntelligenceWriter();
  return cachedWriter;
}

/** Test-only reset hook. */
export function __resetMarketIntelligenceWriterForTests(): void {
  cachedWriter = undefined;
}

function parseIngestionResult(data: unknown): MarketIngestionResult {
  const parsed = (data ?? {}) as { outcome?: string; id?: string; reason?: string };
  if (parsed.outcome === "created" || parsed.outcome === "existing" || parsed.outcome === "conflict") {
    if (!parsed.id) throw new Error("ingestion RPC returned no id");
    return {
      outcome: parsed.outcome,
      id: parsed.id,
      reason: parsed.reason === "material_mismatch" ? "material_mismatch" : undefined,
    };
  }
  throw new Error("ingestion RPC returned unexpected outcome");
}

/**
 * Defence-in-depth. The service-role key must never appear in an
 * error message surfaced to the caller. In practice PostgREST does
 * not echo the key, but if a future adapter ever concatenates it,
 * this hard-scrubs anything shaped like a JWT.
 */
function scrub(message: string): string {
  return message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED]");
}
