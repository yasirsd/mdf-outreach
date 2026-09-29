import "server-only";

import { PRODUCT_TRADE_MAPPINGS } from "@/lib/marketIntelligence/product";
import {
  CANADA_CID_ATTRIBUTION,
  CANADA_CID_DATASET_ID,
  CANADA_CID_PARSE_VERSION,
  CanadaCidParserError,
  canadaCidByHs6ByCountryUrl,
  fetchAndParseCanadaCidStream,
  matchCanadaCidCompany,
  type CanadaCidMatchResult,
} from "../canadaCid";
import {
  FDA_FSVP_DATASET_ID,
  FDA_FSVP_PARSE_VERSION,
  FDA_FSVP_SOURCE_URL,
  FdaFsvpParserError,
  fetchFdaFsvpDataset,
  matchFdaFsvpCompany,
  parseFdaFsvpXlsx,
  type FdaFsvpFetchResult,
} from "../fdaFsvp";
import {
  FDA_VQIP_ATTRIBUTION,
  FDA_VQIP_DATASET_ID,
  FDA_VQIP_PARSE_VERSION,
  FDA_VQIP_SOURCE_URL,
  FdaVqipParserError,
  fetchFdaVqipDataset,
  matchFdaVqipCompany,
  parseFdaVqipHtml,
} from "../fdaVqip";
import {
  CANADA_CID_DESCRIPTOR,
  CANADA_CID_SUPPORTED_YEAR,
  DEFAULT_TRADE_RESEARCH_DESCRIPTORS,
  FDA_FSVP_DESCRIPTOR,
  FDA_VQIP_DESCRIPTOR,
  canonicalHs6ForProduct,
  type TradeResearchProviderDescriptor,
} from "../providers";
import type { InternalJobRow, SnapshotRow, TradeResearchWriter } from "../repository";
import type {
  ResearchContext,
  TradeResearchEvidenceLevel,
  TradeResearchEvaluatedProviderResult,
  TradeResearchProviderExecutionState,
  TradeResearchProviderResult,
  TradeResearchSourceEvidence,
} from "../types";

const FETCH_TIMEOUT_MS = 25_000;
export const PROVIDER_MATCH_BUDGET_MS = 5_000;

export interface TradeResearchProviderPlan extends Record<string, unknown> {
  id: string;
  provider_id: string;
  sequence?: number;
}

export interface TradeResearchAttemptContext {
  attemptId: string;
  attemptNumber: number;
  previousState: string | null;
}

export interface ProviderDeadline {
  readonly deadlineAt?: number;
  remainingMs(): number;
  canStart(requiredMs: number): boolean;
}

export interface ProviderCheckpointState {
  readonly previousAttempt?: Readonly<Record<string, unknown>>;
}

export type ProviderExecutionResult =
  | {
      status: "completed" | "no_match" | "cached";
      providerResult: TradeResearchProviderResult;
      sourceEvidence: TradeResearchSourceEvidence;
      recordCount: number;
      matchCount: number;
    }
  | {
      status: "failed_retryable" | "failed_terminal";
      safeErrorCode: string;
      retryable: boolean;
    };

export interface TradeResearchProviderExecutionInput {
  readonly context: Readonly<ResearchContext>;
  readonly plan: Readonly<TradeResearchProviderPlan>;
  readonly attempt: Readonly<TradeResearchAttemptContext>;
  readonly deadline: ProviderDeadline;
  readonly checkpointState: Readonly<ProviderCheckpointState>;
  readonly writer: TradeResearchWriter;
  readonly job: InternalJobRow;
  readonly now: () => Date;
  readonly fetchImpl?: typeof fetch;
}

export interface TradeResearchProviderExecutor {
  readonly providerId: string;
  readonly descriptor: TradeResearchProviderDescriptor;
  /** Cold source acquisition plus the shared cleanup reserve is gated by core. */
  readonly requiredStartBudgetMs: number;
  hasFreshSnapshot(input: Pick<TradeResearchProviderExecutionInput, "writer" | "now">): Promise<boolean>;
  execute(input: TradeResearchProviderExecutionInput): Promise<ProviderExecutionResult>;
}

