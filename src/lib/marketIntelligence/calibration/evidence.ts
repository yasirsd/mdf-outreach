/**
 * MI1E.1 — CalibrationEvidenceContext.
 *
 * Every calibration primitive that depends on knowing the WHOLE origin
 * set must consume an evidence context, not the raw observations alone.
 * The ledger row from `public.market_provider_fetch_ledger` records the
 * outcome + row-count contract MI1D established:
 *   outcome  = 'success'                  → provider proved the query complete
 *   outcome  = 'partial' | 'invalid...'   → completeness NOT proven
 *   outcome  = 'empty'                    → complete and legitimately zero
 *   rowsReceived === totalRows            → pagination proved no gap
 *
 * A calibration run reads that ledger row (already persisted; no provider
 * or writer call required) and turns it into a boolean
 * `completeBilateralCoverage` that gates every origin-dependent primitive.
 *
 * The context is pure data. Building it does not touch the network or the
 * DB; the caller reads the ledger through the existing repository.
 */

import type { MarketReadRepositoryObservation } from "../marketReadRepository";
import type { MarketProviderFetchLedgerEntry } from "../types";
import type { HsRevision } from "../types";

export type CalibrationCoverageOutcome =
  | "success"
  | "empty"
  | "partial"
  | "quota_exhausted"
  | "timeout"
  | "provider_error"
  | "invalid_request"
  | "unavailable"
  | "unknown";

export interface CalibrationCoverageWindow {
  requestedStartYear: number;
  requestedEndYear: number;
  providerSupportedYears: readonly number[];
  /**
   * Analytical window used for coverage%; intersection of the requested
   * range with the years the provider currently exposes via its member
   * list. Malaysia proof example: requested 2017–2024, provider members
   * currently [2018..2024] → analyticalYears = [2018..2024].
   */
  analyticalYears: readonly number[];
}

export interface CalibrationEvidenceContext {
  reporterCountry: string;
  hsRevision: HsRevision;
  hsCode: string;
  observations: readonly MarketReadRepositoryObservation[];
  coverage: CalibrationCoverageWindow;
  /** Number of bilateral rows persisted; excludes any world/all-partners row. */
  bilateralObservationCount: number;
  /** Latest ledger row for the exact query fingerprint; may be undefined. */
  ledgerEntry?: Pick<
    MarketProviderFetchLedgerEntry,
    "outcome" | "rowsReceived" | "safeMetadata" | "fetchedAt" | "freshUntil"
  >;
  /** Verdict from ledger + row-count comparison. */
  fetchOutcome: CalibrationCoverageOutcome;
  /**
   * TRUE only when we can prove EVERY exporter row for the analytical
   * window is present:
   *   • ledger outcome === 'success' AND
   *   • bilateralObservationCount === ledger.rowsReceived
   * (An `empty` outcome with 0 rows is a valid COMPLETE zero — treated
   * separately below.)
   */
  completeBilateralCoverage: boolean;
  /**
   * The tri-state used by India primitives:
   *   • `present`  — India appears in a complete set
   *   • `absent`   — India is provably absent in a complete set
   *   • `unknown`  — completeness not proven; India presence is unknown
   */
  indiaPresence: "present" | "absent" | "unknown";
}

export interface BuildEvidenceContextInput {
  reporterCountry: string;
  hsRevision: HsRevision;
  hsCode: string;
  observations: readonly MarketReadRepositoryObservation[];
  ledgerEntry?: CalibrationEvidenceContext["ledgerEntry"];
  requestedStartYear: number;
  requestedEndYear: number;
  providerSupportedYears: readonly number[];
}

const COMPLETE_OUTCOMES: ReadonlyArray<CalibrationCoverageOutcome> = ["success", "empty"];

export function buildCalibrationEvidenceContext(
  input: BuildEvidenceContextInput,
): CalibrationEvidenceContext {
  const bilateralObservationCount = input.observations.filter(
    (row) => row.partnerCountry !== null,
  ).length;
  const observedYears = new Set(
    input.observations.map((row) => Number(row.period)).filter((y) => Number.isInteger(y)),
  );
  const analyticalYears = input.providerSupportedYears
    .filter((year) => year >= input.requestedStartYear && year <= input.requestedEndYear)
    .sort((a, b) => a - b);

  const fetchOutcome: CalibrationCoverageOutcome = ((): CalibrationCoverageOutcome => {
    if (!input.ledgerEntry) return "unknown";
    const raw = input.ledgerEntry.outcome;
    if (
      raw === "success" || raw === "empty" || raw === "partial" ||
      raw === "quota_exhausted" || raw === "timeout" ||
      raw === "provider_error" || raw === "invalid_request" || raw === "unavailable"
    ) {
      return raw;
    }
    return "unknown";
  })();

  // Complete coverage requires ledger `success` AND persisted row count matches
  // the ledger's rows_received. An `empty` ledger row with 0 observations is
  // also complete — a complete, legitimately zero set.
  const completeBilateralCoverage = ((): boolean => {
    if (!input.ledgerEntry) return false;
    if (!COMPLETE_OUTCOMES.includes(fetchOutcome)) return false;
    if (fetchOutcome === "empty") return bilateralObservationCount === 0;
    return bilateralObservationCount === input.ledgerEntry.rowsReceived;
  })();

  const hasIndiaRow = input.observations.some(
    (row) => row.partnerCountry === "IN",
  );
  const indiaPresence: CalibrationEvidenceContext["indiaPresence"] = completeBilateralCoverage
    ? hasIndiaRow ? "present" : "absent"
    : "unknown";

  // Sanity: observed years should be subset of analyticalYears; not enforced
  // hard here (an operator inspecting the report should see any mismatch),
  // just kept as data on the returned context.
  void observedYears;

  return {
    reporterCountry: input.reporterCountry,
    hsRevision: input.hsRevision,
    hsCode: input.hsCode,
    observations: input.observations,
    coverage: {
      requestedStartYear: input.requestedStartYear,
      requestedEndYear: input.requestedEndYear,
      providerSupportedYears: input.providerSupportedYears,
      analyticalYears,
    },
    bilateralObservationCount,
    ledgerEntry: input.ledgerEntry,
    fetchOutcome,
    completeBilateralCoverage,
    indiaPresence,
  };
}
