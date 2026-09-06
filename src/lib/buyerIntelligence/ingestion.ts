import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { requireMdfBusinessProductId } from "./product";
import {
  EVIDENCE_TYPE_BY_LEVEL,
  INTELLIGENCE_ACCESS_CLASSES,
  INTELLIGENCE_CLAIM_TYPES,
  INTELLIGENCE_CONFIDENCE,
  INTELLIGENCE_COST_CLASSES,
  TRADE_OBSERVATION_GRANULARITIES,
  type EvidenceLevel,
  type EvidenceType,
  type IntelligenceAccessClass,
  type IntelligenceClaimType,
  type IntelligenceConfidence,
  type IntelligenceCostClass,
  type TradeObservationGranularity,
} from "./types";

export type IntelligenceIngestionOutcome = "created" | "existing" | "conflict";

export interface IntelligenceIngestionResult {
  outcome: IntelligenceIngestionOutcome;
  id: string;
  reason?: "material_mismatch";
}

export interface SourceIngestionInput {
  candidateId: string;
  providerId: string;
  sourceType: string;
  sourceKey: string;
  safeSourceRef?: string;
  sourceUrl?: string;
  accessClass: IntelligenceAccessClass;
  costClass: IntelligenceCostClass;
  observedAt?: string;
  retrievedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ClaimIngestionInput {
  candidateId: string;
  sourceId: string;
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
}

export interface TradeObservationIngestionInput {
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
}

export class BuyerIntelligenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuyerIntelligenceValidationError";
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

/** Pure mirror of the append-only SQL replay rule, used by adapters and local tests. */
export function classifyMaterialReplay(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  ignoredKeys: readonly string[] = ["retrievedAt"],
): "existing" | "conflict" {
  const ignored = new Set(ignoredKeys);
  const material = (value: Record<string, unknown>) =>
    canonicalJson(Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key))));
  return JSON.stringify(material(existing)) === JSON.stringify(material(incoming))
    ? "existing"
    : "conflict";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const SENSITIVE_METADATA_KEY = /(api.?key|secret|token|cookie|authorization|password|credential)/i;
const SENSITIVE_QUERY_KEY = /^(api.?key|key|secret|token|access_token|auth|authorization|signature)$/i;

function requiredText(value: string, field: string, max = 500): string {
  const text = value?.trim();
  if (!text || text.length > max) throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  return text;
}

function optionalText(value: string | undefined, field: string, max = 1_000): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field, max);
}

function uuid(value: string, field: string): string {
  if (!isEntityUuid(value)) throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  return value;
}

function instant(value: string | undefined, field: string, required = false): string | undefined {
  if (!value) {
    if (required) throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  return parsed.toISOString();
}

function date(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  }
  return value;
}

function code(value: string | undefined, field: string, pattern: RegExp): string | undefined {
  if (value === undefined) return undefined;
  if (!pattern.test(value)) throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  return value;
}

function nonnegative(value: number | undefined, field: string, integer = false): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  }
  return value;
}

function boundedJson<T>(value: T, field: string, max: number): T {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  }
  if (encoded === undefined || encoded.length > max) {
    throw new BuyerIntelligenceValidationError(`Invalid ${field}.`);
  }
  return JSON.parse(encoded) as T;
}

function scrubMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map(scrubMetadataValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
      .map(([key, item]) => [key, scrubMetadataValue(item)]),
  );
}

export function sanitizeSourceMetadata(value: Record<string, unknown> | undefined) {
  const scrubbed = scrubMetadataValue(value ?? {});
  if (!scrubbed || typeof scrubbed !== "object" || Array.isArray(scrubbed)) {
    throw new BuyerIntelligenceValidationError("Invalid metadata.");
  }
  return boundedJson(scrubbed as Record<string, unknown>, "metadata", 4_096);
}

export function sanitizeIntelligenceSourceUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BuyerIntelligenceValidationError("Invalid sourceUrl.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new BuyerIntelligenceValidationError("Invalid sourceUrl.");
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  const safe = url.toString();
  if (safe.length > 2_048) throw new BuyerIntelligenceValidationError("Invalid sourceUrl.");
  return safe;
}

function validateEvidence(level: EvidenceLevel, type: EvidenceType) {
  if (EVIDENCE_TYPE_BY_LEVEL[level] !== type) {
    throw new BuyerIntelligenceValidationError("Evidence type does not match evidence level.");
  }
}

export function normalizeSourceIngestion(input: SourceIngestionInput): SourceIngestionInput {
  if (!INTELLIGENCE_ACCESS_CLASSES.includes(input.accessClass)) {
    throw new BuyerIntelligenceValidationError("Invalid accessClass.");
  }
  if (!INTELLIGENCE_COST_CLASSES.includes(input.costClass)) {
    throw new BuyerIntelligenceValidationError("Invalid costClass.");
  }
  return {
    candidateId: uuid(input.candidateId, "candidateId"),
    providerId: requiredText(input.providerId, "providerId", 120),
    sourceType: requiredText(input.sourceType, "sourceType", 120),
    sourceKey: requiredText(input.sourceKey, "sourceKey", 500),
    safeSourceRef: optionalText(input.safeSourceRef, "safeSourceRef", 500),
    sourceUrl: sanitizeIntelligenceSourceUrl(input.sourceUrl),
    accessClass: input.accessClass,
    costClass: input.costClass,
    observedAt: instant(input.observedAt, "observedAt"),
    retrievedAt: instant(input.retrievedAt, "retrievedAt", true) as string,
    metadata: sanitizeSourceMetadata(input.metadata),
  };
}