export interface TradeResearchProviderRegistry {
  resolve(providerId: string): TradeResearchProviderExecutor | undefined;
  list(): readonly TradeResearchProviderExecutor[];
}

export function createTradeResearchProviderRegistry(
  executors: readonly TradeResearchProviderExecutor[],
): TradeResearchProviderRegistry {
  const byId = new Map<string, TradeResearchProviderExecutor>();
  for (const executor of executors) {
    if (byId.has(executor.providerId)) throw new Error("DUPLICATE_PROVIDER_EXECUTOR");
    if (executor.providerId !== executor.descriptor.id) throw new Error("PROVIDER_EXECUTOR_DESCRIPTOR_MISMATCH");
    byId.set(executor.providerId, executor);
  }
  return Object.freeze({
    resolve: (providerId: string) => byId.get(providerId),
    list: () => Object.freeze([...byId.values()]),
  });
}

function evaluatedStatus(
  cacheHit: boolean,
  decision: "exact" | "strong" | "ambiguous" | "rejected" | "none",
): Extract<TradeResearchProviderExecutionState, "completed" | "no_match" | "cached"> {
  if (cacheHit) return "cached";
  return decision === "none" || decision === "rejected" ? "no_match" : "completed";
}

function evaluatedProviderResult(input: {
  context: Readonly<ResearchContext>;
  providerId: string;
  datasetId: string;
  parserVersion: string;
  snapshot: SnapshotRow;
  source: TradeResearchSourceEvidence;
  status: "completed" | "no_match" | "cached";
  matchCount: number;
  productGrain?: "company_product" | "not_available";
  originGrain?: "company_product_origin" | "not_available";
  programGrain?: "company_program" | "not_available";
  programEvidence?: TradeResearchEvidenceLevel;
  indiaOriginEvidence?: TradeResearchEvidenceLevel;
}): TradeResearchEvaluatedProviderResult {
  const assessment = (state: TradeResearchEvidenceLevel, explanation: string) => ({ state, explanation });
  return {
    providerId: input.providerId,
    datasetId: input.datasetId,
    datasetVersion: input.snapshot.material_hash,
    parserVersion: input.parserVersion,
    sourceRecordIds: Array.from({ length: input.matchCount }, (_, i) => `${input.snapshot.material_hash}:match:${i + 1}`),
    sourcePeriod: input.snapshot.published_period,
    retrievedAt: input.snapshot.retrieved_at,
    execution: { status: input.status, safeErrorCode: null },
    evidence: {
      matchDecision: input.source.identityDecision,
      companyEvidence: assessment(input.source.companyEvidence, input.source.matchReason),
      productEvidence: assessment(input.source.productEvidence, input.source.coverageExplanation),
      originEvidence: assessment(input.source.originEvidence, input.source.coverageExplanation),
      indiaOriginEvidence: assessment(
        input.indiaOriginEvidence ?? "not_verified",
        input.indiaOriginEvidence
          ? input.source.coverageExplanation
          : "This source did not verify an India-origin relationship for the matched company and product.",
      ),
      shipmentEvidence: assessment(input.source.shipmentEvidence, "This source does not establish shipment-level activity."),
      programEvidence: assessment(
        input.programEvidence ?? "not_available",
        input.programGrain === "company_program" ? input.source.matchReason : "This source is not an importer-program list.",
      ),
      coverage: { state: "partially_covered", explanation: input.source.coverageExplanation },
      limitations: [input.source.coverageExplanation],
      attribution: input.source.attribution,
      mappingScope: {
        marketCountryCode: input.context.marketCountryCode,
        productId: input.context.productId,
        productForm: input.context.productForm,
        sourceProductCodes: [],
        companyGrain: "company_record",
        productGrain: input.productGrain ?? "not_available",
        originGrain: input.originGrain ?? "not_available",
        shipmentGrain: "not_available",
        programGrain: input.programGrain ?? "not_available",
      },
      interpretationVersion: `${input.parserVersion}:t08-v1`,
      conflicts: [],
    },
  };
}

