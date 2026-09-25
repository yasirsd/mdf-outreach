import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  AUTOMATIC_SPEND_RUPEES,
  type TradeResearchBatchSnapshot,
  type TradeResearchJobSnapshot,
  type TradeResearchOutcome,
  type TradeResearchResultSummary,
  type TradeResearchStage,
  type TradeResearchStatus,
} from "./types";

type Row = Record<string, unknown>;

const EMPTY_RESULT: TradeResearchResultSummary = {
  officialProgramEvidence: "not_checked",
  productEvidence: "not_available",
  indiaOrigin: "not_verified",
  shipmentEvidence: "not_verified",
  sourcesChecked: 0,
  automaticSpendRupees: AUTOMATIC_SPEND_RUPEES,
};

function zero(value: unknown): 0 {
  if (Number(value) !== 0) throw new Error("PERSISTED_AUTOMATIC_SPEND_NONZERO");
  return 0;
}

export function mapTradeResearchBatch(row: Row): TradeResearchBatchSnapshot {
  return {
    id: String(row.id), status: row.status as TradeResearchStatus,
    requestedGoal: row.requested_goal as TradeResearchBatchSnapshot["requestedGoal"],
    totalJobs: Number(row.total_jobs), queuedCount: Number(row.queued_count), runningCount: Number(row.running_count),
    completedCount: Number(row.completed_count), partialCount: Number(row.partial_count),
    needsReviewCount: Number(row.needs_review_count), failedCount: Number(row.failed_count), cancelledCount: Number(row.cancelled_count),
    corroboratedCount: Number(row.corroborated_count),
    automaticSpendRupees: zero(row.automatic_spend_rupees), createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export function mapTradeResearchJob(row: Row): TradeResearchJobSnapshot {
  const raw = row.result_summary && typeof row.result_summary === "object" ? row.result_summary as Partial<TradeResearchResultSummary> : {};
  return {
    id: String(row.id), batchId: String(row.batch_id), candidateId: String(row.candidate_id),
    productId: row.product_id ? String(row.product_id) : undefined, countryCode: String(row.country_code),
    requestedGoal: row.requested_goal as TradeResearchJobSnapshot["requestedGoal"], status: row.status as TradeResearchStatus,
    stage: row.stage as TradeResearchStage, outcome: row.outcome ? row.outcome as TradeResearchOutcome : undefined,
    revision: Number(row.revision), automaticSpendRupees: zero(row.automatic_spend_rupees),
    result: { ...EMPTY_RESULT, ...raw, automaticSpendRupees: zero(raw.automaticSpendRupees ?? 0) },
    createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

export function createTradeResearchReadRepository(client: SupabaseClient, workspaceId: string) {
  return {
    async getBatch(id: string): Promise<TradeResearchBatchSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_batches").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchBatch(data as Row) : undefined;
    },
    async getLatestBatch(): Promise<TradeResearchBatchSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_batches").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchBatch(data as Row) : undefined;
    },
    async getJob(id: string): Promise<TradeResearchJobSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchJob(data as Row) : undefined;
    },
    async getLatestJobForCandidate(candidateId: string): Promise<TradeResearchJobSnapshot | undefined> {
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? mapTradeResearchJob(data as Row) : undefined;
    },
    async getLatestJobsForCandidates(candidateIds: readonly string[]): Promise<Map<string, TradeResearchJobSnapshot>> {
      if (!candidateIds.length) return new Map();
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).in("candidate_id", [...candidateIds]).order("created_at", { ascending: false });
      if (error) throw error;
      const result = new Map<string, TradeResearchJobSnapshot>();
      for (const row of data ?? []) {
        const mapped = mapTradeResearchJob(row as Row);
        if (!result.has(mapped.candidateId)) result.set(mapped.candidateId, mapped);
      }
      return result;
    },
    async listJobs(batchId: string): Promise<TradeResearchJobSnapshot[]> {
      const { data, error } = await client.from("buyer_trade_research_jobs").select("*").eq("workspace_id", workspaceId).eq("batch_id", batchId).order("created_at");
      if (error) throw error;
      return (data ?? []).map((row) => mapTradeResearchJob(row as Row));
    },
  };
}

