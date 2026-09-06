import type {
  BuyerCandidateContact,
  BuyerCandidatePublicEmail,
} from "@/lib/buyerFinder/types";

export const EVIDENCE_LEVELS = [1, 2, 3] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_TYPES = [
  "verified_trade_evidence",
  "business_evidence",
  "discovery_signal",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_TYPE_BY_LEVEL: Record<EvidenceLevel, EvidenceType> = {
  1: "verified_trade_evidence",
  2: "business_evidence",
  3: "discovery_signal",
};

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  1: "Verified trade",
  2: "Business evidence",
  3: "Discovery signal",
};

export const INTELLIGENCE_ACCESS_CLASSES = [
  "public",
  "authorized_api",
  "manual",
  "internal",
] as const;
export type IntelligenceAccessClass = (typeof INTELLIGENCE_ACCESS_CLASSES)[number];

export const INTELLIGENCE_COST_CLASSES = ["free", "paid", "unknown"] as const;
export type IntelligenceCostClass = (typeof INTELLIGENCE_COST_CLASSES)[number];

export const INTELLIGENCE_CONFIDENCE = [
  "verified",
  "high",
  "medium",
  "low",
  "unknown",
] as const;
export type IntelligenceConfidence = (typeof INTELLIGENCE_CONFIDENCE)[number];

export const INTELLIGENCE_CLAIM_TYPES = [
  "company_is_importer",
  "company_is_distributor",
  "imports_product",
  "observed_origin_country",
  "observed_destination_country",
  "supplier_relationship",
  "india_sourcing",
  "website_business_description",
  "directory_category",
] as const;
export type IntelligenceClaimType = (typeof INTELLIGENCE_CLAIM_TYPES)[number];

export const TRADE_OBSERVATION_GRANULARITIES = [
  "shipment",
  "transaction",
  "aggregate_period",
  "buyer_supplier_relation",
  "company_claim",
  "directory_signal",
] as const;
export type TradeObservationGranularity =
  (typeof TRADE_OBSERVATION_GRANULARITIES)[number];