/** Shared cache probe used by every adapter; source-specific refresh/save remains local. */
export async function getCompatibleProviderSnapshot(
  writer: TradeResearchWriter,
  providerId: string,
  datasetId: string,
  now: Date,
): Promise<SnapshotRow | undefined> {
  return writer.getFreshSnapshotByProvider(providerId, datasetId, now);
}

async function getFsvpSnapshot(writer: TradeResearchWriter, now: Date, fetchImpl?: typeof fetch) {
  const fresh = await writer.getFreshSnapshot(now);
  if (fresh) return { snapshot: fresh, cacheHit: true };
  const latest = typeof writer.getLatestSnapshotByProvider === "function"
    ? await writer.getLatestSnapshotByProvider(FDA_FSVP_DESCRIPTOR.id, FDA_FSVP_DATASET_ID)
    : await writer.getLatestSnapshot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  let fetched: FdaFsvpFetchResult;
  try {
    fetched = await fetchFdaFsvpDataset({ etag: latest?.etag, lastModified: latest?.last_modified, fetchImpl, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Provider request timed out."), { code: "NETWORK_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timeout); }
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + FDA_FSVP_DESCRIPTOR.cacheMaxAgeDays * 86_400_000).toISOString();
  if (fetched.outcome === "not_modified") {
    if (!latest) throw new FdaFsvpParserError("FDA returned not-modified without a cached snapshot.");
    return { snapshot: await writer.refreshSnapshotExpiry(latest.id, retrievedAt, expiresAt), cacheHit: true };
  }
  if (!fetched.bytes || !fetched.materialHash) throw new FdaFsvpParserError("FDA dataset response was incomplete.");
  const parsed = parseFdaFsvpXlsx(fetched.bytes);
  return {
    cacheHit: false,
    snapshot: await writer.saveSnapshot({
      provider_id: FDA_FSVP_DESCRIPTOR.id, dataset_id: FDA_FSVP_DATASET_ID,
      published_period: parsed.publishedPeriod, source_url: FDA_FSVP_SOURCE_URL,
      etag: fetched.etag ?? null, last_modified: fetched.lastModified ?? null,
      material_hash: fetched.materialHash, fetched_at: retrievedAt, retrieved_at: retrievedAt, expires_at: expiresAt,
      row_count: parsed.rows.length, coverage: { fields: ["firm_legal_name", "state_code"], semantics: "official_program_corroboration_only" },
      parse_version: FDA_FSVP_PARSE_VERSION, terms_version: FDA_FSVP_DESCRIPTOR.termsVersion,
      status: "ready", safe_metadata: { malformedRowCount: parsed.malformedRowCount }, normalized_rows: parsed.rows,
    }),
  };
}

