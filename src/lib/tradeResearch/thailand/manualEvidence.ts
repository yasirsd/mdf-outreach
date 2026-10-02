/**
 * TH02 — Thailand manual-evidence type contract (types only).
 *
 * The three MANUAL_ONLY surfaces — DBD, Thai Customs operator
 * registry, and Thai FDA food-importer licence lookup — are NEVER
 * scraped by the T11 executor. Operators who have manually
 * verified a candidate against those registries record a note here.
 * TH04C adds the persistence; TH05 aggregates. This module locks
 * only the shape so TH03/TH04 downstream work has one source of
 * truth to refer to.
 *
 * The persistence model is append-only (future). Any correction
 * must come as a new note with a reference to the superseded id,
 * never an in-place mutation.
 */

import type { ThailandManualOnlyProviderId } from "./providerPlan";

export const THAILAND_MANUAL_EVIDENCE_CONTRACT_VERSION = "thailand-manual-evidence-v1" as const;

/** Status the operator attests to for a given manual-only provider. */
export type ThailandManualEvidenceStatus =
  | "verified"
  | "not_found"
  | "inconclusive"
  | "withdrawn";

/**
 * Opaque per-provider payload the operator captured. Shape varies
 * per provider; downstream code reads provider-specific fields via
 * the discriminated union below. UTF-8 strings only — no HTML.
 */
export type ThailandManualEvidencePayload =
  | ThaiDbdPayload
  | ThaiCustomsOperatorPayload
  | ThaiFdaImporterPayload;

export interface ThaiDbdPayload {
  readonly kind: "thai-dbd";
  /** Thai juristic registration number (13 digits). Never generated — only operator-supplied. */
  readonly juristicRegistrationNumber: string;
  /** Legal name as displayed on DBD at capture time. */
  readonly legalNameSnapshot: string;
  /** Registered address at capture time (as displayed on DBD). */
  readonly registeredAddressSnapshot: string | null;
  /** Current registration status at capture time. */
  readonly registrationStatusSnapshot: string | null;
}

export interface ThaiCustomsOperatorPayload {
  readonly kind: "thai-customs-operator";
  readonly operatorIdSnapshot: string | null;
  readonly operatorTypeSnapshot: "importer" | "exporter" | "broker" | "aeo" | "other" | null;
  readonly registrationStatusSnapshot: "active" | "inactive" | "unknown";
}

export interface ThaiFdaImporterPayload {
  readonly kind: "thai-fda-importer";
  readonly licenseNumberSnapshot: string;
  readonly licenseTypeSnapshot: string | null;
  readonly validFromSnapshot: string | null; // ISO date
  readonly validUntilSnapshot: string | null; // ISO date
  readonly licenseeAddressSnapshot: string | null;
}

/**
 * The persisted note shape. Append-only. The storage layer in TH04C
 * is expected to enforce immutability on identity fields via a
 * trigger — same shape as T12 certifications.
 */
export interface ThailandManualEvidenceNote {
  /** Server-assigned UUID. */
  readonly id: string;
  readonly workspace_id: string;
  readonly candidate_id: string;
  readonly provider_id: ThailandManualOnlyProviderId;
  readonly captured_at: string; // ISO timestamp
  readonly captured_by_user_id: string;
  /** URL of the official page the operator consulted. MUST be a well-known registry URL. */
  readonly source_url: string;
  /** Operator-chosen short label (e.g. "DBD DataWarehouse+ company search"). */
  readonly source_label: string;
  readonly evidence_payload: ThailandManualEvidencePayload;
  readonly evidence_status: ThailandManualEvidenceStatus;
  /** Append-only chain reference when the operator supersedes an earlier note. */
  readonly supersedes_id?: string;
  /** Append-only — never mutated after insert except via supersession. */
  readonly automatic_spend_rupees: 0;
}

/**
 * TH04C proposed migration (NOT applied in TH02):
 *
 *   create table public.buyer_trade_research_thai_manual_evidence (
 *     id                       uuid primary key default gen_random_uuid(),
 *     workspace_id             uuid not null references public.workspaces(id) on delete cascade,
 *     candidate_id             uuid not null,
 *     provider_id              text not null check (provider_id in
 *                                ('thai-dbd','thai-customs-operator','thai-fda-importer')),
 *     captured_at              timestamptz not null default now(),
 *     captured_by_user_id      uuid not null,
 *     source_url               text not null,
 *     source_label             text not null,
 *     evidence_payload         jsonb not null,
 *     evidence_status          text not null check (evidence_status in
 *                                ('verified','not_found','inconclusive','withdrawn')),
 *     supersedes_id            uuid references
 *                                public.buyer_trade_research_thai_manual_evidence(id)
 *                                on delete set null,
 *     automatic_spend_rupees   numeric(12,2) not null default 0
 *                                check (automatic_spend_rupees = 0),
 *     foreign key (candidate_id, workspace_id)
 *       references public.buyer_candidates(id, workspace_id) on delete cascade
 *   );
 *
 *   // append-only + identity-immutability trigger (same pattern as 0031)
 *   // workspace-scoped RLS (member select; service_role insert only)
 *
 * This block is a specification only; TH02 performs NO migration.
 */
export type ThailandManualEvidenceProposedMigration = unknown;
