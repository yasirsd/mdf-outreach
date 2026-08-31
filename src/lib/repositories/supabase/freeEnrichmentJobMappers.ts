import type {
  FreeEnrichmentCapability,
  FreeEnrichmentJob,
  FreeEnrichmentJobStatus,
} from "@/lib/buyerFinder/freeEnrichmentJob";
import {
  isFreeEnrichmentCapability,
  isFreeEnrichmentJobStatus,
} from "@/lib/buyerFinder/freeEnrichmentJob";
import { newEntityId } from "@/lib/buyerFinder/ids";

export interface FreeEnrichmentJobRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  capability: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  provider_outcome: string | null;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export function freeEnrichmentJobFromRow(row: FreeEnrichmentJobRow): FreeEnrichmentJob {
  const capability = isFreeEnrichmentCapability(row.capability)
    ? row.capability
    : "public_company_contacts";
  const status = isFreeEnrichmentJobStatus(row.status) ? row.status : "failed";
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    candidateId: row.candidate_id,
    capability,
    status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at ?? undefined,
    providerOutcome: row.provider_outcome ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function freeEnrichmentJobToInsertRow(
  input: {
    candidateId: string;
    capability: FreeEnrichmentCapability;
    status: FreeEnrichmentJobStatus;
    providerOutcome?: string | null;
    completedAt?: string | null;
  },
  workspaceId: string,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: newEntityId(),
    workspace_id: workspaceId,
    candidate_id: input.candidateId,
    capability: input.capability,
    status: input.status,
    attempt_count: 0,
    provider_outcome: input.providerOutcome ?? null,
    completed_at: input.completedAt ?? (input.status === "succeeded" || input.status === "no_result" ? now : null),
    created_at: now,
    updated_at: now,
  };
}
