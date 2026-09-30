import { createHash } from "node:crypto";

import {
  canonicalizeResearchContext,
  fingerprintResearchContext,
  readStoredResearchContext,
  ResearchContextValidationError,
} from "./context";
import type {
  ResearchContext,
  TradeResearchEvaluatedProviderResult,
  TradeResearchGoal,
  TradeResearchProviderResult,
  TradeResearchResultSummary,
} from "./types";

/**
 * T12 — Snapshot Certification.
 *
 * This module is a PURE classifier + fingerprint helper: it inspects
 * a finalized research job's persisted state and decides whether the
 * result can be certified as trusted-current, must be preserved as
 * legacy_unverified (missing but not corrupted provenance), or must
 * be quarantined (present but inconsistent / incompatible provenance).
 *
 * It never invents fields. It never performs provider calls. It never
 * mutates the finalized job. Certification is IDEMPOTENT: identical
 * material state yields the same `snapshotFingerprint`, and the
 * database unique constraint on (job_id, snapshot_fingerprint) collapses
 * repeated certification attempts to a single row.
 */

export const CERTIFICATION_SCHEMA_VERSION = "trcert-v1" as const;

export type CertificationStatus = "certified" | "legacy_unverified" | "quarantined";

export type LegacyReason =
  | "missing_research_context"
  | "missing_provider_plan_version"
  | "missing_provider_results"
  | "missing_finalized_outcome";

export type QuarantineReason =
  | "invalid_context"
  | "context_fingerprint_mismatch"
  | "provider_result_missing_dataset_version"
  | "provider_result_missing_parser_version"
  | "provider_result_missing_interpretation_version"
  | "provider_result_interpretation_version_conflict"
  | "provider_plan_version_conflict"
  | "unsupported_snapshot_schema_version"
  | "malformed_provider_results";

export interface CertificationIdentity {
  candidateId: string;
  productId: string | null;
  marketCountryCode: string;
  researchGoal: TradeResearchGoal;
  providerPlanVersion: string | null;
  interpretationVersion: string | null;
  contextFingerprint: string | null;
  providerResultsDigest: string;
  resultSummaryDigest: string;
  snapshotFingerprint: string;
}

export interface CertificationDecision {
  status: CertificationStatus;
  reason: string;
  identity: CertificationIdentity;
}

/**
 * Terminal statuses on `buyer_trade_research_jobs.status`. Only these
 * are eligible for certification.
 */
export const TERMINAL_TRADE_RESEARCH_STATUSES = new Set([
  "completed",
  "partial",
  "needs_review",
  "failed",
  "cancelled",
]);

interface FinalizedJobLike {
  status: string;
  outcome: string | null;
  workspaceId: string;
  candidateId: string;
  productId: string | null;
  marketCountryCode: string;
  researchGoal: TradeResearchGoal;
  research_context: ResearchContext | null;
  result_summary: TradeResearchResultSummary;
}

function orderedByProvider(results: readonly TradeResearchProviderResult[]): TradeResearchProviderResult[] {
  return [...results].sort((a, b) => a.providerId.localeCompare(b.providerId));
}

/**
 * Canonical serialization of the ordered provider results — only the
 * fields that identify SOURCE MATERIAL and INTERPRETATION MACHINERY.
 * Execution status is included so a `failed_retryable` re-evaluation
 * produces a different fingerprint than a completed one.
 */
export function canonicalProviderResultsPayload(results: readonly TradeResearchProviderResult[]): string {
  return JSON.stringify(
    orderedByProvider(results).map((r) => ({
      providerId: r.providerId,
      datasetId: r.datasetId,
      datasetVersion: r.datasetVersion,
      parserVersion: r.parserVersion,
      sourcePeriod: r.sourcePeriod,
      retrievedAt: r.retrievedAt,
      sourceRecordIds: [...r.sourceRecordIds].sort(),
      status: r.execution.status,
      safeErrorCode: r.execution.safeErrorCode,
      interpretationVersion: r.evidence?.interpretationVersion ?? null,
    })),
  );
}

export function digestProviderResults(results: readonly TradeResearchProviderResult[]): string {
  return `trcert-pr-v1:${createHash("sha256").update(canonicalProviderResultsPayload(results), "utf8").digest("hex")}`;
}

