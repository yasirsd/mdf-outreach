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
  PUBLIC_WEBSITE_DESCRIPTOR,
  THAI_CUSTOMS_STATS_DESCRIPTOR,
  canonicalHs6ForProduct,
  type TradeResearchProviderDescriptor,
} from "../providers";
import {
  DEFAULT_PUBLIC_WEBSITE_USER_AGENT,
  PUBLIC_WEBSITE_ATTRIBUTION,
  PUBLIC_WEBSITE_INTERPRETATION_VERSION,
  PUBLIC_WEBSITE_PARSER_VERSION,
  extractPublicWebsiteSignals,
  isPathAllowedByRobots,
  mergePublicWebsiteSignals,
  selectSameOriginSubpages,
  type MergedPublicWebsiteSignals,
  type PublicWebsiteSignals,
} from "../publicWebsite";
import { findThailandHsMapping } from "../thailand/hsMapping";
import {
  THAI_CUSTOMS_STATS_ATTRIBUTION,
  THAI_CUSTOMS_STATS_SOURCE_URL,
} from "../thaiCustomsStats";
import {
  classifyFetchFailure,
  fetchThaiCustomsStatsCatalog,
  filterThaiCustomsStatsRows,
  parseThaiCustomsStatsCsv,
  projectThaiCustomsMarketEvidence,
  selectLatestReleasedResource,
  THAI_CUSTOMS_STATS_DATASET_ID,
  THAI_CUSTOMS_STATS_INTERPRETATION_VERSION,
  THAI_CUSTOMS_STATS_PARSER_VERSION,
  ThaiCustomsStatsCatalogError,
  ThaiCustomsStatsParserError,
} from "../thaiCustomsStats";
import { createHash } from "node:crypto";
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

/**
 * TH04A — Thai Customs Statistics executor.
 *
 * MARKET-LEVEL ONLY. There is no candidate-name matching:
 * `writer.getCandidate` is never called by this executor. The
 * provider emits a `TradeResearchProviderResult` whose evidence
 * reports Thailand-level import flows at HS 09042110 and any
 * India-origin component. `companyEvidence` is always
 * `not_available`; `shipmentEvidence` always `not_verified`.
 */
