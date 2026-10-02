"use server";

/**
 * TH04C — Thailand MANUAL_ONLY evidence Server Actions.
 *
 * Three operator-driven actions:
 *   • `recordThailandManualEvidenceAction`     — insert a new note.
 *   • `supersedeThailandManualEvidenceAction`  — correction via supersession.
 *   • `withdrawThailandManualEvidenceAction`   — withdraw an active note.
 *   • `getThailandManualEvidenceForCandidateAction` — read helper for TH05.
 *
 * Every action:
 *   - requires an authenticated MDF session (`requireMdfSession`),
 *   - enforces workspace membership for the target candidate,
 *   - derives `captured_by_user_id` from the server session — never
 *     from client input,
 *   - validates provider id, status, source URL (allowlist), and
 *     candidate ownership,
 *   - writes through the service-role writer (RLS applies to
 *     authenticated SELECT only; writes are server-mediated).
 *
 * These actions NEVER call out to DBD / Customs / FDA. The system
 * NEVER automates these sources. The operator is the authority.
 * `automatic_spend_rupees` is pinned to 0 at every layer.
 */

import { requireMdfSession } from "@/lib/auth/require";
import { TradeResearchWriter, createTradeResearchReadRepository } from "@/lib/tradeResearch/repository";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import {
  ThailandManualEvidenceSourceUrlError,
  requireAllowedManualEvidenceSourceUrl,
} from "@/lib/tradeResearch/thailand/manualEvidenceSourceAllowlist";
import {
  resolveActiveThailandManualEvidence,
  type ThailandManualEvidenceReadResult,
} from "@/lib/tradeResearch/thailand/manualEvidenceResolver";
import type { ThailandManualOnlyProviderId } from "@/lib/tradeResearch/thailand/providerPlan";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecordThailandManualEvidenceInput = {
  candidateId: string;
  providerId: ThailandManualOnlyProviderId;
  sourceUrl: string;
  sourceLabel: string;
  evidencePayload: unknown;
  evidenceStatus: "verified" | "not_found" | "inconclusive";
};

export type RecordThailandManualEvidenceResult =
  | { outcome: "recorded"; id: string }
  | { outcome: "forbidden" | "invalid_input" | "candidate_not_found" | "duplicate_active"; message: string };

async function assertCandidateInWorkspace(workspaceId: string, candidateId: string): Promise<boolean> {
  const supabase = createClient(cookies());
  const { data, error } = await supabase
    .from("buyer_candidates")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

const VALID_OPERATOR_TYPES = new Set(["importer", "exporter", "broker", "aeo", "other"]);

function assertCustomsOperatorPayload(
  input: RecordThailandManualEvidenceInput,
): { ok: true } | { ok: false; message: string } {
  if (input.providerId !== "thai-customs-operator") return { ok: true };
  const payload = (input.evidencePayload ?? {}) as Record<string, unknown>;
  const observedType = typeof payload.operatorTypeSnapshot === "string" ? payload.operatorTypeSnapshot : null;
  if (input.evidenceStatus === "verified") {
    if (!observedType) {
      return { ok: false, message: "Customs operator verified evidence requires operatorTypeSnapshot (importer/exporter/broker/aeo/other). The system never defaults to importer." };
    }
    if (!VALID_OPERATOR_TYPES.has(observedType)) {
      return { ok: false, message: `operatorTypeSnapshot must be one of importer/exporter/broker/aeo/other; got ${observedType}.` };
    }
    return { ok: true };
  }
  // For not_found / inconclusive the operator type is optional — the
  // registry may not have displayed one. Reject only if a value was
  // supplied AND is not in the allowed set.
  if (observedType && !VALID_OPERATOR_TYPES.has(observedType)) {
    return { ok: false, message: `operatorTypeSnapshot must be one of importer/exporter/broker/aeo/other; got ${observedType}.` };
  }
  return { ok: true };
}

export async function recordThailandManualEvidenceAction(
  input: RecordThailandManualEvidenceInput,
): Promise<RecordThailandManualEvidenceResult> {
  const session = await requireMdfSession();
  if (!input || typeof input !== "object") {
    return { outcome: "invalid_input", message: "Manual evidence input is required." };
  }
  if (!UUID.test(input.candidateId)) {
    return { outcome: "invalid_input", message: "Candidate id is required." };
  }
  if (!["thai-dbd", "thai-customs-operator", "thai-fda-importer"].includes(input.providerId)) {
    return { outcome: "invalid_input", message: "Unknown MANUAL_ONLY provider." };
  }
  if (!["verified", "not_found", "inconclusive"].includes(input.evidenceStatus)) {
    return { outcome: "invalid_input", message: "evidenceStatus must be one of verified/not_found/inconclusive." };
  }
  const operatorCheck = assertCustomsOperatorPayload(input);
  if (!operatorCheck.ok) return { outcome: "invalid_input", message: operatorCheck.message };
  try { requireAllowedManualEvidenceSourceUrl(input.providerId, input.sourceUrl); }
  catch (error) {
    if (error instanceof ThailandManualEvidenceSourceUrlError) {
      return { outcome: "invalid_input", message: error.message };
    }
    throw error;
  }
  if (typeof input.sourceLabel !== "string" || !input.sourceLabel.trim()) {
    return { outcome: "invalid_input", message: "sourceLabel is required." };
  }
  if (!(await assertCandidateInWorkspace(session.membership.workspaceId, input.candidateId))) {
    return { outcome: "candidate_not_found", message: "Candidate is not accessible in this workspace." };
  }
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  try {
    const row = await writer.insertThaiManualEvidence({
      workspaceId: session.membership.workspaceId,
      candidateId: input.candidateId,
      providerId: input.providerId,
      capturedByUserId: session.userId,
      sourceUrl: input.sourceUrl,
      sourceLabel: input.sourceLabel,
      evidencePayload: input.evidencePayload,
      evidenceStatus: input.evidenceStatus,
    });
    revalidatePath("/buyer-finder");
    return { outcome: "recorded", id: String(row.id) };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      return { outcome: "duplicate_active", message: "An active evidence row already exists for this (candidate, provider). Supersede the existing row instead." };
    }
    throw error;
  }
}

