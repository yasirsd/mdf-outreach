/**
 * MI1E.1 — Data Confidence model.
 *
 * Confidence is SEPARATE from Market Fit. Both travel together to
 * downstream consumers but never mix.
 *
 * SIX explicit contributors (weights sum to exactly 1.0):
 *   1. coverage             — 0.20 — analytical years covered
 *                             (denominator is the provider-supported
 *                             window inside the requested range, NOT the
 *                             raw request; a year the provider does not
 *                             expose does not penalise the score)
 *   2. recency              — 0.15 — how recent the latest year is
 *   3. bilateralCompleteness— 0.20 — proven completeness of the origin
 *                             set from the fetch ledger, replacing the
 *                             older "origins-present-at-latest" check
 *   4. quantityAvailability — 0.10 — is a valid quantity present at
 *                             the latest year
 *   5. sourceTier           — 0.20 — provenance tier A..E
 *   6. mappingSpecificity   — 0.15 — exact / proxy / composite
 *
 *   sum = 0.20 + 0.15 + 0.20 + 0.10 + 0.20 + 0.15 = 1.00 (test-asserted)
 */

import type { CountryPrimitives } from "./primitives";

export type MappingKind = "exact" | "proxy" | "composite";
export type SourceTier = "A" | "B" | "C" | "D" | "E";

export interface ConfidenceInputs {
  primitives: CountryPrimitives;
  mappingKind: MappingKind;
  sourceTier: SourceTier;
  /** Year the calibration run considers "now" for recency. */
  currentYear: number;
}

export interface ConfidenceReport {
  score: number;                    // 0..100
  components: Record<string, number>;
  supported: boolean;               // false → below publication gate
}

export const CONFIDENCE_CONTRIBUTOR_COUNT = 6;

export const CONFIDENCE_WEIGHTS: Readonly<{
  coverage: number;
  recency: number;
  bilateralCompleteness: number;
  quantityAvailability: number;
  sourceTier: number;
  mappingSpecificity: number;
}> = Object.freeze({
  coverage: 0.20,
  recency: 0.15,
  bilateralCompleteness: 0.20,
  quantityAvailability: 0.10,
  sourceTier: 0.20,
  mappingSpecificity: 0.15,
});

const TIER_WEIGHTS: Record<SourceTier, number> = { A: 100, B: 85, C: 70, D: 50, E: 25 };
const MAPPING_WEIGHTS: Record<MappingKind, number> = {
  exact: 100, proxy: 70, composite: 30,
};

export function computeDataConfidence(input: ConfidenceInputs): ConfidenceReport {
  const p = input.primitives;

  // MI1E.1 issue 3 + requested-coverage semantics: use the analytical
  // coverage percentage that already excludes provider-unsupported years.
  const coverage = Math.round(Math.max(0, Math.min(100, p.analyticalCoveragePct)));

  const recencyGap = p.latestYear === null ? Number.POSITIVE_INFINITY : input.currentYear - p.latestYear;
  const recency =
    recencyGap === Number.POSITIVE_INFINITY ? 0
    : recencyGap <= 1 ? 100
    : recencyGap === 2 ? 80
    : recencyGap === 3 ? 60
    : recencyGap === 4 ? 40
    : recencyGap === 5 ? 20
    : 0;

  // MI1E.1 issue 3: "origins present" is NOT completeness. Read the real
  // ledger-backed flag on the primitives payload.
  const bilateralCompleteness = p.completenessFlags.completeBilateralCoverage ? 100 : 0;
  const quantityAvailability = p.completenessFlags.hasQuantityLatest ? 100 : 0;
  const sourceTier = TIER_WEIGHTS[input.sourceTier];
  const mappingSpecificity = MAPPING_WEIGHTS[input.mappingKind];

  const raw =
    coverage * CONFIDENCE_WEIGHTS.coverage +
    recency * CONFIDENCE_WEIGHTS.recency +
    bilateralCompleteness * CONFIDENCE_WEIGHTS.bilateralCompleteness +
    quantityAvailability * CONFIDENCE_WEIGHTS.quantityAvailability +
    sourceTier * CONFIDENCE_WEIGHTS.sourceTier +
    mappingSpecificity * CONFIDENCE_WEIGHTS.mappingSpecificity;
  const score = Math.round(raw);

  return {
    score,
    supported: score >= 50 && p.completenessFlags.hasAtLeast3Periods,
    components: {
      coverage,
      recency,
      bilateralCompleteness,
      quantityAvailability,
      sourceTier,
      mappingSpecificity,
    },
  };
}