export const THAI_CUSTOMS_STATS_EXECUTOR: TradeResearchProviderExecutor = {
  providerId: THAI_CUSTOMS_STATS_DESCRIPTOR.id,
  descriptor: THAI_CUSTOMS_STATS_DESCRIPTOR,
  requiredStartBudgetMs: 25_000,
  hasFreshSnapshot: async ({ writer, now }) => Boolean(
    await getCompatibleProviderSnapshot(writer, THAI_CUSTOMS_STATS_DESCRIPTOR.id, THAI_CUSTOMS_STATS_DATASET_ID, now()),
  ),
  async execute(input) {
    const context = input.context;
    const mapping = findThailandHsMapping(context.productId, context.productForm);
    if (!mapping || mapping.thaiQueryCodes.length === 0) {
      return { status: "failed_terminal", safeErrorCode: "UNSUPPORTED_PRODUCT_MAPPING", retryable: false };
    }
    const hs8 = mapping.thaiQueryCodes[0]!;
    const now = input.now();
    const fetchImpl = input.fetchImpl ?? fetch;
    const deadlineAt = input.deadline.deadlineAt;

    // Try cache first.
    const cached = await getCompatibleProviderSnapshot(
      input.writer, THAI_CUSTOMS_STATS_DESCRIPTOR.id, THAI_CUSTOMS_STATS_DATASET_ID, now,
    );

    let snapshot: SnapshotRow;
    let cacheHit = false;

    if (cached) {
      snapshot = cached;
      cacheHit = true;
    } else {
      // Discover a released resource.
      let resources;
      try {
        const catalogController = new AbortController();
        const catalogTimeout = setTimeout(() => catalogController.abort(), Math.min(FETCH_TIMEOUT_MS, input.deadline.remainingMs()));
        try {
          resources = await fetchThaiCustomsStatsCatalog({ fetchImpl, signal: catalogController.signal });
        } finally { clearTimeout(catalogTimeout); }
      } catch (error) {
        if (error instanceof ThaiCustomsStatsCatalogError) {
          // TH07 DEFECT 05A — specific safe code; retryable comes from
          // the classifier (DNS / connect-refused / timeout retryable;
          // TLS / HTTP 403/404 terminal).
          return { status: error.retryable ? "failed_retryable" : "failed_terminal", safeErrorCode: error.code, retryable: error.retryable };
        }
        return { status: "failed_retryable", safeErrorCode: "CATALOG_FETCH_UNKNOWN", retryable: true };
      }
      const resource = selectLatestReleasedResource(resources);
      if (!resource) {
        return { status: "failed_terminal", safeErrorCode: "NO_RELEASED_RESOURCE", retryable: false };
      }

      // Download CSV once.
      let csvBytes: Uint8Array;
      let contentType = "text/csv";
      // TH07 DEFECT 05A — keep the fetch controller/signal in scope so
      // the catch can distinguish our-abort from remote-close.
      const csvController = new AbortController();
      const csvTimeout = setTimeout(() => csvController.abort(), Math.min(FETCH_TIMEOUT_MS, Math.max(5_000, input.deadline.remainingMs())));
      try {
        try {
          const r = await fetchImpl(resource.url, { signal: csvController.signal });
          if (!r.ok) {
            const retryable = r.status >= 500 || r.status === 429 || r.status === 408;
            return { status: retryable ? "failed_retryable" : "failed_terminal", safeErrorCode: `RESOURCE_HTTP_${r.status}`, retryable };
          }
          contentType = r.headers.get("content-type") ?? "text/csv";
          const buf = await r.arrayBuffer();
          csvBytes = new Uint8Array(buf);
        } finally { clearTimeout(csvTimeout); }
      } catch (error) {
        // TH07 DEFECT 05A — produce distinct safe codes for DNS vs
        // connect-refused vs timeout vs TLS vs generic. Keeps the
        // CATALOG_ / RESOURCE_ prefix split so metadata-vs-resource
        // failures are visibly separate in production logs.
        const classified = classifyFetchFailure("RESOURCE", error, csvController.signal);
        return { status: classified.retryable ? "failed_retryable" : "failed_terminal", safeErrorCode: classified.code, retryable: classified.retryable };
      }

      // Dataset version = sha256(raw CSV bytes).
      const digest = createHash("sha256").update(csvBytes).digest("hex");
      const materialHash = `sha256:${digest}`;

      // Parse (schema mismatch → quarantine via T12 v2 at classification time).
      let csvText: string;
      try {
        csvText = new TextDecoder("utf-8", { fatal: false }).decode(csvBytes);
      } catch {
        return { status: "failed_terminal", safeErrorCode: "CSV_DECODE_FAILED", retryable: false };
      }
      let rows;
      try {
        rows = parseThaiCustomsStatsCsv(csvText);
      } catch (error) {
        const code = error instanceof ThaiCustomsStatsParserError ? error.code : "PARSER_FAILED";
        return { status: "failed_terminal", safeErrorCode: code, retryable: false };
      }
      // Save the dataset-wide normalized rows to the snapshot cache so
      // repeat runs within TTL skip the fetch entirely.
      const retrievedAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + THAI_CUSTOMS_STATS_DESCRIPTOR.cacheMaxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      snapshot = await input.writer.saveSnapshot({
        provider_id: THAI_CUSTOMS_STATS_DESCRIPTOR.id,
        dataset_id: THAI_CUSTOMS_STATS_DATASET_ID,
        published_period: resource.sourcePeriod,
        source_url: resource.url,
        material_hash: materialHash,
        fetched_at: retrievedAt,
        retrieved_at: retrievedAt,
        expires_at: expiresAt,
        row_count: rows.length,
        coverage: { hs8: [hs8], originCountryCode: "IN", datasetId: THAI_CUSTOMS_STATS_DATASET_ID, resourceId: resource.id },
        safe_metadata: {
          contentType,
          byteSize: csvBytes.byteLength,
          sourcePeriod: resource.sourcePeriod,
          resourceId: resource.id,
          attribution: THAI_CUSTOMS_STATS_ATTRIBUTION,
        },
        normalized_rows: rows as unknown as Array<{ companyName: string; stateCode: string }>,
        parse_version: THAI_CUSTOMS_STATS_PARSER_VERSION,
        status: "ready",
      } as Record<string, unknown>);
    }

    // Project market-level evidence from the (now-guaranteed) snapshot rows.
    const persistedRows = Array.isArray(snapshot.normalized_rows)
      ? (snapshot.normalized_rows as unknown as readonly { hs8: string; originCountryCode: string; importValueThb: number | null; statisticalCode: string | null }[])
      : [];
    const hsRows = filterThaiCustomsStatsRows(persistedRows as never, { hs8 });
    const projection = projectThaiCustomsMarketEvidence({
      hsRows: hsRows as never,
      indiaSourceKey: "IN",
      sourcePeriod: snapshot.published_period,
    });

    // Build a market-level provider result. There is no candidate
    // match; `matchDecision` is "none" because the executor never
    // attempts company identity on this dataset. Downstream T05
    // aggregator will read market-level evidence from this provider
    // without promoting it to company-level claims.
    const observationExplanation = [
      `Thai Customs ctm_06_11 (${snapshot.published_period}): HS8 ${hs8} rows observed = ${projection.totalMarketRows}; India-origin rows = ${projection.indiaMarketRows}.`,
      `Total market import value (THB) at HS8 ${hs8} = ${projection.totalMarketImportValueThb.toLocaleString("en-US")}.`,
      `India-origin market import value (THB) = ${projection.indiaMarketImportValueThb.toLocaleString("en-US")}.`,
      "Market-level evidence only — never a company-level claim.",
      THAI_CUSTOMS_STATS_ATTRIBUTION,
    ].join(" ");
    const coverageExplanation = projection.marketImportActivity === "observed"
      ? `Thailand HS8 ${hs8} import flows observed at MARKET level in ${projection.sourcePeriod}. India-origin market activity: ${projection.indiaOriginMarketActivity}.`
      : `No Thailand import rows observed at HS8 ${hs8} in ${projection.sourcePeriod}; market-level not_observed (never a candidate-level negative claim).`;

    const status: Extract<TradeResearchProviderExecutionState, "completed" | "no_match" | "cached"> =
      cacheHit ? "cached" : (projection.marketImportActivity === "observed" ? "completed" : "no_match");

    const source: TradeResearchSourceEvidence = {
      providerId: THAI_CUSTOMS_STATS_DESCRIPTOR.id as never,
      outcome: cacheHit ? "cache_hit" : (status === "no_match" ? "no_match" : "completed"),
      source: "Thai Customs Data Catalog — ctm_06_11",
      datasetPeriod: snapshot.published_period,
      retrievedAt: snapshot.retrieved_at,
      // No candidate match performed; the fields that only make sense
      // under a company match are left undefined.
      matchedSourceName: undefined,
      matchedState: undefined,
      candidateName: undefined,
      candidateState: undefined,
      identityDecision: "none",
      matchReason: observationExplanation,
      coverageExplanation,
      companyEvidence: "not_available",
      productEvidence: projection.productRelevance === "observed" ? "supporting" : "not_available",
      originEvidence: projection.indiaOriginMarketActivity === "observed" ? "supporting" : "not_available",
      shipmentEvidence: "not_verified",
      attribution: THAI_CUSTOMS_STATS_ATTRIBUTION,
    };

    const providerResult: TradeResearchProviderResult = {
      providerId: THAI_CUSTOMS_STATS_DESCRIPTOR.id,
      datasetId: THAI_CUSTOMS_STATS_DATASET_ID,
      datasetVersion: snapshot.material_hash ?? null,
      parserVersion: THAI_CUSTOMS_STATS_PARSER_VERSION,
      sourceRecordIds: [`${THAI_CUSTOMS_STATS_DATASET_ID}:${snapshot.published_period}:${hs8}`],
      sourcePeriod: snapshot.published_period,
      retrievedAt: snapshot.retrieved_at,
      execution: { status, safeErrorCode: null },
      evidence: {
        matchDecision: "none",
        companyEvidence: { state: "not_available", explanation: "Market-level dataset — no candidate matching." },
        productEvidence: { state: projection.productRelevance === "observed" ? "supporting" : "not_available", explanation: `HS8 ${hs8} rows: ${projection.totalMarketRows}.` },
        originEvidence: { state: projection.indiaOriginMarketActivity === "observed" ? "supporting" : "not_available", explanation: `India-origin market rows at HS8 ${hs8}: ${projection.indiaMarketRows}.` },
        indiaOriginEvidence: { state: projection.indiaOriginMarketActivity === "observed" ? "supporting" : "not_verified", explanation: `India-origin market rows at HS8 ${hs8}: ${projection.indiaMarketRows}. Market-level only.` },
        shipmentEvidence: { state: "not_verified", explanation: "Dataset does not carry per-company shipment records." },
        programEvidence: { state: "not_available", explanation: "Not a program-participant list." },
        coverage: {
          state: projection.marketImportActivity === "observed" ? "partially_covered" : "not_covered",
          explanation: coverageExplanation,
        },
        limitations: [
          "Thai Customs ctm_06_11 is a market-level aggregate (HS × origin × period). No candidate identity is matched.",
          "`company_shipment_activity` is NEVER set to a positive claim by this provider.",
        ],
        attribution: THAI_CUSTOMS_STATS_ATTRIBUTION,
        mappingScope: {
          marketCountryCode: context.marketCountryCode,
          productId: context.productId,
          productForm: context.productForm,
          sourceProductCodes: [hs8, ...projection.observedStatisticalCodes],
          companyGrain: "not_available",
          productGrain: "market_product",
          originGrain: "market_product_origin",
          shipmentGrain: "not_available",
          programGrain: "not_available",
        },
        interpretationVersion: THAI_CUSTOMS_STATS_INTERPRETATION_VERSION,
        conflicts: [],
      },
    };

    return {
      status,
      providerResult,
      sourceEvidence: source,
      recordCount: snapshot.row_count,
      matchCount: projection.totalMarketRows,
    };
  },
};