/**
 * Canonical serialization of the finalized `result_summary`. Volatile
 * or run-scoped fields are excluded — only the material outcome
 * (evidence levels, sources checked, aggregate identity) contributes.
 */
export function canonicalResultSummaryPayload(summary: TradeResearchResultSummary): string {
  return JSON.stringify({
    officialProgramEvidence: summary.officialProgramEvidence,
    productEvidence: summary.productEvidence,
    originEvidence: summary.originEvidence,
    indiaOrigin: summary.indiaOrigin,
    shipmentEvidence: summary.shipmentEvidence,
    sourcesChecked: summary.sourcesChecked,
    sourcesPlanned: summary.sourcesPlanned ?? null,
    sourcesEvaluated: summary.sourcesEvaluated ?? null,
    sourcesSucceeded: summary.sourcesSucceeded ?? null,
    sourcesFailed: summary.sourcesFailed ?? null,
    sourcesCached: summary.sourcesCached ?? null,
    automaticSpendRupees: summary.automaticSpendRupees,
    aggregate: summary.aggregate
      ? {
          identity: summary.aggregate.identity,
          reason: summary.aggregate.reason,
          sourcesEvaluated: summary.aggregate.sourcesEvaluated,
          sourcesCorroborating: summary.aggregate.sourcesCorroborating,
        }
      : null,
  });
}

export function digestResultSummary(summary: TradeResearchResultSummary): string {
  return `trcert-rs-v1:${createHash("sha256").update(canonicalResultSummaryPayload(summary), "utf8").digest("hex")}`;
}

