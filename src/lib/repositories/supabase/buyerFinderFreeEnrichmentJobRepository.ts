import type { SupabaseClient } from "@supabase/supabase-js";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import {
  FREE_ENRICHMENT_CLAIMABLE_STATUSES,
  FREE_ENRICHMENT_STALE_PROCESSING_MS,
  FREE_ENRICHMENT_TERMINAL_STATUSES,
  type FreeEnrichmentCapability,
  type FreeEnrichmentJob,
} from "@/lib/buyerFinder/freeEnrichmentJob";
import type {
  BuyerFinderFreeEnrichmentJobRepository,
  FreeEnrichmentJobEnsureInput,
  FreeEnrichmentJobFinalizeInput,
} from "../interfaces";
import {
  freeEnrichmentJobFromRow,
  freeEnrichmentJobToInsertRow,
  type FreeEnrichmentJobRow,
} from "./freeEnrichmentJobMappers";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

export class SupabaseBuyerFinderFreeEnrichmentJobRepository
  implements BuyerFinderFreeEnrichmentJobRepository
{
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async ensure(input: FreeEnrichmentJobEnsureInput): Promise<FreeEnrichmentJob> {
    const existing = await this.getByCandidateCapability(input.candidateId, input.capability);
    if (existing) return existing;
    const status = input.alreadyComplete ? "succeeded" : "queued";
    const row = freeEnrichmentJobToInsertRow(
      {
        candidateId: input.candidateId,
        capability: input.capability,
        status,
        providerOutcome: input.alreadyComplete ? "already_complete" : null,
      },
      this.workspaceId,
    );
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.getByCandidateCapability(input.candidateId, input.capability);
        if (raced) return raced;
      }
      throw error;
    }
    return freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow);
  }

  async get(id: string): Promise<FreeEnrichmentJob | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow) : undefined;
  }

  async getByCandidateCapability(
    candidateId: string,
    capability: FreeEnrichmentCapability,
  ): Promise<FreeEnrichmentJob | undefined> {
    if (!isEntityUuid(candidateId)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("*")
      .eq("candidate_id", candidateId)
      .eq("capability", capability)
      .maybeSingle();
    if (error) throw error;
    return data ? freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow) : undefined;
  }

  async listByCandidate(candidateId: string): Promise<FreeEnrichmentJob[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("*")
      .eq("candidate_id", candidateId);
    if (error) throw error;
    return (data ?? []).map((row) => freeEnrichmentJobFromRow(row as FreeEnrichmentJobRow));
  }

  async listAll(): Promise<FreeEnrichmentJob[]> {
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => freeEnrichmentJobFromRow(row as FreeEnrichmentJobRow));
  }

  async claimNextDue(
    capability: FreeEnrichmentCapability,
    now: Date = new Date(),
  ): Promise<FreeEnrichmentJob | undefined> {
    const nowIso = now.toISOString();
    const { data: processing, error: processingError } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("id")
      .eq("capability", capability)
      .eq("status", "processing")
      .limit(1);
    if (processingError) throw processingError;
    if ((processing ?? []).length > 0) return undefined;

    const { data: queued, error: queuedError } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("id, attempt_count, next_attempt_at")
      .eq("capability", capability)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(8);
    if (queuedError) throw queuedError;

    const { data: retrying, error: retryError } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("id, attempt_count, next_attempt_at")
      .eq("capability", capability)
      .eq("status", "retry_wait")
      .lte("next_attempt_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(8);
    if (retryError) throw retryError;

    const ready = [...(queued ?? []), ...(retrying ?? [])];

    for (const row of ready) {
      const { data, error } = await this.supabase
        .from("buyer_finder_free_enrichment_jobs")
        .update({
          status: "processing",
          started_at: nowIso,
          attempt_count: (row.attempt_count ?? 0) + 1,
          updated_at: nowIso,
        })
        .eq("id", row.id)
        .in("status", [...FREE_ENRICHMENT_CLAIMABLE_STATUSES])
        .select("*")
        .maybeSingle();
      if (error) {
        if (isUniqueViolation(error)) return undefined;
        throw error;
      }
      if (data) return freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow);
    }
    return undefined;
  }

  async prepareForManualExecution(
    id: string,
    now: Date = new Date(),
  ): Promise<FreeEnrichmentJob | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const existing = await this.get(id);
    if (!existing) return undefined;
    if (existing.status === "processing") return existing;
    const nowIso = now.toISOString();
    if (existing.status === "queued" || existing.status === "retry_wait") {
      const { data, error } = await this.supabase
        .from("buyer_finder_free_enrichment_jobs")
        .update({ next_attempt_at: nowIso, updated_at: nowIso })
        .eq("id", id)
        .in("status", [...FREE_ENRICHMENT_CLAIMABLE_STATUSES])
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data ? freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow) : this.get(id);
    }
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .update({
        status: "queued",
        attempt_count: 0,
        next_attempt_at: null,
        error_code: null,
        started_at: null,
        completed_at: null,
        updated_at: nowIso,
      })
      .eq("id", id)
      .in("status", [...FREE_ENRICHMENT_TERMINAL_STATUSES])
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow) : this.get(id);
  }

  async claimById(id: string, now: Date = new Date()): Promise<FreeEnrichmentJob | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const existing = await this.get(id);
    if (!existing) return undefined;
    const nowIso = now.toISOString();
    const { data: processing, error: processingError } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .select("id")
      .eq("capability", existing.capability)
      .eq("status", "processing")
      .limit(1);
    if (processingError) throw processingError;
    if ((processing ?? []).length > 0) return undefined;

    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .update({
        status: "processing",
        started_at: nowIso,
        attempt_count: existing.attemptCount + 1,
        updated_at: nowIso,
      })
      .eq("id", id)
      .in("status", [...FREE_ENRICHMENT_CLAIMABLE_STATUSES])
      .select("*")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) return undefined;
      throw error;
    }
    return data ? freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow) : undefined;
  }

  async reclaimStaleProcessing(
    now: Date = new Date(),
    staleMs: number = FREE_ENRICHMENT_STALE_PROCESSING_MS,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - staleMs).toISOString();
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .update({
        status: "retry_wait",
        next_attempt_at: now.toISOString(),
        error_code: "stale_processing",
        updated_at: now.toISOString(),
      })
      .eq("status", "processing")
      .lt("started_at", cutoff)
      .select("id");
    if (error) throw error;
    return (data ?? []).length;
  }

  async finalize(id: string, patch: FreeEnrichmentJobFinalizeInput): Promise<FreeEnrichmentJob> {
    if (!isEntityUuid(id)) throw new Error("Invalid free enrichment job id");
    const now = new Date().toISOString();
    const fields: Record<string, unknown> = {
      status: patch.status,
      updated_at: now,
      provider_outcome: patch.providerOutcome === undefined ? undefined : patch.providerOutcome,
      error_code: patch.errorCode === undefined ? undefined : patch.errorCode,
      next_attempt_at: patch.nextAttemptAt === undefined ? undefined : patch.nextAttemptAt,
    };
    if (patch.status === "succeeded" || patch.status === "no_result" || patch.status === "failed" || patch.status === "cancelled") {
      fields.completed_at = patch.completedAt ?? now;
    }
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow);
  }

  async requeue(id: string): Promise<FreeEnrichmentJob | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .update({
        status: "queued",
        attempt_count: 0,
        next_attempt_at: null,
        error_code: null,
        started_at: null,
        completed_at: null,
        updated_at: now,
      })
      .eq("id", id)
      .in("status", ["failed", "cancelled", "retry_wait"])
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? freeEnrichmentJobFromRow(data as FreeEnrichmentJobRow) : undefined;
  }

  async cancelOpenForCandidate(candidateId: string): Promise<number> {
    if (!isEntityUuid(candidateId)) return 0;
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("buyer_finder_free_enrichment_jobs")
      .update({
        status: "cancelled",
        completed_at: now,
        updated_at: now,
        error_code: "candidate_ineligible",
      })
      .eq("candidate_id", candidateId)
      .in("status", ["queued", "retry_wait", "processing"])
      .select("id");
    if (error) throw error;
    return (data ?? []).length;
  }
}

export function createBuyerFinderFreeEnrichmentJobRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerFinderFreeEnrichmentJobRepository {
  return new SupabaseBuyerFinderFreeEnrichmentJobRepository(supabase, workspaceId);
}