// `THAI_CUSTOMS_STATS_SOURCE_URL` is re-exported so tests and the UI
// can reference the human-readable catalog page for the dataset.
export { THAI_CUSTOMS_STATS_SOURCE_URL } from "../thaiCustomsStats";

/**
 * TH04B — Public-website trade-research executor.
 *
 * COMPANY_SITE grain only. Fetches the candidate's own homepage
 * (bounded, HTML-only, max 256 KiB, timeout 8 s, one redirect
 * allowed), extracts Thai-aware signals via TH03 helpers, and
 * projects to `supporting` evidence at best. NEVER promotes to
 * `verified` identity, never emits shipment / India-origin /
 * regulatory evidence. If `candidate.website` is missing or the
 * URL cannot be parsed as HTTP(S), the provider is `unavailable`.
 *
 * Reused safety:
 *   - robots.txt is honored by checking the candidate domain's
 *     `/robots.txt` for a generic Disallow against the user-agent
 *     path we are about to fetch. If disallowed, we skip.
 *   - no browser automation, no CAPTCHA bypass.
 *   - no cookies persist; no credentials.
 */
const PUBLIC_WEBSITE_FETCH_TIMEOUT_MS = 8_000;
const PUBLIC_WEBSITE_MAX_BODY_BYTES = 256 * 1024;
const PUBLIC_WEBSITE_USER_AGENT = DEFAULT_PUBLIC_WEBSITE_USER_AGENT;
const PUBLIC_WEBSITE_MAX_CONTENT_PAGES = 3;