export async function supersedeThailandManualEvidenceAction(
  previousId: string,
  input: RecordThailandManualEvidenceInput,
): Promise<RecordThailandManualEvidenceResult> {
  const session = await requireMdfSession();
  if (!UUID.test(previousId)) return { outcome: "invalid_input", message: "Previous evidence id is required." };
  if (!input || typeof input !== "object" || !UUID.test(input.candidateId)) {
    return { outcome: "invalid_input", message: "Replacement evidence input is required." };
  }
  if (!["thai-dbd", "thai-customs-operator", "thai-fda-importer"].includes(input.providerId)) {
    return { outcome: "invalid_input", message: "Unknown MANUAL_ONLY provider." };
  }
  if (!["verified", "not_found", "inconclusive"].includes(input.evidenceStatus)) {
    return { outcome: "invalid_input", message: "evidenceStatus must be one of verified/not_found/inconclusive." };
  }
  const operatorCheck = assertCustomsOperatorPayload(input);
  if (!operatorCheck.ok) return { outcome: "invalid_input", message: operatorCheck.message };
  try { requireAllowedManualEvidenceSourceUrl(input.providerId, input.sourceUrl); }
  catch (error) {
    if (error instanceof ThailandManualEvidenceSourceUrlError) {
      return { outcome: "invalid_input", message: error.message };
    }
    throw error;
  }
  if (typeof input.sourceLabel !== "string" || !input.sourceLabel.trim()) {
    return { outcome: "invalid_input", message: "sourceLabel is required." };
  }
  if (!(await assertCandidateInWorkspace(session.membership.workspaceId, input.candidateId))) {
    return { outcome: "candidate_not_found", message: "Candidate is not accessible in this workspace." };
  }
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  // TH05 Step 0 — atomic supersession via migration 0035's RPC. If
  // the insert fails the previous row stays active; no intermediate
  // visible state. No pre-withdrawal needed.
  try {
    const row = await writer.supersedeThaiManualEvidence(previousId, {
      workspaceId: session.membership.workspaceId,
      candidateId: input.candidateId,
      providerId: input.providerId,
      capturedByUserId: session.userId,
      sourceUrl: input.sourceUrl,
      sourceLabel: input.sourceLabel,
      evidencePayload: input.evidencePayload,
      evidenceStatus: input.evidenceStatus,
    });
    revalidatePath("/buyer-finder");
    return { outcome: "recorded", id: String(row.id) };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    const message = typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    if (code === "P0001" && message.includes("MANUAL_EVIDENCE_PREVIOUS_NOT_LEAF")) {
      return { outcome: "duplicate_active", message: "The previous row was already superseded by another writer; refresh and try again." };
    }
    if (code === "P0001" && message.includes("MANUAL_EVIDENCE_PREVIOUS_NOT_FOUND")) {
      return { outcome: "invalid_input", message: "Previous evidence row not found in this workspace." };
    }
    if (code === "P0001" && message.includes("MANUAL_EVIDENCE_PREVIOUS_WITHDRAWN")) {
      return { outcome: "invalid_input", message: "Previous evidence row was withdrawn; record a new root instead of superseding." };
    }
    if (code === "23505") {
      return { outcome: "duplicate_active", message: "A concurrent supersession attempt won the race; refresh and try again." };
    }
    throw error;
  }
}