export interface InternalJobRow extends Row {
  id: string; batch_id: string; workspace_id: string; candidate_id: string; product_id?: string;
  country_code: string; status: TradeResearchStatus; stage: TradeResearchStage; revision: number;
}

export interface SnapshotRow extends Row {
  id: string; provider_id: string; dataset_id: string; published_period: string; source_url: string;
  etag?: string; last_modified?: string; material_hash: string; retrieved_at: string; expires_at: string;
  row_count: number; normalized_rows: Array<{ companyName: string; stateCode: string }>;
}

export class TradeResearchWriter {
  constructor(private readonly client: SupabaseClient) {}

  async createBatch(input: Row): Promise<TradeResearchBatchSnapshot> {
    const { data, error } = await this.client.rpc("create_buyer_trade_research_batch", { p_input: input });
    if (error || !data) throw error ?? new Error("TRADE_RESEARCH_BATCH_CREATE_FAILED");
    return mapTradeResearchBatch(data as Row);
  }
  async cancelBatch(batchId: string, workspaceId: string): Promise<TradeResearchBatchSnapshot | undefined> {
    const { data, error } = await this.client.rpc("request_buyer_trade_research_batch_cancel", { p_batch_id: batchId, p_workspace_id: workspaceId });
    if (error) throw error;
    return data ? mapTradeResearchBatch(data as Row) : undefined;
  }
  async claim(worker: string): Promise<InternalJobRow | undefined> {
    const { data, error } = await this.client.rpc("claim_buyer_trade_research_job", { p_worker: worker });
    if (error) throw error;
    return data ? data as InternalJobRow : undefined;
  }
  async advance(job: InternalJobRow, worker: string, stage: TradeResearchStage): Promise<InternalJobRow> {
    const { data, error } = await this.client.rpc("advance_buyer_trade_research_job", { p_job_id: job.id, p_worker: worker, p_revision: job.revision, p_stage: stage });
    if (error || !data) throw error ?? new Error("JOB_LEASE_LOST");
    return data as InternalJobRow;
  }
  async heartbeat(job: InternalJobRow, worker: string): Promise<InternalJobRow> {
    const { data, error } = await this.client.rpc("heartbeat_buyer_trade_research_job", { p_job_id: job.id, p_worker: worker, p_revision: job.revision });
    if (error || !data) throw error ?? new Error("JOB_LEASE_LOST");
    return data as InternalJobRow;
  }
  async release(job: InternalJobRow, worker: string, nextAttemptAt: string): Promise<void> {
    const { data, error } = await this.client.rpc("release_buyer_trade_research_job", { p_job_id: job.id, p_worker: worker, p_revision: job.revision, p_next_attempt_at: nextAttemptAt });
    if (error || !data) throw error ?? new Error("JOB_LEASE_LOST");
  }
  async finalize(job: InternalJobRow, worker: string, status: TradeResearchStatus, outcome: TradeResearchOutcome, result: TradeResearchResultSummary): Promise<void> {
    if (result.automaticSpendRupees !== 0) throw new Error("AUTOMATIC_SPEND_MUST_REMAIN_ZERO");
    const { data, error } = await this.client.rpc("finalize_buyer_trade_research_job", { p_job_id: job.id, p_worker: worker, p_status: status, p_outcome: outcome, p_result: result });
    if (error || !data) throw error ?? new Error("JOB_LEASE_LOST");
  }
  async isCancellationRequested(batchId: string): Promise<boolean> {
    const { data, error } = await this.client.from("buyer_trade_research_batches").select("cancel_requested_at").eq("id", batchId).single();
    if (error) throw error;
    return Boolean(data.cancel_requested_at);
  }
  async getCandidate(job: InternalJobRow): Promise<BuyerCandidate> {
    const { data, error } = await this.client.from("buyer_candidates").select("*").eq("id", job.candidate_id).eq("workspace_id", job.workspace_id).single();
    if (error) throw error;
    return {
      id: data.id, companyName: data.company_name, website: data.website ?? undefined, domain: data.domain ?? undefined,
      country: data.country, city: data.city ?? undefined, address: data.address ?? undefined, industry: data.industry ?? undefined,
      buyerType: data.buyer_type ?? undefined, isImporter: data.is_importer ?? undefined, isDistributor: data.is_distributor ?? undefined,
      discoveryStatus: data.discovery_status, reviewStatus: data.review_status,
    };
  }
  async getEligiblePlan(jobId: string): Promise<Row | undefined> {
    const { data, error } = await this.client.from("buyer_trade_research_provider_plans").select("*").eq("job_id", jobId).eq("eligibility", "eligible").order("sequence").limit(1).maybeSingle();
    if (error) throw error;
    return data as Row | undefined;
  }
  async latestAttempt(planId: string): Promise<Row | undefined> {
    const { data, error } = await this.client.from("buyer_trade_research_attempts").select("*").eq("provider_plan_id", planId).order("attempt_number", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as Row | undefined;
  }
  async startAttempt(job: InternalJobRow, planId: string, attemptNumber: number, worker: string): Promise<Row> {
    const now = new Date();
    const { data, error } = await this.client.from("buyer_trade_research_attempts").insert({
      provider_plan_id: planId, job_id: job.id, workspace_id: job.workspace_id, attempt_number: attemptNumber,
      state: "running", lease_owner: worker, lease_expires_at: new Date(now.getTime() + 60_000).toISOString(), heartbeat_at: now.toISOString(), started_at: now.toISOString(), automatic_spend_rupees: 0,
    }).select("*").single();
    if (error) throw error;
    return data as Row;
  }
  async finishAttempt(id: string, patch: Row): Promise<void> {
    const { error } = await this.client.from("buyer_trade_research_attempts").update({ ...patch, automatic_spend_rupees: 0, lease_owner: null, lease_expires_at: null, finished_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }
  async appendEvent(job: InternalJobRow, eventType: string, safeDetails: Row = {}): Promise<void> {
    const { error } = await this.client.from("buyer_trade_research_events").insert({
      workspace_id: job.workspace_id, batch_id: job.batch_id, job_id: job.id,
      event_type: eventType, safe_details: safeDetails, automatic_spend_rupees: 0,
    });
    if (error) throw error;
  }
  async getFreshSnapshot(now = new Date()): Promise<SnapshotRow | undefined> {
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").select("*").eq("provider_id", "fda-fsvp").eq("dataset_id", "fsvp-participant-list").eq("status", "ready").gte("expires_at", now.toISOString()).order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as SnapshotRow | undefined;
  }
  async getLatestSnapshot(): Promise<SnapshotRow | undefined> {
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").select("*").eq("provider_id", "fda-fsvp").eq("dataset_id", "fsvp-participant-list").eq("status", "ready").order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as SnapshotRow | undefined;
  }
  async saveSnapshot(input: Row): Promise<SnapshotRow> {
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").upsert(input, { onConflict: "provider_id,dataset_id,material_hash" }).select("*").single();
    if (error) throw error;
    return data as SnapshotRow;
  }
  async refreshSnapshotExpiry(id: string, retrievedAt: string, expiresAt: string): Promise<SnapshotRow> {
    const { data, error } = await this.client.from("buyer_trade_source_snapshots").update({ retrieved_at: retrievedAt, expires_at: expiresAt }).eq("id", id).select("*").single();
    if (error) throw error;
    return data as SnapshotRow;
  }
}