/**
 * TH07 DEFECT 05B HARDENING — single, shared private-host predicate.
 *
 * Protection level is PATTERN-ONLY on the hostname literal:
 *   - rejects `localhost` / `*.localhost`
 *   - rejects literal RFC1918 + 127/8 + 169.254/16 + 172.16/12 addresses
 *     when the hostname IS the literal IP
 * We do NOT perform DNS resolution here, so a hostile authoritative DNS
 * that resolves `attacker.example` → 10.0.0.5 is NOT caught at this
 * layer. Full DNS-level private-IP protection lives in
 * `src/lib/buyerFinder/ssrf.ts` and is exercised by Buyer Finder's
 * pinned fetch; the trade-research public-website executor
 * historically runs without that pinned stack and keeps the same
 * pattern-level guard it had before this hardening.
 */
function isPrivateOrLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return true;
  // `URL.hostname` for bracketed IPv6 literals is returned bracketed
  // on recent Node versions (`[::1]`). Normalize before matching.
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  // IPv6 loopback (::1) / unspecified (::) / link-local (fe80::/10) /
  // unique-local (fc00::/7) literals.
  if (h === "::1" || h === "0:0:0:0:0:0:0:1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

function toHomepageUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (isPrivateOrLoopbackHost(host)) return null;
    // Strip query/fragment; use origin + /.
    return new URL("/", url);
  } catch { return null; }
}

/**
 * Bounded redirect budget for public-website fetches. Three hops is
 * enough for www./non-www./https/http canonicalization chains observed
 * in production catalog data; more than that is a trap or a loop.
 */
const PUBLIC_WEBSITE_MAX_REDIRECTS = 3;

/**
 * TH07 DEFECT 05B HARDENING — controlled redirect fetch.
 *
 * The pre-hardening implementation used `redirect: "follow"` and then
 * inspected `response.url`. That is NOT sufficient SSRF protection:
 * Node's undici will already have opened a TCP connection to the
 * redirect target (e.g. 169.254.169.254 cloud metadata, 10.x RFC1918,
 * 127.0.0.1) BEFORE `response.url` is observable to us.
 *
 * The hardened loop:
 *   1. receives each response with `redirect: "manual"` so the
 *      transport never follows automatically,
 *   2. reads `Location`, resolves it against the current URL,
 *   3. validates the resolved hostname against the shared SSRF
 *      predicate BEFORE issuing the next fetch, and
 *   4. caps the redirect chain at PUBLIC_WEBSITE_MAX_REDIRECTS.
 *
 * No initial-host weakening: the first URL came from `toHomepageUrl`
 * which already applied the same predicate.
 *
 * Same-origin crawl policy: the caller resolves the FINAL (post-
 * redirect) host and uses it as the subpage origin, so a legitimate
 * `example.com` → `www.example.com` canonical redirect still allows
 * the two bounded subpages on `www.example.com`.
 */
