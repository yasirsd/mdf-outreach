import type { SupabaseClient } from "@supabase/supabase-js";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import {
  normalizeClaimIngestion,
  normalizeSourceIngestion,
  normalizeTradeObservationIngestion,
  type ClaimIngestionInput,
  type IntelligenceIngestionResult,
  type SourceIngestionInput,
  type TradeObservationIngestionInput,
} from "@/lib/buyerIntelligence/ingestion";
import type { BuyerIntelligenceWriteRepository } from "../interfaces";

type RpcResult = { outcome?: unknown; id?: unknown; reason?: unknown; candidate_id?: unknown };

function parseIngestionResult(value: unknown): IntelligenceIngestionResult {
  const row = (value ?? {}) as RpcResult;
  if ((row.outcome !== "created" && row.outcome !== "existing" && row.outcome !== "conflict") || typeof row.id !== "string") {
    throw new Error("Buyer Intelligence ingestion returned an invalid result.");
  }
  return {
    outcome: row.outcome,
    id: row.id,
    ...(row.reason === "material_mismatch" ? { reason: row.reason } : {}),
  };
}

function sourcePayload(input: ReturnType<typeof normalizeSourceIngestion>) {
  return {
    provider_id: input.providerId, source_type: input.sourceType, source_key: input.sourceKey,
    safe_source_ref: input.safeSourceRef, source_url: input.sourceUrl,
    access_class: input.accessClass, cost_class: input.costClass,
    observed_at: input.observedAt, retrieved_at: input.retrievedAt, metadata: input.metadata,
  };
}

function claimPayload(input: ReturnType<typeof normalizeClaimIngestion>) {
  return {
    source_record_ref: input.sourceRecordRef, claim_type: input.claimType,
    evidence_type: input.evidenceType, evidence_level: input.evidenceLevel,
    confidence: input.confidence, raw_value: input.rawValue,
    normalized_value: input.normalizedValue, observed_at: input.observedAt,
    retrieved_at: input.retrievedAt, normalization_version: input.normalizationVersion,
  };
}

function observationPayload(input: ReturnType<typeof normalizeTradeObservationIngestion>) {
  return {
    source_record_ref: input.sourceRecordRef, granularity: input.granularity,
    evidence_type: input.evidenceType, evidence_level: input.evidenceLevel,
    confidence: input.confidence, trade_date: input.tradeDate,
    period_start: input.periodStart, period_end: input.periodEnd,
    origin_country_code: input.originCountryCode, destination_country_code: input.destinationCountryCode,
    supplier_name_raw: input.supplierNameRaw, supplier_name_normalized: input.supplierNameNormalized,
    supplier_country_code: input.supplierCountryCode, product_description_raw: input.productDescriptionRaw,
    normalized_product_category: input.normalizedProductCategory, mdf_product_id: input.mdfProductId,
    hs_code_raw: input.hsCodeRaw, quantity: input.quantity, quantity_unit: input.quantityUnit,
    gross_weight_kg: input.grossWeightKg, net_weight_kg: input.netWeightKg,
    trade_value: input.tradeValue, currency_code: input.currencyCode,
    origin_port_raw: input.originPortRaw, destination_port_raw: input.destinationPortRaw,
    reported_record_count: input.reportedRecordCount, observed_at: input.observedAt,
    retrieved_at: input.retrievedAt, normalization_version: input.normalizationVersion,
  };
}

export class SupabaseBuyerIntelligenceWriteRepository implements BuyerIntelligenceWriteRepository {
  constructor(private supabase: SupabaseClient) {}

  async ingestSource(input: SourceIngestionInput) {
    const safe = normalizeSourceIngestion(input);
    const { data, error } = await this.supabase.rpc("ingest_buyer_intelligence_source", { p_candidate_id: safe.candidateId, p_input: sourcePayload(safe) });
    if (error) throw error;
    return parseIngestionResult(data);
  }

  async ingestClaim(input: ClaimIngestionInput) {
    const safe = normalizeClaimIngestion(input);
    const { data, error } = await this.supabase.rpc("ingest_buyer_intelligence_claim", { p_candidate_id: safe.candidateId, p_source_id: safe.sourceId, p_input: claimPayload(safe) });
    if (error) throw error;
    return parseIngestionResult(data);
  }

  async ingestObservation(input: TradeObservationIngestionInput) {
    const safe = normalizeTradeObservationIngestion(input);
    const { data, error } = await this.supabase.rpc("ingest_buyer_trade_observation", { p_candidate_id: safe.candidateId, p_source_id: safe.sourceId, p_input: observationPayload(safe) });
    if (error) throw error;
    return parseIngestionResult(data);
  }

  async refreshDerived(candidateId: string) {
    if (!isEntityUuid(candidateId)) throw new Error("Invalid Candidate id.");
    const { data, error } = await this.supabase.rpc("refresh_buyer_intelligence", { p_candidate_id: candidateId });
    if (error) throw error;
    const row = (data ?? {}) as RpcResult;
    if (row.outcome !== "refreshed" || row.candidate_id !== candidateId) throw new Error("Buyer Intelligence refresh returned an invalid result.");
    return { outcome: "refreshed" as const, candidateId };
  }
}

export function createBuyerIntelligenceWriteRepository(supabase: SupabaseClient) {
  return new SupabaseBuyerIntelligenceWriteRepository(supabase);
}
