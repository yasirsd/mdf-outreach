import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { normalizeDomain } from "@/lib/buyerFinder/normalize";
import type { BuyerCandidateRepository } from "../interfaces";
import { candidateFromRow, candidateToPatchRow, candidateToRow } from "./candidateMappers";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function idFor(patchId: string | undefined): string {
  if (patchId && isUuid(patchId)) return patchId;
  return randomUUID();
}

export class SupabaseBuyerCandidateRepository implements BuyerCandidateRepository {
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async list(): Promise<BuyerCandidate[]> {
    const { data, error } = await this.supabase
      .from("buyer_candidates")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(candidateFromRow);
  }

  async get(id: string): Promise<BuyerCandidate | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_candidates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? candidateFromRow(data) : undefined;
  }

  async create(input: BuyerCandidate): Promise<BuyerCandidate> {
    const row = candidateToRow({ ...input, id: idFor(input.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("buyer_candidates")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return candidateFromRow(data);
  }

  async update(id: string, patch: Partial<BuyerCandidate>): Promise<BuyerCandidate> {
    if (!isEntityUuid(id)) throw new Error("Invalid candidate id");
    const fields = candidateToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("buyer_candidates")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return candidateFromRow(data);
  }

  async delete(id: string): Promise<void> {
    if (!isEntityUuid(id)) return;
    const { error } = await this.supabase.from("buyer_candidates").delete().eq("id", id);
    if (error) throw error;
  }

  async findByDomain(domain: string): Promise<BuyerCandidate | undefined> {
    const normalized = normalizeDomain(domain);
    if (!normalized) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_candidates")
      .select("*")
      .eq("domain", normalized)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? candidateFromRow(data) : undefined;
  }
}

export function createBuyerCandidateRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerCandidateRepository {
  return new SupabaseBuyerCandidateRepository(supabase, workspaceId);
}