async function bounded_fetch_html(
  url: URL,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; code: string; retryable: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLIC_WEBSITE_FETCH_TIMEOUT_MS);
  let currentUrl = new URL(url.toString());
  try {
    for (let hop = 0; hop <= PUBLIC_WEBSITE_MAX_REDIRECTS; hop += 1) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl.toString(), {
          method: "GET",
          headers: { "user-agent": PUBLIC_WEBSITE_USER_AGENT, accept: "text/html" },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        // TH07 DEFECT 05B — classify DNS vs connect-refused vs TLS vs
        // timeout into bounded `WEBSITE_*` safe codes (mirrors Defect
        // 05A's catalog / resource classification). Replaces the
        // opaque two-bucket {WEBSITE_TIMEOUT, WEBSITE_FETCH_FAILED}
        // with the full suite so production logs distinguish the
        // failure modes.
        const classified = classifyFetchFailure("WEBSITE", error, controller.signal);
        return { ok: false, code: classified.code, retryable: classified.retryable };
      }

      // Manual redirect — validate the Location target BEFORE issuing
      // the next request.
      const isRedirect =
        response.status === 301
        || response.status === 302
        || response.status === 303
        || response.status === 307
        || response.status === 308;
      if (isRedirect) {
        if (hop >= PUBLIC_WEBSITE_MAX_REDIRECTS) {
          return { ok: false, code: "WEBSITE_REDIRECT_LIMIT", retryable: false };
        }
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, code: "WEBSITE_REDIRECT_BLOCKED", retryable: false };
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          // Malformed Location header is treated as a blocked redirect,
          // not a crash; no second fetch is issued.
          return { ok: false, code: "WEBSITE_REDIRECT_BLOCKED", retryable: false };
        }
        if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
          return { ok: false, code: "WEBSITE_REDIRECT_BLOCKED", retryable: false };
        }
        if (isPrivateOrLoopbackHost(nextUrl.hostname)) {
          return { ok: false, code: "WEBSITE_REDIRECT_BLOCKED", retryable: false };
        }
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        return { ok: false, code: `WEBSITE_HTTP_${response.status}`, retryable };
      }
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        return { ok: false, code: "WEBSITE_NOT_HTML", retryable: false };
      }
      const buf = await response.arrayBuffer();
      if (buf.byteLength > PUBLIC_WEBSITE_MAX_BODY_BYTES) {
        return { ok: false, code: "WEBSITE_TOO_LARGE", retryable: false };
      }
      const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      void now;
      return { ok: true, html, finalUrl: currentUrl.toString() };
    }
    return { ok: false, code: "WEBSITE_REDIRECT_LIMIT", retryable: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TH04C Step 0A — fetches robots.txt ONCE per candidate host and
 * returns an evaluator closed over the parsed body. `allowsPath` is
 * then safe to call for every candidate URL on that host.
 *
 * Conservative on fetch failure: a network error returns an
 * evaluator that permits every path (matches the previous policy),
 * while a 200 OK with malformed content → evaluator returns `false`
 * for everything (`isPathAllowedByRobots` is strict).
 */
async function loadRobotsEvaluator(host: string, fetchImpl: typeof fetch): Promise<(requestPath: string) => boolean> {
  let body: string | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const r = await fetchImpl(`https://${host}/robots.txt`, {
        headers: { "user-agent": PUBLIC_WEBSITE_USER_AGENT, accept: "text/plain" },
        signal: controller.signal,
      });
      body = r.ok ? await r.text() : null;
    } finally { clearTimeout(timer); }
  } catch { body = null; }
  return (requestPath: string) => isPathAllowedByRobots(body, requestPath, PUBLIC_WEBSITE_USER_AGENT);
}

function evidenceLevel(signals: PublicWebsiteSignals): {
  productState: "supporting" | "not_available";
  companyState: "supporting" | "not_available";
  productExplanation: string;
  companyExplanation: string;
  coverageState: "partially_covered" | "not_covered";
  coverageExplanation: string;
  observationExplanation: string;
} {
  const productState = signals.productSignals.length > 0 ? "supporting" : "not_available";
  const identity = signals.identityComparison;
  const companyState = identity && (
    identity.matchLevel === "exact" || identity.matchLevel === "strong"
  ) ? "supporting" : "not_available";
  const productExplanation = signals.productSignals.length > 0
    ? `Observed product-signal keywords on the company's own website: ${signals.productSignals.slice(0, 6).join(", ")}. COMPANY-SITE grain only.`
    : "No product-signal keywords observed on the fetched page(s). Language coverage may be incomplete — not a company-level negative claim.";
  const companyExplanation = companyState === "supporting"
    ? `Candidate company identity supported by website evidence (${identity!.matchLevel}): ${identity!.reasons.join(", ")}. Supporting — never 'verified' from website alone.`
    : "No strong on-site identity signal (requires exact Thai/English legal-name match or juristic number).";
  const coverageState = (productState === "supporting" || companyState === "supporting" || signals.observedPublicEmails.length > 0 || signals.observedPublicPhones.length > 0) ? "partially_covered" : "not_covered";
  const coverageExplanation = `Pages inspected: 1 (homepage). Role signals observed: ${signals.roleSignals.length}. Public emails observed: ${signals.observedPublicEmails.length}. Public phones observed: ${signals.observedPublicPhones.length}.`;
  const observationExplanation = [
    `Website: ${signals.pageUrl}.`,
    signals.pageTitle ? `Title: "${signals.pageTitle}".` : "",
    signals.productSignals.length ? `Product signals: ${signals.productSignals.slice(0, 6).join(", ")}.` : "",
    signals.roleSignals.length ? `Role signals (website claims only): ${signals.roleSignals.slice(0, 6).join(", ")}.` : "",
    signals.observedPublicEmails.length ? `Public email(s) observed: ${signals.observedPublicEmails.length}.` : "",
    PUBLIC_WEBSITE_ATTRIBUTION,
  ].filter(Boolean).join(" ");
  return { productState, companyState, productExplanation, companyExplanation, coverageState, coverageExplanation, observationExplanation };
}