async function getVqipSnapshot(writer: TradeResearchWriter, now: Date, fetchImpl?: typeof fetch) {
  const fresh = await getCompatibleProviderSnapshot(writer, FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID, now);
  if (fresh) return { snapshot: fresh, cacheHit: true };
  const latest = await writer.getLatestSnapshotByProvider(FDA_VQIP_DESCRIPTOR.id, FDA_VQIP_DATASET_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  let fetched;
  try {
    fetched = await fetchFdaVqipDataset({ etag: latest?.etag, lastModified: latest?.last_modified, fetchImpl, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Provider request timed out."), { code: "NETWORK_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timeout); }
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + FDA_VQIP_DESCRIPTOR.cacheMaxAgeDays * 86_400_000).toISOString();
  if (fetched.outcome === "not_modified") {
    if (!latest) throw new FdaVqipParserError("FDA VQIP returned not-modified without a cached snapshot.");
    return { snapshot: await writer.refreshSnapshotExpiry(latest.id, retrievedAt, expiresAt), cacheHit: true };
  }
  if (!fetched.bytes || !fetched.materialHash) throw new FdaVqipParserError("FDA VQIP response was incomplete.");
  const parsed = parseFdaVqipHtml(fetched.bytes);
  return {
    cacheHit: false,
    snapshot: await writer.saveSnapshot({
      provider_id: FDA_VQIP_DESCRIPTOR.id, dataset_id: FDA_VQIP_DATASET_ID,
      published_period: parsed.publishedPeriod, source_url: FDA_VQIP_SOURCE_URL,
      etag: fetched.etag ?? null, last_modified: fetched.lastModified ?? null,
      material_hash: fetched.materialHash, fetched_at: retrievedAt, retrieved_at: retrievedAt, expires_at: expiresAt,
      row_count: parsed.rows.length,
      coverage: { fields: ["firm_name", "address", "state_code"], semantics: "voluntary_importer_program_participation_only", attribution: FDA_VQIP_ATTRIBUTION, shipmentLevel: false },
      parse_version: FDA_VQIP_PARSE_VERSION, terms_version: FDA_VQIP_DESCRIPTOR.termsVersion,
      status: "ready", safe_metadata: { malformedRowCount: parsed.malformedRowCount }, normalized_rows: parsed.rows,
    }),
  };
}

const CANONICAL_MDF_HS6: ReadonlySet<string> = new Set(
  PRODUCT_TRADE_MAPPINGS.filter((m) => m.hsLevel === 6).map((m) => m.hsCode.padStart(6, "0")),
);

async function getCidSnapshot(
  writer: TradeResearchWriter,
  now: Date,
  fetchImpl: typeof fetch | undefined,
  deadlineAt: number | undefined,
) {
  const fresh = await getCompatibleProviderSnapshot(writer, CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID, now);
  if (fresh) return { snapshot: fresh, cacheHit: true };
  const latest = await writer.getLatestSnapshotByProvider(CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  let loaded;
  try {
    loaded = await fetchAndParseCanadaCidStream({
      year: CANADA_CID_SUPPORTED_YEAR, etag: latest?.etag, lastModified: latest?.last_modified,
      fetchImpl, signal: controller.signal, canonicalHs6: CANONICAL_MDF_HS6, deadlineAt,
    });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("Provider request timed out."), { code: "NETWORK_TIMEOUT" });
    throw error;
  } finally { clearTimeout(timeout); }
  const retrievedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CANADA_CID_DESCRIPTOR.cacheMaxAgeDays * 86_400_000).toISOString();
  if (loaded.outcome === "not_modified") {
    if (!latest) throw new CanadaCidParserError("Canada CID returned not-modified without a cached snapshot.");
    return { snapshot: await writer.refreshSnapshotExpiry(latest.id, retrievedAt, expiresAt), cacheHit: true };
  }
  return {
    cacheHit: false,
    snapshot: await writer.saveSnapshot({
      provider_id: CANADA_CID_DESCRIPTOR.id, dataset_id: CANADA_CID_DATASET_ID,
      published_period: loaded.publishedPeriod, source_url: loaded.sourceUrl ?? canadaCidByHs6ByCountryUrl(CANADA_CID_SUPPORTED_YEAR),
      etag: loaded.etag ?? null, last_modified: loaded.lastModified ?? null,
      material_hash: loaded.materialHash, fetched_at: retrievedAt, retrieved_at: retrievedAt, expires_at: expiresAt,
      row_count: loaded.rows.length,
      coverage: { fields: ["hs6", "origin_country", "importer_company", "province", "city"], semantics: "company_hs_origin_directory_only", attribution: CANADA_CID_ATTRIBUTION, shipmentLevel: false, cachedSubset: "canonical-mdf-hs6-only", sourceBytes: loaded.bytesConsumed, sourceDataRows: loaded.totalDataRows },
      parse_version: CANADA_CID_PARSE_VERSION, terms_version: CANADA_CID_DESCRIPTOR.termsVersion,
      status: "ready", safe_metadata: { malformedRowCount: loaded.malformedRowCount, year: CANADA_CID_SUPPORTED_YEAR, totalDataRows: loaded.totalDataRows, retainedRows: loaded.retainedRows },
      normalized_rows: loaded.rows,
    }),
  };
}