export function normalizeClaimIngestion(input: ClaimIngestionInput): ClaimIngestionInput {
  if (!INTELLIGENCE_CLAIM_TYPES.includes(input.claimType)) {
    throw new BuyerIntelligenceValidationError("Invalid claimType.");
  }
  if (!INTELLIGENCE_CONFIDENCE.includes(input.confidence)) {
    throw new BuyerIntelligenceValidationError("Invalid confidence.");
  }
  validateEvidence(input.evidenceLevel, input.evidenceType);
  return {
    candidateId: uuid(input.candidateId, "candidateId"),
    sourceId: uuid(input.sourceId, "sourceId"),
    sourceRecordRef: requiredText(input.sourceRecordRef, "sourceRecordRef", 500),
    claimType: input.claimType,
    evidenceType: input.evidenceType,
    evidenceLevel: input.evidenceLevel,
    confidence: input.confidence,
    rawValue: boundedJson(input.rawValue, "rawValue", 32_768),
    normalizedValue:
      input.normalizedValue === undefined
        ? undefined
        : boundedJson(input.normalizedValue, "normalizedValue", 32_768),
    observedAt: instant(input.observedAt, "observedAt"),
    retrievedAt: instant(input.retrievedAt, "retrievedAt", true) as string,
    normalizationVersion: optionalText(input.normalizationVersion, "normalizationVersion", 120),
  };
}

export function normalizeTradeObservationIngestion(
  input: TradeObservationIngestionInput,
): TradeObservationIngestionInput {
  if (!TRADE_OBSERVATION_GRANULARITIES.includes(input.granularity)) {
    throw new BuyerIntelligenceValidationError("Invalid granularity.");
  }
  if (!INTELLIGENCE_CONFIDENCE.includes(input.confidence)) {
    throw new BuyerIntelligenceValidationError("Invalid confidence.");
  }
  validateEvidence(input.evidenceLevel, input.evidenceType);
  if (
    ((input.granularity === "shipment" || input.granularity === "transaction") && input.evidenceLevel !== 1) ||
    (input.granularity === "company_claim" && input.evidenceLevel !== 2) ||
    (input.granularity === "directory_signal" && input.evidenceLevel !== 3)
  ) {
    throw new BuyerIntelligenceValidationError("Granularity does not match evidence level.");
  }
  const periodStart = date(input.periodStart, "periodStart");
  const periodEnd = date(input.periodEnd, "periodEnd");
  if (periodStart && periodEnd && periodEnd < periodStart) {
    throw new BuyerIntelligenceValidationError("Invalid observation period.");
  }
  return {
    candidateId: uuid(input.candidateId, "candidateId"),
    sourceId: uuid(input.sourceId, "sourceId"),
    sourceRecordRef: requiredText(input.sourceRecordRef, "sourceRecordRef", 500),
    granularity: input.granularity,
    evidenceType: input.evidenceType,
    evidenceLevel: input.evidenceLevel,
    confidence: input.confidence,
    tradeDate: date(input.tradeDate, "tradeDate"),
    periodStart,
    periodEnd,
    originCountryCode: code(input.originCountryCode, "originCountryCode", COUNTRY_RE),
    destinationCountryCode: code(input.destinationCountryCode, "destinationCountryCode", COUNTRY_RE),
    supplierNameRaw: optionalText(input.supplierNameRaw, "supplierNameRaw", 1_000),
    supplierNameNormalized: optionalText(input.supplierNameNormalized, "supplierNameNormalized", 1_000),
    supplierCountryCode: code(input.supplierCountryCode, "supplierCountryCode", COUNTRY_RE),
    productDescriptionRaw: optionalText(input.productDescriptionRaw, "productDescriptionRaw", 4_000),
    normalizedProductCategory: optionalText(input.normalizedProductCategory, "normalizedProductCategory", 500),
    mdfProductId: input.mdfProductId ? requireMdfBusinessProductId(input.mdfProductId) : undefined,
    hsCodeRaw: optionalText(input.hsCodeRaw, "hsCodeRaw", 50),
    quantity: nonnegative(input.quantity, "quantity"),
    quantityUnit: optionalText(input.quantityUnit, "quantityUnit", 50),
    grossWeightKg: nonnegative(input.grossWeightKg, "grossWeightKg"),
    netWeightKg: nonnegative(input.netWeightKg, "netWeightKg"),
    tradeValue: nonnegative(input.tradeValue, "tradeValue"),
    currencyCode: code(input.currencyCode, "currencyCode", CURRENCY_RE),
    originPortRaw: optionalText(input.originPortRaw, "originPortRaw", 500),
    destinationPortRaw: optionalText(input.destinationPortRaw, "destinationPortRaw", 500),
    reportedRecordCount: nonnegative(input.reportedRecordCount, "reportedRecordCount", true),
    observedAt: instant(input.observedAt, "observedAt"),
    retrievedAt: instant(input.retrievedAt, "retrievedAt", true) as string,
    normalizationVersion: optionalText(input.normalizationVersion, "normalizationVersion", 120),
  };
}
