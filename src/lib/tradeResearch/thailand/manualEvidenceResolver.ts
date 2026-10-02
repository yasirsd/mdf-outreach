/**
 * TH05 Step 0A — Deterministic active-evidence resolver.
 *
 * CORRECTED semantics (fixes the TH04C bug where a correction row
 * carrying `supersedes_id = <previous>` was wrongly treated as
 * inactive):
 *
 *   An evidence row is ACTIVE (the CURRENT LEAF) when:
 *     1. `evidence_status != 'withdrawn'`
 *     2. NO OTHER row in the same `(workspace, candidate, provider)`
 *        references this row via `supersedes_id`.
 *
 * In SQL:
 *   NOT EXISTS (
 *     SELECT 1
 *     FROM buyer_trade_research_thai_manual_evidence newer
 *     WHERE newer.supersedes_id = row.id
 *   )
 *
 * At most one leaf per `(workspace, candidate, provider)` is
 * enforced by migration 0035's two unique indexes plus the
 * transactional `supersede_thai_manual_evidence` RPC. The
 * resolver still surfaces a conflict if duplicate leaves are
 * observed (defense-in-depth); it never silently picks one.
 *
 * Rows for a different workspace / candidate are IGNORED (RLS
 * already excludes cross-workspace rows).
 */

import type { ThailandManualOnlyProviderId } from "./providerPlan";

export interface ThailandManualEvidenceActiveRow {
  readonly id: string;
  readonly provider_id: ThailandManualOnlyProviderId;
  readonly captured_at: string;
  readonly captured_by_user_id: string;
  readonly source_url: string;
  readonly source_label: string;
  readonly evidence_payload: unknown;
  readonly evidence_status: "verified" | "not_found" | "inconclusive";
  readonly workspace_id: string;
  readonly candidate_id: string;
  /** TH06 Step 0D — authoritative-lookup basis; null for pre-TH06 rows. */
  readonly lookup_basis: string | null;
  readonly lookup_basis_detail: string | null;
}

export interface ThailandManualEvidenceReadResult {
  readonly dbd?: ThailandManualEvidenceActiveRow;
  readonly customsOperator?: ThailandManualEvidenceActiveRow;
  readonly fdaImporter?: ThailandManualEvidenceActiveRow;
  readonly conflicts: readonly {
    readonly providerId: ThailandManualOnlyProviderId;
    readonly rowIds: readonly string[];
    readonly reason: "duplicate_active";
  }[];
}

/**
 * Project a raw list of manual-evidence rows (all workspaces /
 * candidates mixed is tolerated — the resolver filters) into the
 * per-provider active view. Rows with mismatched workspace or
 * candidate are silently excluded.
 */
export function resolveActiveThailandManualEvidence(input: {
  workspaceId: string;
  candidateId: string;
  rows: readonly Record<string, unknown>[];
}): ThailandManualEvidenceReadResult {
  const scoped = input.rows.filter((r) => r.workspace_id === input.workspaceId && r.candidate_id === input.candidateId);
  // Build the set of row ids that are superseded by some other row.
  const supersededIds = new Set<string>();
  for (const r of scoped) {
    const parent = r.supersedes_id;
    if (typeof parent === "string" && parent) supersededIds.add(parent);
  }
  // A row is a current LEAF when it has no child AND is not withdrawn.
  const perProvider = new Map<ThailandManualOnlyProviderId, Record<string, unknown>[]>();
  for (const r of scoped) {
    const id = typeof r.id === "string" ? r.id : null;
    if (!id) continue;
    if (supersededIds.has(id)) continue; // historical ancestor
    if (r.evidence_status === "withdrawn") continue;
    const pid = r.provider_id as ThailandManualOnlyProviderId;
    const bucket = perProvider.get(pid) ?? [];
    bucket.push(r);
    perProvider.set(pid, bucket);
  }
  const result: {
    dbd?: ThailandManualEvidenceActiveRow;
    customsOperator?: ThailandManualEvidenceActiveRow;
    fdaImporter?: ThailandManualEvidenceActiveRow;
  } = {};
  const conflicts: Array<{ providerId: ThailandManualOnlyProviderId; rowIds: string[]; reason: "duplicate_active" }> = [];
  for (const [pid, bucket] of perProvider.entries()) {
    if (bucket.length > 1) {
      conflicts.push({
        providerId: pid,
        rowIds: bucket.map((b) => String(b.id)),
        reason: "duplicate_active",
      });
      continue;
    }
    const row = bucket[0]!;
    const projected: ThailandManualEvidenceActiveRow = {
      id: String(row.id),
      provider_id: pid,
      captured_at: String(row.captured_at),
      captured_by_user_id: String(row.captured_by_user_id),
      source_url: String(row.source_url),
      source_label: String(row.source_label),
      evidence_payload: row.evidence_payload,
      evidence_status: row.evidence_status as "verified" | "not_found" | "inconclusive",
      workspace_id: String(row.workspace_id),
      candidate_id: String(row.candidate_id),
      lookup_basis: typeof row.lookup_basis === "string" ? row.lookup_basis : null,
      lookup_basis_detail: typeof row.lookup_basis_detail === "string" ? row.lookup_basis_detail : null,
    };
    if (pid === "thai-dbd") result.dbd = projected;
    else if (pid === "thai-customs-operator") result.customsOperator = projected;
    else if (pid === "thai-fda-importer") result.fdaImporter = projected;
  }
  return { ...result, conflicts };
}
