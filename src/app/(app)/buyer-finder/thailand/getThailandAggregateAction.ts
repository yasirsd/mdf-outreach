"use server";

/**
 * TH06 FINAL — Server-side aggregate assembly for a Thailand
 * candidate. Called by the client `ThailandResearchSection` after
 * verifying the candidate's market is TH.
 *
 * This action is the SINGLE authoritative aggregate assembly path:
 *
 *   1. Requires authenticated session; derives workspace from it.
 *   2. Loads the candidate; refuses cross-workspace.
 *   3. Loads the latest Thailand research job (context-scoped) and
 *      extracts the certified `thai-customs-stats` + `public-website`
 *      provider results from `result.providerResults`.
 *   4. Loads active Thailand manual evidence (chain-leaf resolver
 *      runs defense-in-depth on the writer's workspace-scoped read).
 *   5. Builds `candidateIdentity` from the candidate record (name,
 *      domain, address) — never a client-supplied boolean.
 *   6. Calls `aggregateThailandResearch(...)` and returns the result.
 *
 * The browser NEVER synthesizes authoritative aggregate evidence.
 */

import { cookies } from "next/headers";
import { requireMdfSession } from "@/lib/auth/require";
import { createClient } from "@/utils/supabase/server";
import { createTradeResearchReadRepository, TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { type TradeResearchProviderResult } from "@/lib/tradeResearch/types";
import {
  THAILAND_PROVIDER_PLAN_VERSION,
  aggregateThailandResearch,
  findThailandHsMapping,
  resolveActiveThailandManualEvidence,
  type ThailandAggregateInput,
  type ThailandAggregateResult,
  type ThailandCandidateIdentityInput,
} from "@/lib/tradeResearch/thailand";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GetThailandAggregateResult {
  readonly isThailandMarket: boolean;
  readonly aggregate?: ThailandAggregateResult;
  readonly productSupported?: boolean;
  readonly unsupportedProductMessage?: string;
}

function toTopLevel(status: string): "completed" | "no_match" | "cached" | "failed_retryable" | "failed_terminal" | "unsupported" | "not_evaluated" {
  if (status === "completed" || status === "no_match" || status === "cached") return status;
  if (status === "failed_retryable" || status === "failed_terminal" || status === "unsupported") return status;
  return "not_evaluated";
}

function readStats(result: TradeResearchProviderResult | undefined): ThailandAggregateInput["thaiCustomsStats"] {
  if (!result) return undefined;
  if (result.providerId !== "thai-customs-stats") return undefined;
  const evidence = "evidence" in result ? result.evidence : undefined;
  const productVerified = evidence?.productEvidence?.state === "supporting" || evidence?.productEvidence?.state === "verified";
  const originSupporting = evidence?.indiaOriginEvidence?.state === "supporting" || evidence?.indiaOriginEvidence?.state === "verified";
  const anyRowObserved = productVerified; // product evidence is "supporting" when HS rows exist
  return {
    status: toTopLevel(result.execution?.status ?? "not_evaluated"),
    datasetVersion: result.datasetVersion ?? null,
    sourcePeriod: result.sourcePeriod ?? null,
    retrievedAt: result.retrievedAt ?? null,
    marketImportActivity: anyRowObserved ? "observed" : (result.execution?.status === "no_match" ? "not_observed" : "unknown"),
    indiaOriginMarketActivity: originSupporting ? "observed" : (result.execution?.status === "no_match" ? "not_observed" : "unknown"),
    productRelevance: anyRowObserved ? "observed" : (result.execution?.status === "no_match" ? "not_observed" : "unknown"),
    observation: evidence?.coverage?.explanation,
    sourceUrl: "https://catalog.customs.go.th/dataset/ctm_06_11",
  };
}

function readWebsite(result: TradeResearchProviderResult | undefined): ThailandAggregateInput["publicWebsite"] {
  if (!result) return undefined;
  if (result.providerId !== "public-website") return undefined;
  const evidence = "evidence" in result ? result.evidence : undefined;
  const productObserved = evidence?.productEvidence?.state === "supporting" || evidence?.productEvidence?.state === "verified";
  const matchDecision = evidence?.matchDecision;
  const matchLevel = matchDecision === "exact" || matchDecision === "strong"
    ? matchDecision
    : matchDecision === "ambiguous"
    ? "possible"
    : null;
  return {
    status: toTopLevel(result.execution?.status ?? "not_evaluated"),
    datasetVersion: result.datasetVersion ?? null,
    sourcePeriod: result.sourcePeriod ?? null,
    retrievedAt: result.retrievedAt ?? null,
    productSignalsObserved: productObserved,
    identityMatchLevel: matchLevel,
    observedPublicEmails: [], // provider-level emails are not persisted into the typed result; the aggregate reads from the UI's own contact extraction path. Keep empty here to avoid fabrication.
    observedPublicPhones: [],
    parserVersion: result.parserVersion ?? "public-website-html-v2",
    interpretationVersion: evidence?.interpretationVersion ?? "public-website-html-v2:t08-v1",
    observation: evidence?.coverage?.explanation,
    sourceUrl: undefined,
  };
}

function buildCandidateIdentity(candidate: { companyName?: string | null; address?: string | null; domain?: string | null; website?: string | null }): ThailandCandidateIdentityInput {
  return {
    thaiLegalName: candidate.companyName && /[฀-๿]/.test(candidate.companyName) ? candidate.companyName : null,
    englishLegalName: candidate.companyName && !/[฀-๿]/.test(candidate.companyName) ? candidate.companyName : null,
    domain: candidate.domain ?? candidate.website ?? null,
    address: candidate.address ?? null,
  };
}

export async function getThailandAggregateForCandidateAction(candidateId: string): Promise<GetThailandAggregateResult> {
  const session = await requireMdfSession();
  if (!UUID.test(candidateId)) return { isThailandMarket: false };
  const supabase = createClient(cookies());
  const { data: candidate, error: candidateError } = await supabase
    .from("buyer_candidates")
    .select("id, company_name, country, address, domain, website")
    .eq("workspace_id", session.membership.workspaceId)
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError || !candidate) return { isThailandMarket: false };
  // Only expose Thailand UI for Thailand candidates.
  const marketCode = typeof candidate.country === "string"
    ? (candidate.country.toUpperCase() === "THAILAND" || candidate.country.toUpperCase() === "TH" ? "TH" : null)
    : null;
  if (marketCode !== "TH") return { isThailandMarket: false };

  // TH06 FINAL — authoritative context: load the candidate's
  // LATEST persisted trade-research job and read its stored
  // ResearchContext directly. The UI must never drift from the
  // job that actually ran. The stored context is authoritative
  // because `writer.finalize` (T07) and `canonicalizeResearchContext`
  // (TH02 hardening) are the single sources of truth for context
  // identity. We then VERIFY the job's context fields match the TH
  // automated contract (marketCountryCode=TH + supported HS
  // mapping + Thailand provider plan version).
  const read = createTradeResearchReadRepository(supabase, session.membership.workspaceId);
  const latest = await read.getLatestJobForCandidate(candidateId);
  const storedContext = latest?.context ?? latest?.result?.context ?? null;

  const storedMarket = storedContext?.marketCountryCode?.toUpperCase() ?? null;
  const storedPlannerVersion = storedContext?.providerPlanVersion ?? null;
  const storedProductId = storedContext?.productId ?? null;
  const storedProductForm = storedContext?.productForm ?? null;
  const mapping = storedProductId
    ? findThailandHsMapping(storedProductId, storedProductForm ?? null)
    : undefined;

  const jobMatchesThailandContract =
    storedMarket === "TH"
    && storedPlannerVersion === THAILAND_PROVIDER_PLAN_VERSION
    && mapping !== undefined
    && mapping.thaiQueryCodes.length > 0;

  const providerResults: readonly TradeResearchProviderResult[] = jobMatchesThailandContract && latest?.result?.providerResults
    ? latest.result.providerResults
    : [];
  const stats = jobMatchesThailandContract
    ? readStats(providerResults.find((r) => r.providerId === "thai-customs-stats"))
    : undefined;
  const website = jobMatchesThailandContract
    ? readWebsite(providerResults.find((r) => r.providerId === "public-website"))
    : undefined;

  // Manual evidence (service-role writer; chain-leaf resolver gates
  // the active-row projection).
  const writer = new TradeResearchWriter(getTradeResearchServiceRoleClient());
  const rows = await writer.listThaiManualEvidenceForCandidate(session.membership.workspaceId, candidateId);
  const manual = resolveActiveThailandManualEvidence({
    workspaceId: session.membership.workspaceId,
    candidateId,
    rows: rows as never,
  });

  const candidateIdentity = buildCandidateIdentity({
    companyName: candidate.company_name,
    address: candidate.address,
    domain: candidate.domain,
    website: candidate.website,
  });

  const aggregate = aggregateThailandResearch({
    thaiCustomsStats: stats,
    publicWebsite: website,
    manual,
    candidateIdentity,
  });

  // TH06 FINAL — productSupported reflects whether the persisted
  // Thailand job (if any) exists AND matches the automated contract.
  // When no supported TH job has run, the UI copy makes this clear
  // instead of silently reading an unrelated job.
  const productSupported = jobMatchesThailandContract;

  return {
    isThailandMarket: true,
    aggregate,
    productSupported,
    unsupportedProductMessage: productSupported
      ? undefined
      : "Thailand trade research is not available for this product/form.",
  };
}