function companyLevel(decision: "exact" | "strong" | "ambiguous" | "rejected" | "none"): TradeResearchSourceEvidence["companyEvidence"] {
  return decision === "exact" || decision === "strong" ? "verified"
    : decision === "ambiguous" ? "supporting" : "no_verified_match";
}

function programExecutor(input: {
  descriptor: TradeResearchProviderDescriptor;
  datasetId: string;
  parserVersion: string;
  sourceName: "FDA FSVP" | "FDA VQIP";
  attribution: string;
  requiredStartBudgetMs: number;
  load: (writer: TradeResearchWriter, now: Date, fetchImpl?: typeof fetch) => Promise<{ snapshot: SnapshotRow; cacheHit: boolean }>;
  match: (candidate: Awaited<ReturnType<TradeResearchWriter["getCandidate"]>>, snapshot: SnapshotRow) => {
    decision: "exact" | "strong" | "ambiguous" | "rejected" | "none";
    reason: string; candidateState?: string; matchedRows: unknown[];
  };
  rowName: (row: unknown) => string | undefined;
  rowState: (row: unknown) => string | undefined;
}): TradeResearchProviderExecutor {
  return {
    providerId: input.descriptor.id,
    descriptor: input.descriptor,
    requiredStartBudgetMs: input.requiredStartBudgetMs,
    hasFreshSnapshot: async ({ writer, now }) => input.descriptor.id === FDA_FSVP_DESCRIPTOR.id
      ? Boolean(await writer.getFreshSnapshot(now()))
      : Boolean(await getCompatibleProviderSnapshot(writer, input.descriptor.id, input.datasetId, now())),
    async execute(exec) {
      const { snapshot, cacheHit } = await input.load(exec.writer, exec.now(), exec.fetchImpl);
      const candidate = await exec.writer.getCandidate(exec.job);
      const match = input.match(candidate, snapshot);
      const status = evaluatedStatus(cacheHit, match.decision);
      const first = match.matchedRows[0];
      const coverageExplanation = input.sourceName === "FDA FSVP"
        ? "The FDA FSVP participant list contains name and U.S. state only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status."
        : "The FDA VQIP public list contains firm name, address, email, website only. It does not establish shipments, products, origin, suppliers, quantities, values, or CBP importer-of-record status.";
      const source: TradeResearchSourceEvidence = {
        providerId: input.descriptor.id as "fda-fsvp" | "fda-vqip",
        outcome: cacheHit ? "cache_hit" : status === "no_match" ? "no_match" : "completed",
        source: input.sourceName, datasetPeriod: snapshot.published_period, retrievedAt: snapshot.retrieved_at,
        matchedSourceName: input.rowName(first), matchedState: input.rowState(first),
        candidateName: candidate.companyName, candidateState: match.candidateState,
        identityDecision: match.decision, matchReason: match.reason, coverageExplanation,
        companyEvidence: companyLevel(match.decision), productEvidence: "not_available", originEvidence: "not_available",
        shipmentEvidence: "not_verified", attribution: input.attribution,
      };
      return {
        status,
        providerResult: evaluatedProviderResult({
          context: exec.context, providerId: input.descriptor.id, datasetId: input.datasetId,
          parserVersion: input.parserVersion, snapshot, source, status, matchCount: match.matchedRows.length,
          programGrain: "company_program", programEvidence: source.companyEvidence,
        }),
        sourceEvidence: source,
        recordCount: snapshot.row_count,
        matchCount: match.matchedRows.length,
      };
    },
  };
}

