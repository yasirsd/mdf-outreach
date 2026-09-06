import { requireMdfBusinessProductId } from "@/lib/buyerIntelligence/product";
import type {
  AssessmentClassification,
  AssessmentComponent,
  BuyerIntelligenceAssessment,
  BuyerIntelligenceAssessmentEvidence,
  BuyerIntelligenceClaim,
  BuyerIntelligenceSource,
  BuyerTradeMetric,
  BuyerTradeObservation,
  EvidenceLevel,
  EvidenceType,
  IntelligenceAccessClass,
  IntelligenceAssessmentType,
  IntelligenceClaimType,
  IntelligenceConfidence,
  IntelligenceCostClass,
  TradeMetricKey,
  TradeMetricUnit,
  TradeMetricValue,
  TradeObservationGranularity,
} from "@/lib/buyerIntelligence/types";

type Row = Record<string, unknown>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`Invalid Buyer Intelligence row: ${field}`);
  return result;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function requiredNumber(value: unknown, field: string): number {
  const result = optionalNumber(value);
  if (result === undefined) throw new Error(`Invalid Buyer Intelligence row: ${field}`);
  return result;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function intelligenceSourceFromRow(row: Row): BuyerIntelligenceSource {
  return {
    id: requiredString(row.id, "source.id"),
    workspaceId: requiredString(row.workspace_id, "source.workspace_id"),
    candidateId: requiredString(row.candidate_id, "source.candidate_id"),
    providerId: requiredString(row.provider_id, "source.provider_id"),
    sourceType: requiredString(row.source_type, "source.source_type"),
    sourceKey: requiredString(row.source_key, "source.source_key"),
    safeSourceRef: optionalString(row.safe_source_ref),
    sourceUrl: optionalString(row.source_url),
    accessClass: requiredString(row.access_class, "source.access_class") as IntelligenceAccessClass,
    costClass: requiredString(row.cost_class, "source.cost_class") as IntelligenceCostClass,
    observedAt: optionalString(row.observed_at),
    retrievedAt: requiredString(row.retrieved_at, "source.retrieved_at"),
    metadata: objectValue(row.metadata),
    createdAt: requiredString(row.created_at, "source.created_at"),
  };
}

export function intelligenceClaimFromRow(row: Row): BuyerIntelligenceClaim {
  return {
    id: requiredString(row.id, "claim.id"),
    workspaceId: requiredString(row.workspace_id, "claim.workspace_id"),
    candidateId: requiredString(row.candidate_id, "claim.candidate_id"),
    sourceId: requiredString(row.source_id, "claim.source_id"),
    sourceRecordRef: requiredString(row.source_record_ref, "claim.source_record_ref"),
    claimType: requiredString(row.claim_type, "claim.claim_type") as IntelligenceClaimType,
    evidenceType: requiredString(row.evidence_type, "claim.evidence_type") as EvidenceType,
    evidenceLevel: requiredNumber(row.evidence_level, "claim.evidence_level") as EvidenceLevel,
    confidence: requiredString(row.confidence, "claim.confidence") as IntelligenceConfidence,
    rawValue: row.raw_value,
    normalizedValue: row.normalized_value ?? undefined,
    observedAt: optionalString(row.observed_at),
    retrievedAt: requiredString(row.retrieved_at, "claim.retrieved_at"),
    normalizationVersion: optionalString(row.normalization_version),
    createdAt: requiredString(row.created_at, "claim.created_at"),
  };
}

export function tradeObservationFromRow(row: Row): BuyerTradeObservation {
  const mdfProductId = optionalString(row.mdf_product_id);
  if (mdfProductId) requireMdfBusinessProductId(mdfProductId);
  return {
    id: requiredString(row.id, "observation.id"),
    workspaceId: requiredString(row.workspace_id, "observation.workspace_id"),
    candidateId: requiredString(row.candidate_id, "observation.candidate_id"),
    sourceId: requiredString(row.source_id, "observation.source_id"),
    sourceRecordRef: requiredString(row.source_record_ref, "observation.source_record_ref"),
    granularity: requiredString(
      row.granularity,
      "observation.granularity",
    ) as TradeObservationGranularity,
    evidenceType: requiredString(row.evidence_type, "observation.evidence_type") as EvidenceType,
    evidenceLevel: requiredNumber(
      row.evidence_level,
      "observation.evidence_level",
    ) as EvidenceLevel,
    confidence: requiredString(
      row.confidence,
      "observation.confidence",
    ) as IntelligenceConfidence,
    tradeDate: optionalString(row.trade_date),
    periodStart: optionalString(row.period_start),
    periodEnd: optionalString(row.period_end),
    originCountryCode: optionalString(row.origin_country_code),
    destinationCountryCode: optionalString(row.destination_country_code),
    supplierNameRaw: optionalString(row.supplier_name_raw),
    supplierNameNormalized: optionalString(row.supplier_name_normalized),
    supplierCountryCode: optionalString(row.supplier_country_code),
    productDescriptionRaw: optionalString(row.product_description_raw),
    normalizedProductCategory: optionalString(row.normalized_product_category),
    mdfProductId,
    hsCodeRaw: optionalString(row.hs_code_raw),
    quantity: optionalNumber(row.quantity),
    quantityUnit: optionalString(row.quantity_unit),
    grossWeightKg: optionalNumber(row.gross_weight_kg),
    netWeightKg: optionalNumber(row.net_weight_kg),
    tradeValue: optionalNumber(row.trade_value),
    currencyCode: optionalString(row.currency_code),
    originPortRaw: optionalString(row.origin_port_raw),
    destinationPortRaw: optionalString(row.destination_port_raw),
    reportedRecordCount: optionalNumber(row.reported_record_count),
    observedAt: optionalString(row.observed_at),
    retrievedAt: requiredString(row.retrieved_at, "observation.retrieved_at"),
    normalizationVersion: optionalString(row.normalization_version),
    createdAt: requiredString(row.created_at, "observation.created_at"),
    updatedAt: requiredString(row.updated_at, "observation.updated_at"),
  };
}

function metricValue(row: Row): TradeMetricValue {
  const valueType = requiredString(row.value_type, "metric.value_type");
  if (valueType === "number") {
    return { type: "number", value: requiredNumber(row.numeric_value, "metric.numeric_value") };
  }
  if (valueType === "text") {
    return { type: "text", value: requiredString(row.text_value, "metric.text_value") };
  }
  if (valueType === "json") return { type: "json", value: row.structured_value };
  throw new Error("Invalid Buyer Intelligence row: metric.value_type");
}

export function tradeMetricFromRow(row: Row): BuyerTradeMetric {
  return {
    id: requiredString(row.id, "metric.id"),
    workspaceId: requiredString(row.workspace_id, "metric.workspace_id"),
    candidateId: requiredString(row.candidate_id, "metric.candidate_id"),
    metricKey: requiredString(row.metric_key, "metric.metric_key") as TradeMetricKey,
    value: metricValue(row),
    unit: requiredString(row.unit, "metric.unit") as TradeMetricUnit,
    calculationWindow: requiredString(
      row.calculation_window,
      "metric.calculation_window",
    ),
    windowStart: optionalString(row.window_start),
    windowEnd: optionalString(row.window_end),
    supportingObservationCount: requiredNumber(
      row.supporting_observation_count,
      "metric.supporting_observation_count",
    ),
    observationWatermark: optionalString(row.observation_watermark),
    calculatedAt: requiredString(row.calculated_at, "metric.calculated_at"),
    calculationVersion: requiredString(
      row.calculation_version,
      "metric.calculation_version",
    ),
    createdAt: requiredString(row.created_at, "metric.created_at"),
    updatedAt: requiredString(row.updated_at, "metric.updated_at"),
  };
}

export function intelligenceAssessmentFromRow(row: Row): BuyerIntelligenceAssessment {
  const components = Array.isArray(row.components)
    ? (row.components as AssessmentComponent[])
    : [];
  return {
    id: requiredString(row.id, "assessment.id"),
    workspaceId: requiredString(row.workspace_id, "assessment.workspace_id"),
    candidateId: requiredString(row.candidate_id, "assessment.candidate_id"),
    assessmentType: requiredString(
      row.assessment_type,
      "assessment.assessment_type",
    ) as IntelligenceAssessmentType,
    classification: requiredString(
      row.classification,
      "assessment.classification",
    ) as AssessmentClassification,
    summary: requiredString(row.summary, "assessment.summary"),
    components,
    calculatedAt: requiredString(row.calculated_at, "assessment.calculated_at"),
    calculationVersion: requiredString(
      row.calculation_version,
      "assessment.calculation_version",
    ),
    supersededAt: optionalString(row.superseded_at),
    createdAt: requiredString(row.created_at, "assessment.created_at"),
    updatedAt: requiredString(row.updated_at, "assessment.updated_at"),
  };
}

export function assessmentEvidenceFromRow(row: Row): BuyerIntelligenceAssessmentEvidence {
  const claimId = optionalString(row.claim_id);
  const observationId = optionalString(row.observation_id);
  const metricId = optionalString(row.metric_id);
  const kind = claimId ? "claim" : observationId ? "observation" : metricId ? "metric" : undefined;
  if (!kind) throw new Error("Invalid Buyer Intelligence row: assessment evidence target");
  return {
    id: requiredString(row.id, "assessmentEvidence.id"),
    workspaceId: requiredString(row.workspace_id, "assessmentEvidence.workspace_id"),
    candidateId: requiredString(row.candidate_id, "assessmentEvidence.candidate_id"),
    assessmentId: requiredString(row.assessment_id, "assessmentEvidence.assessment_id"),
    componentKey: requiredString(row.component_key, "assessmentEvidence.component_key"),
    kind,
    claimId,
    observationId,
    metricId,
    createdAt: requiredString(row.created_at, "assessmentEvidence.created_at"),
  };
}