export const PUBLIC_WEBSITE_EXECUTOR: TradeResearchProviderExecutor = {
  providerId: PUBLIC_WEBSITE_DESCRIPTOR.id,
  descriptor: PUBLIC_WEBSITE_DESCRIPTOR,
  requiredStartBudgetMs: 15_000,
  // No snapshot cache for website fetches — each run inspects the
  // candidate's current public page content. `hasFreshSnapshot`
  // always returns false so the executor fetches when claimed.
  hasFreshSnapshot: async () => false,
  async execute(input) {
    const candidate = await input.writer.getCandidate(input.job);
    const url = toHomepageUrl(candidate.website ?? candidate.domain ?? null);
    if (!url) {
      return { status: "failed_terminal", safeErrorCode: "WEBSITE_UNAVAILABLE", retryable: false };
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    const host = url.hostname.toLowerCase();

    // TH04C Step 0A — fetch robots.txt once, evaluate per path.
    const robotsAllows = await loadRobotsEvaluator(host, fetchImpl);
    if (!robotsAllows(url.pathname || "/")) {
      return { status: "failed_terminal", safeErrorCode: "WEBSITE_ROBOTS_DISALLOW", retryable: false };
    }

    // 1. Homepage.
    const homepage = await bounded_fetch_html(url, fetchImpl, input.now);
    if (!homepage.ok) {
      return { status: homepage.retryable ? "failed_retryable" : "failed_terminal", safeErrorCode: homepage.code, retryable: homepage.retryable };
    }
    const homepageSignals = extractPublicWebsiteSignals({
      html: homepage.html,
      url: homepage.finalUrl,
      candidateCompanyName: candidate.companyName ?? null,
      candidateDomain: candidate.domain ?? null,
      candidateJuristicRegistrationNumber: null,
    });

    // 2. Discover + fetch up to two bounded same-origin subpages.
    const subpagePicks = selectSameOriginSubpages({
      homepageHtml: homepage.html,
      homepageUrl: homepage.finalUrl,
    });
    // TH07 DEFECT 05B HARDENING — Preserve same-origin crawl policy
    // AFTER canonical redirect resolution: a legitimate
    // `example.com` → `www.example.com` 301 keeps subpages scoped to
    // the canonical host rather than being wrongly rejected because
    // they differ from the pre-redirect hostname.
    const canonicalHost = ((): string => {
      try { return new URL(homepage.finalUrl).hostname.toLowerCase(); } catch { return host; }
    })();
    // TH07 DEFECT 05B HARDENING — the dataset version must be
    // content-sensitive. We carry a SHA-256 of each fetched page's
    // body (bounded, already in memory) alongside the extracted
    // signals. The raw HTML is NEVER persisted or logged — only its
    // hash crosses the function boundary.
    const perPage: Array<{
      category: "homepage" | "contact" | "product";
      signals: PublicWebsiteSignals;
      contentSha256: string;
    }> = [
      { category: "homepage", signals: homepageSignals, contentSha256: createHash("sha256").update(homepage.html, "utf8").digest("hex") },
    ];
    const subpageCategories: Array<"contact" | "product"> = ["contact", "product"];
    for (const cat of subpageCategories) {
      if (perPage.length >= PUBLIC_WEBSITE_MAX_CONTENT_PAGES) break;
      const target = subpagePicks[cat];
      if (!target) continue;
      let parsed: URL;
      try { parsed = new URL(target); } catch { continue; }
      if (parsed.hostname.toLowerCase() !== canonicalHost) continue;
      if (!robotsAllows(parsed.pathname || "/")) continue;
      const fetched = await bounded_fetch_html(parsed, fetchImpl, input.now);
      if (!fetched.ok) continue; // optional subpage: 404 / failure skipped, do NOT fail the provider.
      perPage.push({
        category: cat,
        signals: extractPublicWebsiteSignals({
          html: fetched.html,
          url: fetched.finalUrl,
          candidateCompanyName: candidate.companyName ?? null,
          candidateDomain: candidate.domain ?? null,
          candidateJuristicRegistrationNumber: null,
        }),
        contentSha256: createHash("sha256").update(fetched.html, "utf8").digest("hex"),
      });
    }

    const merged: MergedPublicWebsiteSignals = mergePublicWebsiteSignals({
      homepageUrl: homepage.finalUrl,
      perPage,
    });
    // Build a signals object compatible with the single-page `evidenceLevel`
    // projection by projecting merged terms to the simpler shape.
    const signals: PublicWebsiteSignals = {
      pageUrl: homepage.finalUrl,
      pageTitle: homepageSignals.pageTitle,
      productSignals: merged.productSignals.map((p) => p.term),
      roleSignals: merged.roleSignals.map((r) => r.term),
      contactSignals: merged.contactSignals.map((c) => c.term),
      observedPublicEmails: merged.observedPublicEmails.map((e) => e.email),
      observedPublicPhones: merged.observedPublicPhones.map((p) => p.e164),
      observedThaiLegalNameSnapshot: merged.observedThaiLegalNameSnapshot,
      observedEnglishLegalNameSnapshot: merged.observedEnglishLegalNameSnapshot,
      observedJuristicNumberSnapshot: merged.observedJuristicNumberSnapshot,
      identityComparison: merged.identityMatchLevel
        ? { matchLevel: merged.identityMatchLevel, reasons: [], matchedFields: [] }
        : null,
      rawTextLengthChars: homepageSignals.rawTextLengthChars,
    };
    const projection = evidenceLevel(signals);
    const now = input.now();
    // TH07 DEFECT 05B — the T10 checkpoint reader
    // (`readProviderResultCheckpoint` in checkpoints.ts) requires
    // `providerResult.datasetVersion` to be a NON-NULL string, else
    // `assertProviderResultCheckpoint` throws
    // `INVALID_PROVIDER_RESULT_CHECKPOINT` from
    // `finishAttemptWithCheckpoint`. That throw escaped past the
    // per-provider try/catch and became `WORKER_INTERNAL_ERROR` on
    // every successful public-website fetch.
    //
    // TH07 DEFECT 05B HARDENING — the dataset version must be
    // CONTENT-sensitive. The pre-hardening draft hashed only
    // `(category, pageUrl, rawTextLengthChars)`; two different
    // snapshots of the same URL with the same text length collided.
    //
    // Hardened canonicalization:
    //   - sort pages by their fixed category ordering (homepage,
    //     contact, product) so the order of discovery doesn't affect
    //     the version,
    //   - for each page, hash `category | canonicalPageUrl |
    //     perPageContentSha256` separated by NUL bytes,
    //   - record-separate each page with 0x01.
    //
    // Whitespace / canonicalization behavior (DOCUMENTED &
    // TESTED): per-page content hashes are SHA-256 of the fetched
    // body bytes verbatim, UTF-8-encoded. Any byte-level change in
    // the fetched HTML — including whitespace — produces a
    // different dataset version. We do NOT normalize whitespace
    // before hashing because the provider's contract is "the
    // snapshot we observed", not "a canonicalized text summary";
    // normalization would hide real supplier template churn.
    //
    // Raw HTML is NEVER included in the datasetVersion string
    // itself; only its 64-char hex digest is. No cookies, tokens,
    // bodies, or PII appear anywhere in diagnostics.
    const CATEGORY_ORDER: Record<"homepage" | "contact" | "product", number> = {
      homepage: 0,
      contact: 1,
      product: 2,
    };
    const sortedPages = [...perPage].sort(
      (a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category],
    );
    const contentDigest = createHash("sha256");
    for (const page of sortedPages) {
      contentDigest.update(page.category, "utf8");
      contentDigest.update("\u0000", "utf8");
      contentDigest.update(page.signals.pageUrl, "utf8");
      contentDigest.update("\u0000", "utf8");
      contentDigest.update(page.contentSha256, "utf8");
      contentDigest.update("\u0001", "utf8");
    }
    const websiteDatasetVersion = `sha256:${contentDigest.digest("hex")}`;

    // TH07 DEFECT 05C — persist a `buyer_trade_source_snapshots` row for
    // the public-website evaluation. The repository's `finalize`
    // (via `validateProviderResultSnapshots`) requires that EVERY
    // evaluated provider_result's `datasetVersion` corresponds to an
    // existing snapshot row keyed by `(provider_id, dataset_id,
    // material_hash)`. The pre-05C website executor returned a
    // checkpointable provider_result WITHOUT ingesting the matching
    // snapshot, so `finalize` threw `EVALUATED_PROVIDER_SNAPSHOT_REQUIRED`
    // on every drain tick → outer catch → `recoverClaimedJob` released
    // the lease → next_attempt_at advanced → infinite reclaim.
    //
    // `expires_at = now` keeps the row immediately-expired so the
    // existing freshness filter (`getFreshSnapshotByProvider` on
    // `.gte("expires_at", now)`) never promotes website evidence to
    // a cached-replay path. The executor's `hasFreshSnapshot` remains
    // hard-coded `false`.
    //
    // No raw HTML, cookies, PII, tokens, or page bodies are ever
    // written to the snapshot. `coverage` and `safe_metadata` contain
    // only safe counts.
    const snapshotRetrievedAt = now.toISOString();
    const perPageCategories = perPage.map((p) => p.category);
    try {
      await input.writer.saveSnapshot({
        provider_id: PUBLIC_WEBSITE_DESCRIPTOR.id,
        dataset_id: "public-website-homepage",
        published_period: now.toISOString().slice(0, 7),
        source_url: homepage.finalUrl,
        material_hash: websiteDatasetVersion,
        fetched_at: snapshotRetrievedAt,
        retrieved_at: snapshotRetrievedAt,
        expires_at: snapshotRetrievedAt,
        row_count: perPage.length,
        coverage: {
          fields: ["page_url", "page_title", "product_signals", "role_signals", "observed_public_emails", "observed_public_phones"],
          semantics: "company_site_public_content_only",
          attribution: PUBLIC_WEBSITE_ATTRIBUTION,
          shipmentLevel: false,
          sourceGrain: "company_site",
          pagesInspected: perPage.length,
          perPageCategories,
        },
        parse_version: PUBLIC_WEBSITE_PARSER_VERSION,
        terms_version: PUBLIC_WEBSITE_DESCRIPTOR.termsVersion,
        status: "ready",
        safe_metadata: {
          pagesInspected: perPage.length,
          perPageCategories,
        },
        normalized_rows: [],
      });
    } catch (snapshotError) {
      // Classify snapshot-persistence failures as retryable provider
      // failures rather than letting an opaque DB error escape as
      // WORKER_INTERNAL_ERROR. The lease recovery path in the drain
      // will requeue; the fix is in the executor so the retry will
      // write the snapshot the next time around.
      void snapshotError;
      return {
        status: "failed_retryable",
        safeErrorCode: "WEBSITE_SNAPSHOT_PERSIST_FAILED",
        retryable: true,
      };
    }

    const anyEvidenceObserved =
      signals.productSignals.length > 0
      || signals.observedPublicEmails.length > 0
      || signals.observedPublicPhones.length > 0
      || (signals.identityComparison?.matchLevel === "exact" || signals.identityComparison?.matchLevel === "strong");
    const status: Extract<TradeResearchProviderExecutionState, "completed" | "no_match"> =
      anyEvidenceObserved ? "completed" : "no_match";

    const source: TradeResearchSourceEvidence = {
      providerId: "public-website" as never,
      source: "Candidate Public Website",
      outcome: status === "no_match" ? "no_match" : "completed",
      datasetPeriod: now.toISOString().slice(0, 7),
      retrievedAt: now.toISOString(),
      matchedSourceName: signals.pageTitle ?? undefined,
      candidateName: candidate.companyName ?? undefined,
      identityDecision: signals.identityComparison?.matchLevel === "exact"
        ? "exact"
        : signals.identityComparison?.matchLevel === "strong"
        ? "strong"
        : signals.identityComparison?.matchLevel === "possible"
        ? "ambiguous"
        : "none",
      matchReason: projection.observationExplanation,
      coverageExplanation: projection.coverageExplanation,
      companyEvidence: projection.companyState,
      productEvidence: projection.productState,
      originEvidence: "not_available",
      shipmentEvidence: "not_verified",
      attribution: PUBLIC_WEBSITE_ATTRIBUTION,
    };

    const providerResult: TradeResearchProviderResult = {
      providerId: PUBLIC_WEBSITE_DESCRIPTOR.id,
      datasetId: "public-website-homepage",
      datasetVersion: websiteDatasetVersion,
      parserVersion: PUBLIC_WEBSITE_PARSER_VERSION,
      sourceRecordIds: [`website:${host}`],
      sourcePeriod: now.toISOString().slice(0, 7),
      retrievedAt: now.toISOString(),
      execution: { status, safeErrorCode: null },
      evidence: {
        matchDecision: signals.identityComparison?.matchLevel === "exact"
          ? "exact"
          : signals.identityComparison?.matchLevel === "strong"
          ? "strong"
          : signals.identityComparison?.matchLevel === "possible"
          ? "ambiguous"
          : "none",
        companyEvidence: { state: projection.companyState, explanation: projection.companyExplanation },
        productEvidence: { state: projection.productState, explanation: projection.productExplanation },
        originEvidence: { state: "not_available", explanation: "Public website is not an origin source." },
        indiaOriginEvidence: { state: "not_verified", explanation: "Public website never establishes India origin." },
        shipmentEvidence: { state: "not_verified", explanation: "Public website never establishes shipment activity." },
        programEvidence: { state: "not_available", explanation: "Public website is not a program-participant list." },
        coverage: { state: projection.coverageState, explanation: projection.coverageExplanation },
        limitations: [
          "Public-website evidence is COMPANY_SITE grain. Never regulatory, trade, shipment, India-origin, or buyer-intent evidence.",
          "Thai-language coverage may be incomplete; a product-keyword miss is NOT a company-level negative.",
        ],
        attribution: PUBLIC_WEBSITE_ATTRIBUTION,
        mappingScope: {
          marketCountryCode: input.context.marketCountryCode,
          productId: input.context.productId,
          productForm: input.context.productForm,
          sourceProductCodes: [],
          companyGrain: "company_record",
          productGrain: "company_product",
          originGrain: "not_available",
          shipmentGrain: "not_available",
          programGrain: "not_available",
        },
        interpretationVersion: PUBLIC_WEBSITE_INTERPRETATION_VERSION,
        conflicts: [],
      },
    };

    return {
      status,
      providerResult,
      sourceEvidence: source,
      recordCount: signals.rawTextLengthChars,
      matchCount: signals.productSignals.length,
    };
  },
};

const EXECUTORS_BY_DESCRIPTOR = new Map<string, TradeResearchProviderExecutor>([
  [FDA_FSVP_EXECUTOR.providerId, FDA_FSVP_EXECUTOR],
  [FDA_VQIP_EXECUTOR.providerId, FDA_VQIP_EXECUTOR],
  [CANADA_CID_EXECUTOR.providerId, CANADA_CID_EXECUTOR],
  [THAI_CUSTOMS_STATS_EXECUTOR.providerId, THAI_CUSTOMS_STATS_EXECUTOR],
  [PUBLIC_WEBSITE_EXECUTOR.providerId, PUBLIC_WEBSITE_EXECUTOR],
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