function projectCidEvidence(input: { decision: CanadaCidMatchResult["decision"]; originCountries: readonly string[]; mappingKind: "exact" | "proxy" | "composite" }) {
  const accepted = input.decision === "exact" || input.decision === "strong";
  const ambiguous = input.decision === "ambiguous";
  if (!accepted && !ambiguous) return { productEvidence: "no_verified_match" as const, originEvidence: "no_verified_match" as const, indiaOrigin: "not_verified" as const };
  const hasOrigin = input.originCountries.length > 0;
  const india = input.originCountries.includes("IN");
  return {
    productEvidence: accepted && input.mappingKind === "exact" ? "verified" as const : "supporting" as const,
    originEvidence: !hasOrigin ? "not_verified" as const : accepted ? "verified" as const : "supporting" as const,
    indiaOrigin: !india ? "not_verified" as const : accepted ? "verified" as const : "supporting" as const,
  };
}

function cidOriginCoverage(match: CanadaCidMatchResult, hs6: string): string {
  if (match.decision === "rejected") return `A similar company name exists in CID at HS6 ${hs6}, but its source province conflicts with the candidate's known province. Product and origin fields from those rows are not attributed to this candidate.`;
  if (match.decision === "none") return `No company identity match was found in CID at HS6 ${hs6}; no product or origin fields are attributed to this candidate.`;
  if (match.decision === "ambiguous") return `Origin countries observed on the similar-name rows at HS6 ${hs6}: ${match.originCountries.length ? match.originCountries.join(", ") : "none"}. Candidate province is unavailable, so company-scoped evidence is capped at supporting.`;
  return `Origin countries observed for the accepted company identity at HS6 ${hs6}: ${match.originCountries.length ? match.originCountries.join(", ") : "none"}.`;
}

export const FDA_FSVP_EXECUTOR = programExecutor({
  descriptor: FDA_FSVP_DESCRIPTOR, datasetId: FDA_FSVP_DATASET_ID, parserVersion: FDA_FSVP_PARSE_VERSION,
  sourceName: "FDA FSVP", attribution: "Source: U.S. Food & Drug Administration — Foreign Supplier Verification Programs participant list.",
  requiredStartBudgetMs: 25_000, load: getFsvpSnapshot,
  match: (candidate, snapshot) => matchFdaFsvpCompany({ companyName: candidate.companyName, address: candidate.address, city: candidate.city, rows: snapshot.normalized_rows }),
  rowName: (row) => (row as { companyName?: string } | undefined)?.companyName,
  rowState: (row) => (row as { stateCode?: string } | undefined)?.stateCode,
});

export const FDA_VQIP_EXECUTOR = programExecutor({
  descriptor: FDA_VQIP_DESCRIPTOR, datasetId: FDA_VQIP_DATASET_ID, parserVersion: FDA_VQIP_PARSE_VERSION,
  sourceName: "FDA VQIP", attribution: FDA_VQIP_ATTRIBUTION, requiredStartBudgetMs: 5_000, load: getVqipSnapshot,
  match: (candidate, snapshot) => matchFdaVqipCompany({ companyName: candidate.companyName, address: candidate.address, city: candidate.city, rows: snapshot.normalized_rows as never }),
  rowName: (row) => (row as { firmName?: string } | undefined)?.firmName,
  rowState: (row) => (row as { stateCode?: string } | undefined)?.stateCode,
});

