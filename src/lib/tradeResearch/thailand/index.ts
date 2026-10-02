/**
 * TH02 — Thailand research/evidence contract public surface.
 *
 * The Thailand V1 plan ships two automated providers
 * (`thai-customs-stats`, `public-website`) and three MANUAL_ONLY
 * surfaces (DBD, Customs operator, FDA). Thailand reuses the
 * canonical ResearchContext shape (marketCountryCode="TH"), the
 * generic T11 executor, T10 provider checkpoints, and T12
 * certification. No Thailand-specific worker lifecycle exists.
 *
 * This barrel exposes the contract only — no fetching, no parser,
 * no live Thai provider implementation.
 */

export {
  THAILAND_PROVIDER_PLAN_VERSION,
  THAILAND_AUTOMATED_PROVIDER_IDS,
  THAILAND_MANUAL_ONLY_PROVIDER_IDS,
  THAILAND_PROVIDER_PLAN_V1,
  isThailandAutomatedProvider,
  type ThailandProviderPlan,
  type ThailandAutomatedProviderId,
  type ThailandManualOnlyProviderId,
} from "./providerPlan";

export {
  THAILAND_HS_MAPPING_VERSION,
  THAILAND_HS_MAPPINGS,
  findThailandHsMapping,
  type ThailandHsMapping,
  type SemanticHs6,
} from "./hsMapping";

export {
  THAILAND_EVIDENCE_CONTRACT_VERSION,
  ThailandEvidenceInvariants,
  emptyThailandEvidence,
  type ThailandEvidence,
  type ThailandEvidenceDimensionKey,
  type ThaiCompanyIdentity,
  type ThaiImportExportRegistration,
  type ThaiFoodImportLicense,
  type ThaiProductRelevance,
  type ThaiMarketImportActivity,
  type ThaiIndiaOriginMarketActivity,
  type ThaiCompanyShipmentActivity,
  type ThaiContactAvailability,
  type ThaiCoverage,
} from "./evidence";

export {
  THAILAND_MANUAL_EVIDENCE_CONTRACT_VERSION,
  type ThailandManualEvidencePayload,
  type ThailandManualEvidenceNote,
  type ThailandManualEvidenceStatus,
  type ThaiDbdPayload,
  type ThaiCustomsOperatorPayload,
  type ThaiFdaImporterPayload,
} from "./manualEvidence";

export {
  resolveActiveThailandManualEvidence,
  type ThailandManualEvidenceReadResult,
  type ThailandManualEvidenceActiveRow,
} from "./manualEvidenceResolver";

export {
  aggregateThailandResearch,
  THAILAND_AGGREGATE_CONTRACT_VERSION,
  THAILAND_AGGREGATE_DIMENSION_KEYS,
  type ThailandAggregateResult,
  type ThailandAggregateInput,
  type ThailandAggregateProviderSummary,
  type ThailandAggregateDimension,
  type ThailandAggregateDimensionProvenance,
  type ThailandAggregateConflict,
  type ThailandAggregateCoverage,
  type ThailandCandidateIdentityInput,
} from "./aggregate";

/**
 * TH04A provider parser/interpretation version constants. Locked in
 * TH02 so planner and parser can agree without a later redefinition.
 */
export const THAI_CUSTOMS_STATS_PARSER_VERSION = "thai-customs-stats-csv-v1" as const;
export const THAI_CUSTOMS_STATS_INTERPRETATION_VERSION =
  "thai-customs-stats-csv-v1:t08-v1" as const;

/**
 * Thailand's automatic monetary spend ceiling. Non-zero spend MUST
 * be refused at plan evaluation time. Guard shared by TH04A onward.
 */
export const THAILAND_AUTOMATIC_SPEND_RUPEES = 0 as const;
