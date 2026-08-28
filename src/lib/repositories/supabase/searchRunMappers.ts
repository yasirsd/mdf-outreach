import type {
  BuyerFinderSearchRun,
  SearchRunCostClass,
  SearchRunPatch,
  SearchRunStage,
  SearchRunStatus,
} from "@/lib/buyerFinder/searchRun";
import type { ProviderNeutralOutcome } from "@/lib/buyerFinder/providers/descriptors";
import type { BuyerTypeOption, ContactPriorityId } from "@/lib/buyerFinder/types";

export interface BuyerFinderSearchRunRow {
  id: string;
  workspace_id: string;
  country: string;
  business_product_id: string;
  desired_buyer_types: string[] | null;
  contact_priorities: string[] | null;
  provider: string;
  provider_status: ProviderNeutralOutcome | null;
  status: SearchRunStatus;
  stage: SearchRunStage;
  discovered_count: number;
  usable_count: number;
  processed_count: number;
  created_count: number;
  enriched_existing_count: number;
  duplicate_count: number;
  product_matches_added: number;
  failure_count: number;
  credits_used: number;
  cost_class: SearchRunCostClass;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function asStringArray(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

export function searchRunFromRow(row: BuyerFinderSearchRunRow): BuyerFinderSearchRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    country: row.country ?? "",
    businessProductId: row.business_product_id ?? "",
    desiredBuyerTypes: asStringArray(row.desired_buyer_types) as BuyerTypeOption[],
    contactPriorities: asStringArray(row.contact_priorities) as ContactPriorityId[],
    provider: "hunter",
    providerStatus: row.provider_status ?? null,
    status: row.status,
    stage: row.stage,
    discoveredCount: row.discovered_count ?? 0,
    usableCount: row.usable_count ?? 0,
    processedCount: row.processed_count ?? 0,
    createdCount: row.created_count ?? 0,
    enrichedExistingCount: row.enriched_existing_count ?? 0,
    duplicateCount: row.duplicate_count ?? 0,
    productMatchesAdded: row.product_matches_added ?? 0,
    failureCount: row.failure_count ?? 0,
    creditsUsed: row.credits_used ?? 0,
    costClass: row.cost_class === "paid" ? "paid" : "free",
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function searchRunToInsertRow(
  input: {
    country: string;
    businessProductId: string;
    desiredBuyerTypes: BuyerTypeOption[];
    contactPriorities: ContactPriorityId[];
  },
  workspaceId: string,
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    country: input.country,
    business_product_id: input.businessProductId,
    desired_buyer_types: input.desiredBuyerTypes,
    contact_priorities: input.contactPriorities,
    provider: "hunter",
    status: "queued",
    stage: "preparing",
    credits_used: 0,
    cost_class: "free",
  };
}

export function searchRunToPatchRow(patch: SearchRunPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.stage !== undefined) row.stage = patch.stage;
  if (patch.providerStatus !== undefined) row.provider_status = patch.providerStatus;
  if (patch.discoveredCount !== undefined) row.discovered_count = patch.discoveredCount;
  if (patch.usableCount !== undefined) row.usable_count = patch.usableCount;
  if (patch.processedCount !== undefined) row.processed_count = patch.processedCount;
  if (patch.createdCount !== undefined) row.created_count = patch.createdCount;
  if (patch.enrichedExistingCount !== undefined) row.enriched_existing_count = patch.enrichedExistingCount;
  if (patch.duplicateCount !== undefined) row.duplicate_count = patch.duplicateCount;
  if (patch.productMatchesAdded !== undefined) row.product_matches_added = patch.productMatchesAdded;
  if (patch.failureCount !== undefined) row.failure_count = patch.failureCount;
  if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  return row;
}
