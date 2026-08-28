import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type {
  BusinessProductId,
  BuyerCandidateProductMatch,
} from "@/lib/buyerFinder/types";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { requireBusinessProductId } from "@/lib/buyerFinder/productKey";
import type { BuyerCandidateProductMatchRepository } from "../interfaces";
import {
  productMatchFromRow,
  productMatchToPatchRow,
  productMatchToRow,
} from "./candidateMappers";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function idFor(patchId: string | undefined): string {
  if (patchId && isUuid(patchId)) return patchId;
  return randomUUID();
}

export class SupabaseBuyerCandidateProductMatchRepository
  implements BuyerCandidateProductMatchRepository
{
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async listByCandidate(candidateId: string): Promise<BuyerCandidateProductMatch[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_candidate_product_matches")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("relevance", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(productMatchFromRow);
  }

  async create(input: BuyerCandidateProductMatch): Promise<BuyerCandidateProductMatch> {
    const row = productMatchToRow({ ...input, id: idFor(input.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("buyer_candidate_product_matches")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return productMatchFromRow(data);
  }

  async update(
    id: string,
    patch: Partial<BuyerCandidateProductMatch>,
  ): Promise<BuyerCandidateProductMatch> {
    if (!isEntityUuid(id)) throw new Error("Invalid product match id");
    const fields = productMatchToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("buyer_candidate_product_matches")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return productMatchFromRow(data);
  }

  async delete(id: string): Promise<void> {
    if (!isEntityUuid(id)) return;
    const { error } = await this.supabase
      .from("buyer_candidate_product_matches")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }

  async findByCandidateAndProduct(
    candidateId: string,
    productId: BusinessProductId,
  ): Promise<BuyerCandidateProductMatch | undefined> {
    if (!isEntityUuid(candidateId)) return undefined;
    const key = requireBusinessProductId(productId);
    const { data, error } = await this.supabase
      .from("buyer_candidate_product_matches")
      .select("*")
      .eq("candidate_id", candidateId)
      .eq("product_key", key)
      .maybeSingle();
    if (error) throw error;
    return data ? productMatchFromRow(data) : undefined;
  }
}

export function createBuyerCandidateProductMatchRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerCandidateProductMatchRepository {
  return new SupabaseBuyerCandidateProductMatchRepository(supabase, workspaceId);
}
