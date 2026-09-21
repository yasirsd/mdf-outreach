/**
 * MI1E.1 — candidate Market Fit formula composer.
 *
 * The publication + recommendation-status DECISION is delegated to the
 * project's central authority `buildMarketRecommendation()` in
 * src/lib/marketIntelligence/recommendation.ts. That module has been the
 * publication boundary since MI0.1 and already encodes:
 *
 *   • proxy mapping IS publishable as `published_trade_proxy`
 *     (publishedFitScore = diagnosticFitScore when demand/history
 *     evidence + data confidence are present);
 *   • proxy recommendation status is CAPPED at `indicative`;
 *   • composite mapping IS NEVER publishable as a numeric Fit;
 *   • actionable requires exact mapping AND confidence ≥
 *     RECOMMENDATION_MIN_CONFIDENCE_FOR_ACTIONABLE (65) —
 *     there is intentionally NO Fit-score threshold for actionable in
 *     the current authoritative gate.
 *
 * MI1E introduces an OPTIONAL, uncalibrated experimental gate that adds
 * a diagnostic-Fit floor on top of the authoritative rules (never
 * loosens them). Its default value is DELIBERATELY marked
 * `IS_UNCALIBRATED: true`; a test asserts the framework never treats it
 * as a validated production threshold.
 */

import { buildMarketRecommendation } from "../recommendation";
import type { MarketFitScore } from "../types";
import type { CandidateComponentScores } from "./normalize";
import type { ConfidenceReport, MappingKind } from "./confidence";

export const DEFAULT_COMPONENT_WEIGHTS: Record<keyof CandidateComponentScores, number> = {
  demandSize: 25,
  demandGrowth: 20,
  indiaPosition: 20,
  competitiveOpportunity: 15,
  priceAttractiveness: 10,
  demandStability: 10,
};

/**
 * Experimental, UNCALIBRATED extra actionable-gate the operator may
 * evaluate against the cohort distribution after MI1E's real fetch. It
 * cannot loosen the authoritative gate — only add an optional Fit
 * floor. Tests must not treat this as a validated production threshold.
 */
export interface ExperimentalActionableFitGate {
  IS_UNCALIBRATED: true;
  /**
   * If provided, `actionable` also requires diagnosticFitScore >=
   * this value. Set only when the calibration report justifies it.
   */
  minDiagnosticFitScore?: number;
}

export const UNCALIBRATED_EXPERIMENTAL_GATE: ExperimentalActionableFitGate = Object.freeze({
  IS_UNCALIBRATED: true,
});

export type RecommendationStatus = "actionable" | "indicative" | "insufficient_evidence";

export interface CandidateFitResult {
  diagnosticFitScore: number | null;
  supportedWeight: number;
  totalWeight: number;
  recommendationStatus: RecommendationStatus;
  /** Delegated to buildMarketRecommendation — proxy is publishable. */
  publishedFitScore: number | null;
  fitEligibility: "exact" | "proxy_allowed" | "insufficient_specificity";
  reasons: string[];
  publicationReason: string;
}

export interface ComposeCandidateFitInput {
  components: CandidateComponentScores;
  mappingKind: MappingKind;
  mappingConfidence: number;
  confidence: ConfidenceReport;
  hasDemandSizeEvidence: boolean;
  hasHistoricalEvidence: boolean;
  weights?: Record<keyof CandidateComponentScores, number>;
  /** Optional add-on gate; never loosens the central contract. */
  experimentalGate?: ExperimentalActionableFitGate;
}

const COMPONENT_TO_MFC: Record<keyof CandidateComponentScores, string> = {
  demandSize: "demand_size",
  demandGrowth: "demand_growth",
  indiaPosition: "india_position",
  competitiveOpportunity: "competitive_opportunity",
  priceAttractiveness: "price_attractiveness",
  demandStability: "demand_stability",
};

/**
 * Compose the candidate Fit + defer publication and recommendation to
 * the central `buildMarketRecommendation()` gate.
 */
export function composeCandidateFit(input: ComposeCandidateFitInput): CandidateFitResult {
  const weights = input.weights ?? DEFAULT_COMPONENT_WEIGHTS;
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  let weightedSum = 0;
  let supportedWeight = 0;
  const componentReasons: string[] = [];
  for (const key of Object.keys(input.components) as Array<keyof CandidateComponentScores>) {
    const value = input.components[key];
    if (value === null) {
      componentReasons.push(`unsupported:${COMPONENT_TO_MFC[key]}`);
      continue;
    }
    weightedSum += value * weights[key];
    supportedWeight += weights[key];
  }
  const unsupportedFraction = 1 - supportedWeight / totalWeight;
  const diagnosticFitScore =
    supportedWeight > 0 && unsupportedFraction <= 0.30
      ? Math.round(weightedSum / supportedWeight)
      : null;

  // Wrap in the shape `buildMarketRecommendation` expects.
  const diagnosticFit: MarketFitScore = {
    score: diagnosticFitScore,
    classification:
      diagnosticFitScore === null ? "insufficient_evidence"
      : diagnosticFitScore >= 85 ? "excellent_opportunity"
      : diagnosticFitScore >= 70 ? "strong_opportunity"
      : diagnosticFitScore >= 55 ? "moderate_opportunity"
      : diagnosticFitScore >= 40 ? "weak_opportunity"
      : "low_opportunity",
    components: [],
    positiveReasons: [],
    negativeReasons: componentReasons,
    calculationVersion: "mi-fit-v1",
    calculatedAt: new Date().toISOString(),
  };

  const central = buildMarketRecommendation({
    diagnosticFit,
    dataConfidence: input.confidence.supported
      ? {
          score: input.confidence.score,
          components: [],
          calculationVersion: "mi-conf-v1",
          calculatedAt: new Date().toISOString(),
        }
      : null,
    mappingKind: input.mappingKind,
    mappingConfidence: input.mappingConfidence,
    hasDemandSizeEvidence: input.hasDemandSizeEvidence,
    hasHistoricalEvidence: input.hasHistoricalEvidence,
  });

  // Add-on experimental gate: only NARROWS the central `actionable`
  // outcome. It cannot upgrade a status.
  let recommendationStatus = central.recommendationStatus;
  const experimentalFloor = input.experimentalGate?.minDiagnosticFitScore;
  if (
    recommendationStatus === "actionable" &&
    typeof experimentalFloor === "number" &&
    (diagnosticFitScore === null || diagnosticFitScore < experimentalFloor)
  ) {
    recommendationStatus = "indicative";
    componentReasons.push(
      `experimental_uncalibrated_fit_floor:${experimentalFloor}`,
    );
  }

  return {
    diagnosticFitScore,
    supportedWeight,
    totalWeight,
    recommendationStatus,
    publishedFitScore:
      recommendationStatus === "insufficient_evidence" ? null : central.publishedFitScore,
    fitEligibility: central.fitEligibility,
    reasons: [...componentReasons, ...central.reasons],
    publicationReason: central.publicationReason,
  };
}