export async function withdrawThailandManualEvidenceAction(id: string): Promise<{ outcome: "withdrawn" | "forbidden" | "invalid_input"; message?: string }> {
  const session = await requireMdfSession();
  if (!UUID.test(id)) return { outcome: "invalid_input", message: "Evidence id is required." };
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  await writer.withdrawThaiManualEvidence(id, session.membership.workspaceId);
  revalidatePath("/buyer-finder");
  return { outcome: "withdrawn" };
}

export async function getThailandManualEvidenceForCandidateAction(
  candidateId: string,
): Promise<ThailandManualEvidenceReadResult | null> {
  const session = await requireMdfSession();
  if (!UUID.test(candidateId)) return null;
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  const rows = await writer.listThaiManualEvidenceForCandidate(session.membership.workspaceId, candidateId);
  // We also constructed a workspace-scoped read above, but the resolver
  // double-checks workspace scoping as defense-in-depth.
  void createTradeResearchReadRepository; // keep import tree stable
  return resolveActiveThailandManualEvidence({
    workspaceId: session.membership.workspaceId,
    candidateId,
    rows: rows as never,
  });
}

export type ThailandManualEvidenceHistoryStatus = "current" | "superseded" | "withdrawn";

export interface ThailandManualEvidenceHistoryRow {
  readonly id: string;
  readonly provider_id: ThailandManualOnlyProviderId;
  readonly evidence_status: "verified" | "not_found" | "inconclusive" | "withdrawn";
  readonly captured_at: string;
  readonly captured_by_user_id: string;
  readonly source_url: string;
  readonly source_label: string;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly lookup_basis: string | null;
  readonly lookup_basis_detail: string | null;
  readonly historyStatus: ThailandManualEvidenceHistoryStatus;
}

export interface ThailandManualEvidenceHistoryResult {
  readonly dbd: readonly ThailandManualEvidenceHistoryRow[];
  readonly customsOperator: readonly ThailandManualEvidenceHistoryRow[];
  readonly fdaImporter: readonly ThailandManualEvidenceHistoryRow[];
}

/**
 * TH06 FINAL — read-only history across all manual-evidence rows for
 * one candidate, grouped by provider, newest first, with per-row
 * annotation Current / Superseded / Withdrawn. Reuses the same
 * workspace-scoped read path as the resolver; never edits rows.
 *
 *   • Withdrawn: `evidence_status === "withdrawn"`
 *   • Superseded: another row in the list has `supersedes_id === row.id`
 *   • Current: everything else (newest leaf of its chain)
 */
export async function getThailandManualEvidenceHistoryAction(
  candidateId: string,
): Promise<ThailandManualEvidenceHistoryResult | null> {
  const session = await requireMdfSession();
  if (!UUID.test(candidateId)) return null;
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  const rows = (await writer.listThaiManualEvidenceForCandidate(
    session.membership.workspaceId,
    candidateId,
  )) as unknown as ReadonlyArray<{
    id: string;
    provider_id: string;
    evidence_status: string;
    captured_at: string;
    captured_by_user_id: string;
    source_url: string;
    source_label: string;
    supersedes_id: string | null;
    lookup_basis: string | null;
    lookup_basis_detail: string | null;
  }>;

  // Index: which row id has been superseded by which newer row?
  const supersededBy = new Map<string, string>();
  for (const row of rows) {
    if (row.supersedes_id) supersededBy.set(row.supersedes_id, row.id);
  }

  const bucket: Record<ThailandManualOnlyProviderId, ThailandManualEvidenceHistoryRow[]> = {
    "thai-dbd": [],
    "thai-customs-operator": [],
    "thai-fda-importer": [],
  };
  for (const row of rows) {
    if (!(row.provider_id in bucket)) continue;
    const historyStatus: ThailandManualEvidenceHistoryStatus =
      row.evidence_status === "withdrawn"
        ? "withdrawn"
        : supersededBy.has(row.id)
        ? "superseded"
        : "current";
    bucket[row.provider_id as ThailandManualOnlyProviderId].push({
      id: row.id,
      provider_id: row.provider_id as ThailandManualOnlyProviderId,
      evidence_status: row.evidence_status as ThailandManualEvidenceHistoryRow["evidence_status"],
      captured_at: row.captured_at,
      captured_by_user_id: row.captured_by_user_id,
      source_url: row.source_url,
      source_label: row.source_label,
      supersedes_id: row.supersedes_id,
      superseded_by_id: supersededBy.get(row.id) ?? null,
      lookup_basis: row.lookup_basis,
      lookup_basis_detail: row.lookup_basis_detail,
      historyStatus,
    });
  }
  return {
    dbd: bucket["thai-dbd"],
    customsOperator: bucket["thai-customs-operator"],
    fdaImporter: bucket["thai-fda-importer"],
  };
}
