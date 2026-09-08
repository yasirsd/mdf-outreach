import { mappingFitEligibility } from "./product";
import { recommendationStatus } from "./marketFit";
import type {
  DataConfidenceScore,
  MappingFitEligibility,
  MappingKind,
  MarketFitScore,
  MarketRecommendationStatus,
} from "./types";

export type MarketFitPublicationReason =
  | "published_exact"
  | "published_trade_proxy"
  | "diagnostic_fit_unavailable"
  | "missing_demand_evidence"
  | "missing_historical_evidence"
  | "missing_data_confidence"
  | "insufficient_mapping_specificity";

export interface MarketRecommendationResult {
  /** The only Fit value UI/API code may publish. */
  publishedFitScore: number | null;
  /** Internal calculation retained for diagnostics and methodology review. */
  diagnosticFitScore: number | null;
  dataConfidenceScore: number | null;
  recommendationStatus: MarketRecommendationStatus;
  mappingKind: MappingKind;
  mappingConfidence: number;
  fitEligibility: MappingFitEligibility;
  reasons: string[];
  isTradeProxy: boolean;
  publicationReason: MarketFitPublicationReason;
}

export interface BuildMarketRecommendationInput {
  diagnosticFit: MarketFitScore;
  dataConfidence: DataConfidenceScore | null;
  mappingKind: MappingKind;
  mappingConfidence: number;
  hasDemandSizeEvidence: boolean;
  hasHistoricalEvidence: boolean;
}

const PUBLICATION_EXPLANATION: Record<MarketFitPublicationReason, string> = {
  published_exact: "Fit is publishable from an exact-enough trade mapping.",
  published_trade_proxy: "Fit is published as a trade proxy and cannot be actionable.",
  diagnostic_fit_unavailable: "The diagnostic Fit calculation lacks enough supported components.",
  missing_demand_evidence: "Demand-size evidence is required before publishing Market Fit.",
  missing_historical_evidence: "Historical evidence is required before publishing Market Fit.",
  missing_data_confidence: "Data Confidence is required before publishing Market Fit.",
  insufficient_mapping_specificity: "The trade classification is too broad for a product-specific Market Fit.",
};

/**
 * Central publication boundary. `composeMarketFit()` is a low-level
 * diagnostic calculator; downstream UI/API/repository code consumes this
 * result so composite mappings can never accidentally expose a numeric Fit.
 */
export function buildMarketRecommendation(
  input: BuildMarketRecommendationInput,
): MarketRecommendationResult {
  const fitEligibility = mappingFitEligibility(input.mappingKind);
  const diagnosticFitScore = input.diagnosticFit.score;
  const dataConfidenceScore = input.dataConfidence?.score ?? null;
  const isTradeProxy = input.mappingKind === "proxy";

  let publicationReason: MarketFitPublicationReason;
  if (fitEligibility === "insufficient_specificity") {
    publicationReason = "insufficient_mapping_specificity";
  } else if (diagnosticFitScore == null) {
    publicationReason = "diagnostic_fit_unavailable";
  } else if (!input.hasDemandSizeEvidence) {
    publicationReason = "missing_demand_evidence";
  } else if (!input.hasHistoricalEvidence) {
    publicationReason = "missing_historical_evidence";
  } else if (dataConfidenceScore == null) {
    publicationReason = "missing_data_confidence";
  } else {
    publicationReason = isTradeProxy ? "published_trade_proxy" : "published_exact";
  }

  const publishable =
    publicationReason === "published_exact" ||
    publicationReason === "published_trade_proxy";

  const status: MarketRecommendationStatus = dataConfidenceScore == null
    ? "insufficient_evidence"
    : recommendationStatus({
        fitScore: diagnosticFitScore,
        mappingEligibility: fitEligibility,
        hasDemandSizeEvidence: input.hasDemandSizeEvidence,
        hasHistoricalEvidence: input.hasHistoricalEvidence,
        dataConfidenceScore,
      });

  return {
    publishedFitScore: publishable ? diagnosticFitScore : null,
    diagnosticFitScore,
    dataConfidenceScore,
    recommendationStatus: status,
    mappingKind: input.mappingKind,
    mappingConfidence: input.mappingConfidence,
    fitEligibility,
    reasons: [
      ...input.diagnosticFit.positiveReasons,
      ...input.diagnosticFit.negativeReasons,
      PUBLICATION_EXPLANATION[publicationReason],
    ],
    isTradeProxy,
    publicationReason,
  };
}