export function computeSnapshotFingerprint(input: {
  contextFingerprint: string | null;
  providerResultsDigest: string;
  resultSummaryDigest: string;
}): string {
  const canonical = JSON.stringify({
    schema: CERTIFICATION_SCHEMA_VERSION,
    context: input.contextFingerprint,
    providerResults: input.providerResultsDigest,
    resultSummary: input.resultSummaryDigest,
  });
  return `trcert-v1:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function evaluatedProviderResults(
  results: readonly TradeResearchProviderResult[],
): readonly TradeResearchEvaluatedProviderResult[] {
  return results.filter((r): r is TradeResearchEvaluatedProviderResult =>
    r.execution.status === "completed" || r.execution.status === "no_match" || r.execution.status === "cached",
  );
}

/**
 * Deterministic classifier. Given a finalized job's persisted state
 * (its terminal status, its research_context if any, and its
 * result_summary — INCLUDING typed provider results), return the
 * intended certification decision.
 */
export function classifyResearchJobForCertification(job: FinalizedJobLike): CertificationDecision {
  const providerResults = Array.isArray(job.result_summary.providerResults)
    ? job.result_summary.providerResults
    : undefined;

  const providerResultsDigest = digestProviderResults(providerResults ?? []);
  const resultSummaryDigest = digestResultSummary(job.result_summary);

  // Context read + fingerprint (typed / legacy_unknown / invalid_context).
  const stored = readStoredResearchContext(job.result_summary);
  const contextFingerprint = stored.status === "typed" ? stored.fingerprint : null;

  const identity: CertificationIdentity = {
    candidateId: job.candidateId,
    productId: job.productId,
    marketCountryCode: job.marketCountryCode,
    researchGoal: job.researchGoal,
    providerPlanVersion: stored.status === "typed" ? stored.context.providerPlanVersion : null,
    interpretationVersion: stored.status === "typed" ? stored.context.interpretationVersion : null,
    contextFingerprint,
    providerResultsDigest,
    resultSummaryDigest,
    snapshotFingerprint: computeSnapshotFingerprint({
      contextFingerprint,
      providerResultsDigest,
      resultSummaryDigest,
    }),
  };

  // Only finalized jobs are eligible.
  if (!TERMINAL_TRADE_RESEARCH_STATUSES.has(job.status)) {
    return {
      status: "legacy_unverified",
      reason: `Job status "${job.status}" is not terminal; certification requires a finalized outcome.`,
      identity,
    };
  }
  if (!job.outcome) {
    return {
      status: "legacy_unverified",
      reason: "Finalized job is missing an outcome value.",
      identity,
    };
  }

  // Quarantine on corrupted / invalid context OR fingerprint mismatch.
  if (stored.status === "invalid_context") {
    return {
      status: "quarantined",
      reason: reasonText("invalid_context", "Persisted research_context could not be canonicalised or its stored fingerprint does not match the canonical fingerprint."),
      identity,
    };
  }

  if (stored.status === "legacy_unknown") {
    return {
      status: "legacy_unverified",
      reason: reasonText("missing_research_context", "Finalized job predates T07 research_context persistence."),
      identity,
    };
  }

  // Legacy check: provider plan version required.
  if (!stored.context.providerPlanVersion) {
    return {
      status: "legacy_unverified",
      reason: reasonText("missing_provider_plan_version", "research_context.providerPlanVersion is required to certify a snapshot."),
      identity,
    };
  }

  // Legacy check: typed provider results required for certification.
  if (!providerResults || providerResults.length === 0) {
    return {
      status: "legacy_unverified",
      reason: reasonText("missing_provider_results", "Finalized result_summary carries no typed providerResults array; certification requires per-provider provenance."),
      identity,
    };
  }

  // Quarantine on malformed provider entries.
  if (!providerResults.every((r) => typeof r.providerId === "string" && typeof r.datasetId === "string")) {
    return {
      status: "quarantined",
      reason: reasonText("malformed_provider_results", "providerResults entries are missing mandatory providerId / datasetId."),
      identity,
    };
  }

  // Quarantine on evaluated providers missing dataset_version / parser_version /
  // interpretation_version conflicts.
  const evaluated = evaluatedProviderResults(providerResults);
  for (const r of evaluated) {
    if (r.datasetVersion === null) {
      return {
        status: "quarantined",
        reason: reasonText("provider_result_missing_dataset_version", `Provider ${r.providerId} evaluated result has no datasetVersion (source material hash) — cannot certify without provenance.`),
        identity,
      };
    }
    if (r.parserVersion === null) {
      return {
        status: "quarantined",
        reason: reasonText("provider_result_missing_parser_version", `Provider ${r.providerId} evaluated result has no parserVersion.`),
        identity,
      };
    }
    if (!r.evidence.interpretationVersion) {
      return {
        status: "quarantined",
        reason: reasonText("provider_result_missing_interpretation_version", `Provider ${r.providerId} evidence has no interpretationVersion.`),
        identity,
      };
    }
  }

  // Every provider must interpret against the same interpretationVersion as
  // the persisted context — mismatch means the aggregate crossed a version.
  const contextInterpretation = stored.context.interpretationVersion;
  for (const r of evaluated) {
    const versionPrefix = r.evidence.interpretationVersion.split(":")[0];
    // Provider interpretations may be scoped under the context's
    // interpretation version (e.g. `${parseVersion}:t08-v1`). We require
    // that the context interpretation appears as a substring OR the
    // provider version equals the context version.
    if (r.evidence.interpretationVersion !== contextInterpretation
        && !r.evidence.interpretationVersion.startsWith(contextInterpretation)
        && !contextInterpretation.startsWith(versionPrefix)) {
      return {
        status: "quarantined",
        reason: reasonText(
          "provider_result_interpretation_version_conflict",
          `Provider ${r.providerId} interpretationVersion "${r.evidence.interpretationVersion}" is incompatible with context "${contextInterpretation}".`,
        ),
        identity,
      };
    }
  }

  return {
    status: "certified",
    reason: "Finalized result carries a canonical research_context, matching context fingerprint, and provider results with dataset + parser + interpretation provenance.",
    identity,
  };
}

function reasonText(
  code: LegacyReason | QuarantineReason,
  detail: string,
): string {
  return `${code}: ${detail}`;
}

/**
 * Validate a candidate finalized job payload (from repository read
 * path) before invoking the classifier. Throws
 * `ResearchContextValidationError` when the incoming context is
 * structurally invalid (defensive — the classifier still catches it
 * as "invalid_context", but throwing gives call sites a chance to
 * refuse rather than persist a quarantine row for a malformed row
 * that never should have been finalized).
 */
export function validateResearchContextForCertification(context: ResearchContext | null): void {
  if (context === null) return;
  canonicalizeResearchContext(context);
}

export function computeContextFingerprint(context: ResearchContext | null): string | null {
  if (!context) return null;
  try {
    return fingerprintResearchContext(context);
  } catch (error) {
    if (error instanceof ResearchContextValidationError) return null;
    throw error;
  }
}

export interface CertificationReconciliationReport {
  inspected: number;
  inserted: number;
  alreadyCertified: number;
  legacyUnverified: number;
  quarantined: number;
  transientFailures: number;
  errors: Array<{ jobId: string; safeErrorCode: string }>;
}

/**
 * T12 reconciliation service — the recovery mechanism for finalized
 * jobs whose post-finalize certification insert lost to a transient
 * DB failure. Reads bounded terminal jobs with no certification row,
 * classifies them with the deterministic classifier, and writes the
 * appropriate row via the idempotent writer.
 *
 * Recoverable invariants:
 *   • Never re-executes providers. Never opens a network connection
 *     to any provider. Only reads the persisted finalized state.
 *   • Never mutates the terminal job. `mdf.__trade_research_job_guard`
 *     also blocks accidental mutation at the DB layer.
 *   • Idempotent via `UNIQUE(job_id, snapshot_fingerprint)`.
 *   • Deterministic failures (invalid context, malformed provider
 *     result) INSERT a legacy/quarantined row on the first pass, so
 *     they are NOT retried forever. Only true DB errors leave the
 *     row missing and thus fall through to the next reconciliation.
 *   • Automatic monetary spend = ₹0 (no fetches, no paid calls).
 *
 * The caller (drain / cron / manual admin action) supplies the
 * writer and a bounded limit. Errors on individual rows are captured
 * in the report and never abort the whole pass.
 */
export interface CertificationReconciliationWriter {
  listTerminalJobsMissingCertification: (limit: number) => Promise<Array<{
    job: { id: string } & Record<string, unknown>;
    resultSummary: unknown;
  }>>;
  certifyResearchJob: (
    job: { id: string } & Record<string, unknown>,
    result: unknown,
  ) => Promise<{ outcome: "inserted" | "already_certified"; status: CertificationStatus; snapshotFingerprint: string }>;
}

export async function reconcilePendingResearchCertifications(
  writer: CertificationReconciliationWriter,
  options: { limit?: number; onEvent?: (event: {
    kind: "inserted" | "already_certified" | "error";
    jobId: string;
    status?: CertificationStatus;
    safeErrorCode?: string;
  }) => void } = {},
): Promise<CertificationReconciliationReport> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 5));
  const report: CertificationReconciliationReport = {
    inspected: 0, inserted: 0, alreadyCertified: 0,
    legacyUnverified: 0, quarantined: 0, transientFailures: 0,
    errors: [],
  };
  let pending: Awaited<ReturnType<CertificationReconciliationWriter["listTerminalJobsMissingCertification"]>>;
  try {
    pending = await writer.listTerminalJobsMissingCertification(limit);
  } catch (error) {
    // Reader failure is treated as a transient infrastructure failure
    // and reported without throwing; the next drain call will retry.
    report.transientFailures += 1;
    report.errors.push({
      jobId: "<reader>",
      safeErrorCode: typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "READER_ERROR")
        : "READER_ERROR",
    });
    return report;
  }
  report.inspected = pending.length;
  for (const { job, resultSummary } of pending) {
    try {
      const outcome = await writer.certifyResearchJob(job, resultSummary);
      if (outcome.outcome === "inserted") {
        report.inserted += 1;
        if (outcome.status === "certified") { /* counted in inserted */ }
        if (outcome.status === "legacy_unverified") report.legacyUnverified += 1;
        if (outcome.status === "quarantined") report.quarantined += 1;
      } else {
        report.alreadyCertified += 1;
      }
      options.onEvent?.({ kind: outcome.outcome, jobId: job.id, status: outcome.status });
    } catch (error) {
      report.transientFailures += 1;
      const safeErrorCode = typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "CERTIFICATION_WRITE_FAILED")
        : "CERTIFICATION_WRITE_FAILED";
      report.errors.push({ jobId: job.id, safeErrorCode });
      options.onEvent?.({ kind: "error", jobId: job.id, safeErrorCode });
    }
  }
  return report;
}
