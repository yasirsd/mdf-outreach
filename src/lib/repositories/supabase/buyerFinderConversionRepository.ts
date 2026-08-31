import type { SupabaseClient } from "@supabase/supabase-js";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import type {
  CandidateConversion,
  ConversionDuplicateMatch,
  ConversionSourceKind,
  ConvertOutcome,
  ConvertResult,
} from "@/lib/buyerFinder/conversion";
import type {
  BuyerFinderCandidateConversionRepository,
  ConversionRpcInput,
} from "../interfaces";
import { buyerFromRow, type BuyerRow } from "./mappers";

export interface BuyerFinderCandidateConversionRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  buyer_id: string;
  source_kind: string;
  contact_id: string | null;
  public_email_id: string | null;
  created_at: string;
}

function asSourceKind(raw: string): ConversionSourceKind {
  if (
    raw === "revealed_personal_contact" ||
    raw === "public_company_email" ||
    raw === "company_only"
  ) {
    return raw;
  }
  return "company_only";
}

export function conversionFromRow(r: BuyerFinderCandidateConversionRow): CandidateConversion {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    buyerId: r.buyer_id,
    sourceKind: asSourceKind(r.source_kind),
    contactId: r.contact_id ?? undefined,
    publicEmailId: r.public_email_id ?? undefined,
    createdAt: r.created_at,
  };
}

interface RpcPayload {
  outcome?: string;
  buyer_id?: string;
  conversion_id?: string;
  source_kind?: string;
  class?: string;
  reason?: string;
  company?: string;
  email?: string;
}

function asOutcome(raw: string | undefined): ConvertOutcome {
  switch (raw) {
    case "created":
    case "already_converted":
    case "duplicate":
    case "not_eligible":
    case "not_found":
    case "invalid_selection":
    case "conflict":
      return raw;
    case "unauthorized":
      return "not_found";
    default:
      return "conflict";
  }
}

function duplicateFromRpc(payload: RpcPayload): ConversionDuplicateMatch | undefined {
  if (payload.outcome !== "duplicate" || !payload.buyer_id) return undefined;
  const cls = payload.class === "possible" ? "possible" : "definite";
  const reason =
    payload.reason === "domain" || payload.reason === "company_name" ? payload.reason : "email";
  return {
    class: cls,
    buyerId: payload.buyer_id,
    company: payload.company ?? "",
    email: payload.email ?? "",
    reason,
  };
}

export class SupabaseBuyerFinderCandidateConversionRepository
  implements BuyerFinderCandidateConversionRepository
{
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async getByCandidate(candidateId: string): Promise<CandidateConversion | undefined> {
    if (!isEntityUuid(candidateId)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_candidate_conversions")
      .select("*")
      .eq("candidate_id", candidateId)
      .maybeSingle();
    if (error) throw error;
    return data ? conversionFromRow(data as BuyerFinderCandidateConversionRow) : undefined;
  }

  async listByCandidateIds(ids: string[]): Promise<CandidateConversion[]> {
    const unique = Array.from(new Set(ids.filter(isEntityUuid)));
    if (unique.length === 0) return [];
    const CHUNK = 200;
    const results: CandidateConversion[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const { data, error } = await this.supabase
        .from("buyer_finder_candidate_conversions")
        .select("*")
        .in("candidate_id", slice);
      if (error) throw error;
      for (const row of data ?? []) {
        results.push(conversionFromRow(row as BuyerFinderCandidateConversionRow));
      }
    }
    return results;
  }

  async convert(input: ConversionRpcInput): Promise<ConvertResult> {
    if (!isEntityUuid(input.candidateId)) {
      return { outcome: "invalid_selection", message: "Invalid candidate id." };
    }
    const { data, error } = await this.supabase.rpc("convert_buyer_finder_candidate", {
      p_candidate_id: input.candidateId,
      p_source_kind: input.sourceKind,
      p_contact_id: input.contactId ?? null,
      p_public_email_id: input.publicEmailId ?? null,
      p_product_interest: input.productInterest ?? null,
    });
    if (error) throw error;
    const payload = (data ?? {}) as RpcPayload;
    const outcome = asOutcome(payload.outcome);
    const duplicateMatch = duplicateFromRpc(payload);
    const result: ConvertResult = {
      outcome,
      duplicateMatch,
      message: messageFor(outcome),
    };
    if (payload.conversion_id && payload.buyer_id) {
      result.conversion = {
        id: payload.conversion_id,
        candidateId: input.candidateId,
        buyerId: payload.buyer_id,
        sourceKind: asSourceKind(payload.source_kind ?? input.sourceKind),
        contactId: input.contactId,
        publicEmailId: input.publicEmailId,
        createdAt: new Date().toISOString(),
      };
    }
    if (payload.buyer_id && isEntityUuid(payload.buyer_id)) {
      const { data: buyerRow, error: buyerError } = await this.supabase
        .from("buyers")
        .select("*")
        .eq("id", payload.buyer_id)
        .maybeSingle();
      if (buyerError) throw buyerError;
      if (buyerRow) result.buyer = buyerFromRow(buyerRow as BuyerRow);
    }
    return result;
  }
}

function messageFor(outcome: ConvertOutcome): string | undefined {
  switch (outcome) {
    case "created":
      return "Buyer created.";
    case "already_converted":
      return "This candidate is already a Buyer.";
    case "duplicate":
      return "A matching Buyer already exists.";
    case "not_eligible":
      return "This candidate cannot be converted.";
    case "not_found":
      return "Candidate not found.";
    case "invalid_selection":
      return "Choose a valid contact source.";
    default:
      return "Could not convert this candidate.";
  }
}

export function createBuyerFinderCandidateConversionRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerFinderCandidateConversionRepository {
  return new SupabaseBuyerFinderCandidateConversionRepository(supabase, workspaceId);
}
