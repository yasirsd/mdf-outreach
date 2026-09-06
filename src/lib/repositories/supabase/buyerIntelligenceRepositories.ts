import type { SupabaseClient } from "@supabase/supabase-js";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { requireMdfBusinessProductId } from "@/lib/buyerIntelligence/product";
import {
  clampTradePageLimit,
  cursorForObservation,
  decodeTradeCursor,
} from "@/lib/buyerIntelligence/pagination";
import type {
  BuyerIntelligenceAssessment,
  BuyerIntelligenceAssessmentEvidence,
  BuyerIntelligenceClaim,
  BuyerIntelligenceSource,
  BuyerTradeMetric,
  IntelligenceAssessmentType,
  IntelligenceClaimFilters,
  TradeObservationPage,
  TradeObservationPageRequest,
} from "@/lib/buyerIntelligence/types";
import type {
  BuyerIntelligenceAssessmentEvidenceRepository,
  BuyerIntelligenceAssessmentRepository,
  BuyerIntelligenceClaimRepository,
  BuyerIntelligenceSourceRepository,
  BuyerTradeMetricRepository,
  BuyerTradeObservationRepository,
} from "../interfaces";
import {
  assessmentEvidenceFromRow,
  intelligenceAssessmentFromRow,
  intelligenceClaimFromRow,
  intelligenceSourceFromRow,
  tradeMetricFromRow,
  tradeObservationFromRow,
} from "./buyerIntelligenceMappers";

type Row = Record<string, unknown>;

export class SupabaseBuyerIntelligenceSourceRepository
  implements BuyerIntelligenceSourceRepository
{
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByCandidate(candidateId: string): Promise<BuyerIntelligenceSource[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_intelligence_sources")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId)
      .order("retrieved_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(intelligenceSourceFromRow);
  }
}

export class SupabaseBuyerIntelligenceClaimRepository
  implements BuyerIntelligenceClaimRepository
{
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByCandidate(
    candidateId: string,
    filters: IntelligenceClaimFilters = {},
  ): Promise<BuyerIntelligenceClaim[]> {
    if (!isEntityUuid(candidateId)) return [];
    let query = this.supabase
      .from("buyer_intelligence_claims")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId);
    if (filters.claimType) query = query.eq("claim_type", filters.claimType);
    if (filters.evidenceType) query = query.eq("evidence_type", filters.evidenceType);
    const { data, error } = await query
      .order("observed_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(intelligenceClaimFromRow);
  }
}

export class SupabaseBuyerTradeObservationRepository
  implements BuyerTradeObservationRepository
{
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByCandidatePage(
    candidateId: string,
    request: TradeObservationPageRequest = {},
  ): Promise<TradeObservationPage> {
    if (!isEntityUuid(candidateId)) return { rows: [] };
    const limit = clampTradePageLimit(request.limit);
    const cursor = decodeTradeCursor(request.cursor);
    let query = this.supabase
      .from("buyer_trade_observations")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId);

    if (request.granularity) query = query.eq("granularity", request.granularity);
    if (request.evidenceType) query = query.eq("evidence_type", request.evidenceType);
    if (request.originCountryCode) {
      query = query.eq("origin_country_code", request.originCountryCode);
    }
    if (request.destinationCountryCode) {
      query = query.eq("destination_country_code", request.destinationCountryCode);
    }
    if (request.hsCodeRaw) query = query.eq("hs_code_raw", request.hsCodeRaw);
    if (request.normalizedProductCategory) {
      query = query.eq("normalized_product_category", request.normalizedProductCategory);
    }
    if (request.mdfProductId) {
      query = query.eq("mdf_product_id", requireMdfBusinessProductId(request.mdfProductId));
    }
    if (request.supplierNameNormalized) {
      query = query.eq("supplier_name_normalized", request.supplierNameNormalized);
    }

    if (cursor?.tradeDate) {
      query = query.or(
        `trade_date.lt.${cursor.tradeDate},and(trade_date.eq.${cursor.tradeDate},id.lt.${cursor.id}),trade_date.is.null`,
      );
    } else if (cursor) {
      query = query.is("trade_date", null).lt("id", cursor.id);
    }

    const { data, error } = await query
      .order("trade_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (error) throw error;
    const mapped = ((data ?? []) as Row[]).map(tradeObservationFromRow);
    const hasMore = mapped.length > limit;
    const rows = mapped.slice(0, limit);
    return {
      rows,
      nextCursor: hasMore && rows.length ? cursorForObservation(rows[rows.length - 1]) : undefined,
    };
  }
}

export class SupabaseBuyerTradeMetricRepository implements BuyerTradeMetricRepository {
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByCandidate(candidateId: string): Promise<BuyerTradeMetric[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_trade_metrics")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId)
      .order("metric_key", { ascending: true })
      .order("calculated_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(tradeMetricFromRow);
  }

  async getTradeSummary(candidateId: string): Promise<BuyerTradeMetric[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_trade_metrics")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId)
      .eq("calculation_window", "lifetime")
      .order("metric_key", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(tradeMetricFromRow);
  }
}

export class SupabaseBuyerIntelligenceAssessmentRepository
  implements BuyerIntelligenceAssessmentRepository
{
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByCandidate(candidateId: string): Promise<BuyerIntelligenceAssessment[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_intelligence_assessments")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId)
      .order("calculated_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(intelligenceAssessmentFromRow);
  }

  async getCurrent(
    candidateId: string,
    assessmentType: IntelligenceAssessmentType,
  ): Promise<BuyerIntelligenceAssessment | undefined> {
    if (!isEntityUuid(candidateId)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_intelligence_assessments")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("candidate_id", candidateId)
      .eq("assessment_type", assessmentType)
      .is("superseded_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? intelligenceAssessmentFromRow(data as Row) : undefined;
  }
}

export class SupabaseBuyerIntelligenceAssessmentEvidenceRepository
  implements BuyerIntelligenceAssessmentEvidenceRepository
{
  constructor(private supabase: SupabaseClient, private workspaceId: string) {}

  async listByAssessment(
    assessmentId: string,
  ): Promise<BuyerIntelligenceAssessmentEvidence[]> {
    if (!isEntityUuid(assessmentId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_intelligence_assessment_evidence")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("assessment_id", assessmentId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Row[]).map(assessmentEvidenceFromRow);
  }
}

export function createBuyerIntelligenceRepositories(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  return {
    buyerIntelligenceSources: new SupabaseBuyerIntelligenceSourceRepository(
      supabase,
      workspaceId,
    ),
    buyerIntelligenceClaims: new SupabaseBuyerIntelligenceClaimRepository(
      supabase,
      workspaceId,
    ),
    buyerTradeObservations: new SupabaseBuyerTradeObservationRepository(
      supabase,
      workspaceId,
    ),
    buyerTradeMetrics: new SupabaseBuyerTradeMetricRepository(supabase, workspaceId),
    buyerIntelligenceAssessments: new SupabaseBuyerIntelligenceAssessmentRepository(
      supabase,
      workspaceId,
    ),
    buyerIntelligenceAssessmentEvidence:
      new SupabaseBuyerIntelligenceAssessmentEvidenceRepository(supabase, workspaceId),
  };
}