export interface BuyerIntelligenceSource {
  id: string;
  workspaceId: string;
  candidateId: string;
  providerId: string;
  sourceType: string;
  /** Stable, safe internal source identity used for source-level dedupe. */
  sourceKey: string;
  safeSourceRef?: string;
  sourceUrl?: string;
  accessClass: IntelligenceAccessClass;
  costClass: IntelligenceCostClass;
  observedAt?: string;
  retrievedAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BuyerIntelligenceClaim {
  id: string;
  workspaceId: string;
  candidateId: string;
  sourceId: string;
  /** Stable identity of this fact inside the source; not the source identity. */
  sourceRecordRef: string;
  claimType: IntelligenceClaimType;
  evidenceType: EvidenceType;
  evidenceLevel: EvidenceLevel;
  confidence: IntelligenceConfidence;
  rawValue: unknown;
  normalizedValue?: unknown;
  observedAt?: string;
  retrievedAt: string;
  normalizationVersion?: string;
  createdAt: string;
}

export interface BuyerTradeObservation {
  id: string;
  workspaceId: string;
  candidateId: string;
  sourceId: string;
  sourceRecordRef: string;
  granularity: TradeObservationGranularity;
  evidenceType: EvidenceType;
  evidenceLevel: EvidenceLevel;
  confidence: IntelligenceConfidence;
  tradeDate?: string;
  periodStart?: string;
  periodEnd?: string;
  originCountryCode?: string;
  destinationCountryCode?: string;
  supplierNameRaw?: string;
  supplierNameNormalized?: string;
  supplierCountryCode?: string;
  productDescriptionRaw?: string;
  normalizedProductCategory?: string;
  mdfProductId?: string;
  hsCodeRaw?: string;
  quantity?: number;
  quantityUnit?: string;
  grossWeightKg?: number;
  netWeightKg?: number;
  tradeValue?: number;
  currencyCode?: string;
  originPortRaw?: string;
  destinationPortRaw?: string;
  reportedRecordCount?: number;
  observedAt?: string;
  retrievedAt: string;
  normalizationVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export const TRADE_METRIC_KEYS = [
  "last_observed_trade",
  "trade_observation_count",
  "shipment_count",
  "activity_last_12_months",
  "import_frequency",
  "india_observation_count",
  "india_shipment_count",
  "india_observation_share",
  "last_observed_india_trade",
  "origin_country_distribution",
  "supplier_count",
  "supplier_ranking",
  "supplier_concentration",
  "trade_momentum",
] as const;
export type TradeMetricKey = (typeof TRADE_METRIC_KEYS)[number];

export type TradeMetricUnit = "count" | "ratio" | "date" | "months" | "index" | "none";

export type TradeMetricValue =
  | { type: "number"; value: number }
  | { type: "text"; value: string }
  | { type: "json"; value: unknown };

export interface BuyerTradeMetric {
  id: string;
  workspaceId: string;
  candidateId: string;
  metricKey: TradeMetricKey;
  value: TradeMetricValue;
  unit: TradeMetricUnit;
  calculationWindow: string;
  windowStart?: string;
  windowEnd?: string;
  supportingObservationCount: number;
  observationWatermark?: string;
  calculatedAt: string;
  calculationVersion: string;
  createdAt: string;
  updatedAt: string;
}

export const ASSESSMENT_TYPES = [
  "buyer_legitimacy",
  "buyer_potential",
  "contact_access",
  "outreach_readiness",
] as const;
export type IntelligenceAssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const LEGITIMACY_CLASSIFICATIONS = [
  "verified",
  "strong_evidence",
  "moderate_evidence",
  "weak_signal",
  "no_evidence_found",
] as const;
export type LegitimacyClassification = (typeof LEGITIMACY_CLASSIFICATIONS)[number];

export const CONTACT_ACCESS_LEVELS = [
  "company_only",
  "public_route",
  "named_contact",
  "direct_contact",
  "credit_enriched",
] as const;
export type ContactAccessLevel = (typeof CONTACT_ACCESS_LEVELS)[number];

export const BUYER_POTENTIAL_CLASSIFICATIONS = [
  "high",
  "medium",
  "low",
  "insufficient_evidence",
] as const;
export type BuyerPotentialClassification =
  (typeof BUYER_POTENTIAL_CLASSIFICATIONS)[number];

export const OUTREACH_READINESS_CLASSIFICATIONS = [
  "needs_review",
  "needs_contact",
  "ready_for_conversion",
  "ready_for_outreach",
  "suppressed",
  "not_eligible",
] as const;
export type OutreachReadinessClassification =
  (typeof OUTREACH_READINESS_CLASSIFICATIONS)[number];

export type AssessmentClassification =
  | LegitimacyClassification
  | "high"
  | "medium"
  | "low"
  | "insufficient_evidence"
  | ContactAccessLevel
  | "needs_review"
  | "needs_contact"
  | "ready_for_conversion"
  | "ready_for_outreach"
  | "suppressed"
  | "not_eligible";

export interface AssessmentComponent {
  key: string;
  explanation: string;
  evidenceCount: number;
}

export interface BuyerIntelligenceAssessment {
  id: string;
  workspaceId: string;
  candidateId: string;
  assessmentType: IntelligenceAssessmentType;
  classification: AssessmentClassification;
  summary: string;
  components: AssessmentComponent[];
  calculatedAt: string;
  calculationVersion: string;
  supersededAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AssessmentEvidenceKind = "claim" | "observation" | "metric";

export interface BuyerIntelligenceAssessmentEvidence {
  id: string;
  workspaceId: string;
  candidateId: string;
  assessmentId: string;
  componentKey: string;
  kind: AssessmentEvidenceKind;
  claimId?: string;
  observationId?: string;
  metricId?: string;
  createdAt: string;
}

export interface IntelligenceClaimFilters {
  claimType?: IntelligenceClaimType;
  evidenceType?: EvidenceType;
}

export interface TradeObservationFilters {
  granularity?: TradeObservationGranularity;
  evidenceType?: EvidenceType;
  originCountryCode?: string;
  destinationCountryCode?: string;
  hsCodeRaw?: string;
  normalizedProductCategory?: string;
  mdfProductId?: string;
  supplierNameNormalized?: string;
}

export interface TradeObservationPageRequest extends TradeObservationFilters {
  cursor?: string;
  limit?: number;
}

export interface TradeObservationPage {
  rows: BuyerTradeObservation[];
  nextCursor?: string;
}

export interface BasicTradeSummary {
  lastObservedTrade?: string;
  tradeObservationCount: number;
  shipmentCount: number;
  activityLast12Months: number;
  indiaObservationCount: number;
  indiaShipmentCount: number;
  indiaShipmentShare?: number;
  lastObservedIndiaTrade?: string;
  originCountryDistribution: Array<{ countryCode: string; count: number }>;
  supplierCount: number;
  supplierRanking: Array<{ supplier: string; countryCode?: string; count: number }>;
}

export interface AssessmentEvidenceReference {
  kind: AssessmentEvidenceKind;
  id: string;
  componentKey?: string;
}

export interface ExplainableAssessmentResult<C extends AssessmentClassification> {
  classification: C;
  summary: string;
  components: AssessmentComponent[];
  evidence: AssessmentEvidenceReference[];
}

export type LegitimacyResult = ExplainableAssessmentResult<LegitimacyClassification>;
export type BuyerPotentialResult =
  ExplainableAssessmentResult<BuyerPotentialClassification>;
export type OutreachReadinessResult =
  ExplainableAssessmentResult<OutreachReadinessClassification>;

export interface SupplierProjection {
  key: string;
  name: string;
  countryCode?: string;
  firstObserved?: string;
  lastObserved?: string;
  verifiedShipmentCount: number;
  productOverlap: string[];
}

export interface ProductProjection {
  key: string;
  rawDescriptions: string[];
  normalizedCategories: string[];
  mdfProductIds: string[];
  hsCodes: string[];
  firstObserved?: string;
  lastObserved?: string;
  verifiedShipmentCount: number;
}

export interface BuyerIntelligenceOverview {
  legitimacy: LegitimacyResult;
  buyerPotential: BuyerPotentialResult;
  contactAccess: ContactAccessLevel;
  contactAccessSummary: string;
  outreachReadiness: OutreachReadinessResult;
  metrics: BasicTradeSummary;
  evidenceCounts: Record<EvidenceLevel, number>;
  linkedAssessmentEvidenceCount: number;
}

export interface SafeIntelligenceSource {
  id: string;
  providerId: string;
  sourceType: string;
  safeSourceRef?: string;
  sourceUrl?: string;
  accessClass: IntelligenceAccessClass;
  costClass: IntelligenceCostClass;
  observedAt?: string;
  retrievedAt: string;
  evidence: Array<{ evidenceType: EvidenceType; evidenceLevel: EvidenceLevel }>;
}

export interface BuyerIntelligenceViewModel {
  overview: BuyerIntelligenceOverview;
  trade: TradeObservationPage;
  sources: SafeIntelligenceSource[];
  suppliers: SupplierProjection[];
  products: ProductProjection[];
  projectionsComplete: boolean;
}

export interface ContactAccessInput {
  contacts: BuyerCandidateContact[];
  publicEmails: BuyerCandidatePublicEmail[];
  candidateGeneralEmail?: string;
}