export const CANADA_CID_EXECUTOR: TradeResearchProviderExecutor = {
  providerId: CANADA_CID_DESCRIPTOR.id,
  descriptor: CANADA_CID_DESCRIPTOR,
  requiredStartBudgetMs: 30_000,
  hasFreshSnapshot: async ({ writer, now }) => Boolean(await getCompatibleProviderSnapshot(
    writer, CANADA_CID_DESCRIPTOR.id, CANADA_CID_DATASET_ID, now(),
  )),
  async execute(input) {
    const hs = canonicalHs6ForProduct(input.context.productId);
    if (!hs) throw Object.assign(new Error("Unsupported product mapping."), { code: "UNSUPPORTED_PRODUCT_MAPPING" });
    const { snapshot, cacheHit } = await getCidSnapshot(input.writer, input.now(), input.fetchImpl, input.deadline.deadlineAt);
    const candidate = await input.writer.getCandidate(input.job);
    const match = matchCanadaCidCompany({
      companyName: candidate.companyName, address: candidate.address, city: candidate.city,
      targetHs6: hs.hs6, rows: snapshot.normalized_rows as never,
    });
    const status = evaluatedStatus(cacheHit, match.decision);
    const projected = projectCidEvidence({ decision: match.decision, originCountries: match.originCountries, mappingKind: hs.kind });
    const row = match.matchedRows[0];
    const coverageExplanation = [
      "Canada CID is a major-importer directory joined at (HS6, origin country, importer company).",
      `HS6 ${hs.hs6} mapping quality: ${hs.kind}${hs.kind === "exact" ? "" : " — product evidence capped at \"supporting\""}.`,
      cidOriginCoverage(match, hs.hs6),
      "Dataset does not carry shipment date, per-company quantity, per-company value, or supplier.",
      CANADA_CID_ATTRIBUTION,
    ].join(" ");
    const source: TradeResearchSourceEvidence = {
      providerId: "canada-cid", outcome: cacheHit ? "cache_hit" : status === "no_match" ? "no_match" : "completed",
      source: "Canadian Importers Database", datasetPeriod: snapshot.published_period, retrievedAt: snapshot.retrieved_at,
      matchedSourceName: row?.companyName, matchedState: row?.province,
      candidateName: candidate.companyName, candidateState: match.candidateProvince,
      identityDecision: match.decision, matchReason: match.reason, coverageExplanation,
      companyEvidence: companyLevel(match.decision), productEvidence: projected.productEvidence,
      originEvidence: projected.originEvidence, shipmentEvidence: "not_verified", attribution: CANADA_CID_ATTRIBUTION,
    };
    return {
      status,
      providerResult: evaluatedProviderResult({
        context: input.context, providerId: CANADA_CID_DESCRIPTOR.id, datasetId: CANADA_CID_DATASET_ID,
        parserVersion: CANADA_CID_PARSE_VERSION, snapshot, source, status, matchCount: match.matchedRows.length,
        productGrain: "company_product", originGrain: "company_product_origin", indiaOriginEvidence: projected.indiaOrigin,
      }),
      sourceEvidence: source, recordCount: snapshot.row_count, matchCount: match.matchedRows.length,
    };
  },
};

const EXECUTORS_BY_DESCRIPTOR = new Map<string, TradeResearchProviderExecutor>([
  [FDA_FSVP_EXECUTOR.providerId, FDA_FSVP_EXECUTOR],
  [FDA_VQIP_EXECUTOR.providerId, FDA_VQIP_EXECUTOR],
  [CANADA_CID_EXECUTOR.providerId, CANADA_CID_EXECUTOR],
]);

/** The executor registry is derived from the existing descriptor registry. */
export const DEFAULT_TRADE_RESEARCH_PROVIDER_REGISTRY = createTradeResearchProviderRegistry(
  DEFAULT_TRADE_RESEARCH_DESCRIPTORS.map((descriptor) => {
    const executor = EXECUTORS_BY_DESCRIPTOR.get(descriptor.id);
    if (!executor) throw new Error("MISSING_PROVIDER_EXECUTOR");
    return executor;
  }),
);

export function parserFailureCode(error: unknown): string | undefined {
  if (error instanceof FdaFsvpParserError || error instanceof FdaVqipParserError || error instanceof CanadaCidParserError) {
    return error.code;
  }
  return undefined;
}
