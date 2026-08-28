import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { BuyerCandidateContact } from "@/lib/buyerFinder/types";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { normalizeOptionalEmail } from "@/lib/buyerFinder/normalize";
import type { BuyerCandidateContactRepository } from "../interfaces";
import { contactFromRow, contactToPatchRow, contactToRow } from "./candidateMappers";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function idFor(patchId: string | undefined): string {
  if (patchId && isUuid(patchId)) return patchId;
  return randomUUID();
}

export class SupabaseBuyerCandidateContactRepository implements BuyerCandidateContactRepository {
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async listByCandidate(candidateId: string): Promise<BuyerCandidateContact[]> {
    if (!isEntityUuid(candidateId)) return [];
    const { data, error } = await this.supabase
      .from("buyer_candidate_contacts")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("is_primary", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(contactFromRow);
  }

  async get(id: string): Promise<BuyerCandidateContact | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_candidate_contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? contactFromRow(data) : undefined;
  }

  async create(input: BuyerCandidateContact): Promise<BuyerCandidateContact> {
    const row = contactToRow({ ...input, id: idFor(input.id) }, this.workspaceId);
    const { data, error } = await this.supabase
      .from("buyer_candidate_contacts")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return contactFromRow(data);
  }

  async update(id: string, patch: Partial<BuyerCandidateContact>): Promise<BuyerCandidateContact> {
    if (!isEntityUuid(id)) throw new Error("Invalid contact id");
    const fields = contactToPatchRow(patch);
    const { data, error } = await this.supabase
      .from("buyer_candidate_contacts")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return contactFromRow(data);
  }

  async delete(id: string): Promise<void> {
    if (!isEntityUuid(id)) return;
    const { error } = await this.supabase.from("buyer_candidate_contacts").delete().eq("id", id);
    if (error) throw error;
  }

  async findByEmail(email: string): Promise<BuyerCandidateContact | undefined> {
    const normalized = normalizeOptionalEmail(email);
    if (!normalized) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_candidate_contacts")
      .select("*")
      .eq("business_email", normalized)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? contactFromRow(data) : undefined;
  }

  async findByProviderRef(source: string, providerRef: string): Promise<BuyerCandidateContact | undefined> {
    const src = source.trim();
    const ref = providerRef.trim();
    if (!src || !ref) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_candidate_contacts")
      .select("*")
      .eq("source", src)
      .eq("provider_ref", ref)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? contactFromRow(data) : undefined;
  }
}

export function createBuyerCandidateContactRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerCandidateContactRepository {
  return new SupabaseBuyerCandidateContactRepository(supabase, workspaceId);
}
