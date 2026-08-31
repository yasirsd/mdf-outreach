import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import type { BuyerCandidatePublicEmailRepository } from "../interfaces";
import { publicEmailFromRow, publicEmailToPatchRow, publicEmailToRow } from "./candidateMappers";

function idFor(patchId: string | undefined): string {
  if (patchId && isEntityUuid(patchId)) return patchId;
  return randomUUID();
}

export class SupabaseBuyerCandidatePublicEmailRepository
  implements BuyerCandidatePublicEmailRepository
{
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async listByCandidate(candidateId: string): Promise<BuyerCandidatePublicEmail[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_candidate_public_emails")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("is_primary", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(publicEmailFromRow);
  }

  async get(id: string): Promise<BuyerCandidatePublicEmail | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_candidate_public_emails")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? publicEmailFromRow(data) : undefined;
  }

  async create(input: BuyerCandidatePublicEmail): Promise<BuyerCandidatePublicEmail> {
    const row = publicEmailToRow({ ...input, id: idFor(input.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("buyer_candidate_public_emails")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return publicEmailFromRow(data);
  }

  async update(
    id: string,
    patch: Partial<BuyerCandidatePublicEmail>,
  ): Promise<BuyerCandidatePublicEmail> {
    if (!isEntityUuid(id)) throw new Error("Invalid public email id");
    const fields = publicEmailToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("buyer_candidate_public_emails")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return publicEmailFromRow(data);
  }

  async delete(id: string): Promise<void> {
    if (!isEntityUuid(id)) return;
    const { error } = await this.supabase.from("buyer_candidate_public_emails").delete().eq("id", id);
    if (error) throw error;
  }
}

export function createBuyerCandidatePublicEmailRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerCandidatePublicEmailRepository {
  return new SupabaseBuyerCandidatePublicEmailRepository(supabase, workspaceId);
}
