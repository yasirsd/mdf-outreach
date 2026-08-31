import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import type {
  BuyerFinderContactRevealEvent,
  ContactRevealEventStatus,
  ContactRevealProviderOutcome,
} from "@/lib/buyerFinder/contactRevealEvent";
import { CONTACT_REVEAL_UNRESOLVED_STATUSES } from "@/lib/buyerFinder/contactRevealEvent";
import type {
  BuyerFinderContactRevealEventRepository,
  RevealEventFinalizeInput,
  RevealEventInsertInput,
} from "../interfaces";
import { RevealEventActiveExistsError } from "../interfaces";

export interface BuyerFinderContactRevealEventRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  contact_id: string;
  provider: string;
  status: string;
  provider_outcome: string | null;
  credits_charged: number | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function asStatus(raw: string): ContactRevealEventStatus {
  if (
    raw === "pending" ||
    raw === "processing" ||
    raw === "succeeded" ||
    raw === "failed" ||
    raw === "reconciliation_required"
  ) {
    return raw;
  }
  return "failed";
}

function asOutcome(raw: string | null): ContactRevealProviderOutcome | undefined {
  if (
    raw === "revealed" ||
    raw === "already_revealed" ||
    raw === "not_found" ||
    raw === "insufficient_credits" ||
    raw === "invalid_response" ||
    raw === "provider_error"
  ) {
    return raw;
  }
  return undefined;
}

export function revealEventFromRow(r: BuyerFinderContactRevealEventRow): BuyerFinderContactRevealEvent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    candidateId: r.candidate_id,
    contactId: r.contact_id,
    provider: "hunter",
    status: asStatus(r.status),
    providerOutcome: asOutcome(r.provider_outcome),
    creditsCharged: r.credits_charged,
    errorCode: r.error_code ?? undefined,
    createdAt: r.created_at,
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
  };
}

export class SupabaseBuyerFinderContactRevealEventRepository
  implements BuyerFinderContactRevealEventRepository
{
  constructor(
    private supabase: SupabaseClient,
    private workspaceId: string,
  ) {}

  async insertPending(input: RevealEventInsertInput): Promise<BuyerFinderContactRevealEvent> {
    if (!isEntityUuid(input.candidateId) || !isEntityUuid(input.contactId)) {
      throw new Error("Invalid reveal event ids");
    }
    const row = {
      id: randomUUID(),
      workspace_id: this.workspaceId,
      candidate_id: input.candidateId,
      contact_id: input.contactId,
      provider: input.provider ?? "hunter",
      status: "pending",
    };
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw new RevealEventActiveExistsError();
      throw error;
    }
    return revealEventFromRow(data as BuyerFinderContactRevealEventRow);
  }

  async get(id: string): Promise<BuyerFinderContactRevealEvent | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? revealEventFromRow(data as BuyerFinderContactRevealEventRow) : undefined;
  }

  async getActiveForContact(contactId: string): Promise<BuyerFinderContactRevealEvent | undefined> {
    if (!isEntityUuid(contactId)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .select("*")
      .eq("contact_id", contactId)
      .in("status", [...CONTACT_REVEAL_UNRESOLVED_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? revealEventFromRow(data as BuyerFinderContactRevealEventRow) : undefined;
  }

  async getLatestForContact(contactId: string): Promise<BuyerFinderContactRevealEvent | undefined> {
    if (!isEntityUuid(contactId)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? revealEventFromRow(data as BuyerFinderContactRevealEventRow) : undefined;
  }

  async claimProcessing(id: string): Promise<BuyerFinderContactRevealEvent | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? revealEventFromRow(data as BuyerFinderContactRevealEventRow) : undefined;
  }

  async claimReconciliation(id: string): Promise<BuyerFinderContactRevealEvent | undefined> {
    if (!isEntityUuid(id)) return undefined;
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        completed_at: null,
        error_code: null,
        provider_outcome: null,
        credits_charged: null,
      })
      .eq("id", id)
      .eq("status", "reconciliation_required")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? revealEventFromRow(data as BuyerFinderContactRevealEventRow) : undefined;
  }

  async markReconciliationRequired(id: string): Promise<BuyerFinderContactRevealEvent> {
    if (!isEntityUuid(id)) throw new Error("Invalid reveal event id");
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .update({
        status: "reconciliation_required",
        completed_at: new Date().toISOString(),
        error_code: "stale_processing",
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return revealEventFromRow(data as BuyerFinderContactRevealEventRow);
  }

  async finalize(id: string, patch: RevealEventFinalizeInput): Promise<BuyerFinderContactRevealEvent> {
    if (!isEntityUuid(id)) throw new Error("Invalid reveal event id");
    const fields: Record<string, unknown> = {
      status: patch.status,
      completed_at: new Date().toISOString(),
    };
    if (patch.providerOutcome !== undefined) fields.provider_outcome = patch.providerOutcome;
    if (patch.creditsCharged !== undefined) fields.credits_charged = patch.creditsCharged;
    if (patch.errorCode !== undefined) fields.error_code = patch.errorCode;
    const { data, error } = await this.supabase
      .from("buyer_finder_contact_reveal_events")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return revealEventFromRow(data as BuyerFinderContactRevealEventRow);
  }
}

export function createBuyerFinderContactRevealEventRepository(
  supabase: SupabaseClient,
  workspaceId: string,
): BuyerFinderContactRevealEventRepository {
  return new SupabaseBuyerFinderContactRevealEventRepository(supabase, workspaceId);
}
