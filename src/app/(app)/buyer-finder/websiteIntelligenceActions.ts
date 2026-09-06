"use server";

/**
 * BI3 — manual "Research company website · Free" server action.
 *
 * Browser supplies only the candidate id + action intent. The workspace,
 * website, and every extracted evidence value come from server-side
 * data. All writes go through the existing BI2 narrow write RPCs
 * (`ingestSource`, `ingestClaim`, `refreshDerived`). No direct table
 * DML. No trade observations. No paid provider or LinkedIn.
 *
 * Concurrency: a per-process lock keyed by candidate id prevents two
 * simultaneous research runs from spending duplicate bandwidth on the
 * same candidate. The BI2 SQL RPCs remain the durable idempotency
 * floor via advisory locks and identity dedupe.
 */

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { serverRepositories } from "@/lib/repositories/server";
import {
  BI3_PROVIDER_ID,
  planWebsiteResearch,
  type WebsitePageResult,
  type WebsiteResearchStatus,
} from "@/lib/buyerIntelligence/websiteResearch";
import { EVIDENCE_TYPE_BY_LEVEL } from "@/lib/buyerIntelligence/types";
import type {
  ClaimIngestionInput,
  IntelligenceIngestionResult,
  SourceIngestionInput,
} from "@/lib/buyerIntelligence/ingestion";

export type WebsiteResearchOutcome =
  | WebsiteResearchStatus
  | "already_running"
  | "invalid_input"
  | "conflict";

export interface WebsiteResearchPageSummary {
  requestedUrl: string;
  finalUrl?: string;
  kind: WebsitePageResult["kind"];
  outcome: WebsitePageResult["outcome"];
  claimsPersisted: number;
  claimsExisting: number;
  claimsConflicting: number;
}

export interface WebsiteResearchSummary {
  outcome: WebsiteResearchOutcome;
  message?: string;
  pagesFetched: number;
  claimsCreated: number;
  claimsExisting: number;
  claimsConflicting: number;
  sourcesCreated: number;
  sourcesExisting: number;
  pages: WebsiteResearchPageSummary[];
}

const inFlight = new Set<string>();

function empty(outcome: WebsiteResearchOutcome, message?: string): WebsiteResearchSummary {
  return {
    outcome,
    message,
    pagesFetched: 0,
    claimsCreated: 0,
    claimsExisting: 0,
    claimsConflicting: 0,
    sourcesCreated: 0,
    sourcesExisting: 0,
    pages: [],
  };
}

function messageFor(outcome: WebsiteResearchOutcome): string | undefined {
  switch (outcome) {
    case "researched":
      return "Website research complete.";
    case "no_evidence":
      return "No qualifying business evidence found.";
    case "partial":
      return "Some pages could not be checked. Recorded what was found.";
    case "unreachable":
      return "Website unavailable.";
    case "invalid_website":
      return "This candidate needs a company website or domain.";
    case "blocked":
      return "Website blocked automated access.";
    case "timeout":
      return "Website research timed out.";
    case "unsupported_content":
      return "Website returned unsupported content.";
    case "conflict":
      return "Website content conflicts with previously recorded evidence.";
    case "temporarily_unavailable":
      return "Website temporarily unavailable.";
    case "already_running":
      return "Website research already running.";
    case "invalid_input":
      return "Invalid candidate id.";
    default:
      return undefined;
  }
}

/**
 * BI3 manual website research for one Candidate.
 * Zero Buyer/campaign side effects. Never sends mail. Never reveals
 * personal contacts. Never creates trade observations.
 */
export async function researchCandidateWebsiteAction(
  candidateId: string,
): Promise<WebsiteResearchSummary> {
  await requireMdfSession();
  const id = (candidateId ?? "").trim();
  if (!isEntityUuid(id)) return empty("invalid_input", messageFor("invalid_input"));

  const { repos } = await serverRepositories();
  const candidate = await repos.buyerCandidates.get(id);
  if (!candidate) return empty("invalid_input", "Candidate not found.");
  if (candidate.discoveryStatus === "archived") {
    return empty("invalid_input", "Archived candidates cannot be researched.");
  }
  if (candidate.reviewStatus === "rejected") {
    return empty("invalid_input", "Rejected candidates cannot be researched.");
  }

  if (inFlight.has(id)) return empty("already_running", messageFor("already_running"));
  inFlight.add(id);
  try {
    const plan = await planWebsiteResearch({ candidate });

    let sourcesCreated = 0;
    let sourcesExisting = 0;
    let claimsCreated = 0;
    let claimsExisting = 0;
    let claimsConflicting = 0;
    const now = new Date().toISOString();

    const pages: WebsiteResearchPageSummary[] = [];

    for (const page of plan.pages) {
      let claimsPersisted = 0;
      let claimsExistingPage = 0;
      let claimsConflictingPage = 0;

      // Only pages with at least one claim produce a source. A fetched
      // page with no qualifying evidence is left out of the BI1 sources
      // list to keep provenance meaningful.
      if (page.outcome === "ok" && page.claims.length > 0 && page.finalUrl) {
        const sourceInput: SourceIngestionInput = {
          candidateId: id,
          providerId: BI3_PROVIDER_ID,
          sourceType: "company_web_page",
          sourceKey: `${page.kind}:${page.finalUrl}`,
          safeSourceRef: `${labelForKind(page.kind)} · ${safeHost(page.finalUrl)}`,
          sourceUrl: page.finalUrl,
          accessClass: "public",
          costClass: "free",
          retrievedAt: now,
          metadata: safeMetadata(page),
        };
        const sourceResult = await repos.buyerIntelligenceWriter.ingestSource(sourceInput);
        if (sourceResult.outcome === "created") sourcesCreated += 1;
        if (sourceResult.outcome === "existing") sourcesExisting += 1;

        for (const claim of page.claims) {
          const claimInput: ClaimIngestionInput = {
            candidateId: id,
            sourceId: sourceResult.id,
            sourceRecordRef: claim.sourceRecordRef,
            claimType: claim.claimType,
            evidenceType: EVIDENCE_TYPE_BY_LEVEL[2],
            evidenceLevel: 2,
            confidence: claim.confidence === "medium" ? "medium" : "low",
            rawValue: { excerpt: claim.excerpt, sourceUrl: page.finalUrl, pageKind: page.kind },
            normalizedValue: claim.normalized,
            retrievedAt: now,
            normalizationVersion: "bi3-website-v1",
          };
          const claimResult: IntelligenceIngestionResult = await repos.buyerIntelligenceWriter.ingestClaim(
            claimInput,
          );
          if (claimResult.outcome === "created") {
            claimsCreated += 1;
            claimsPersisted += 1;
          } else if (claimResult.outcome === "existing") {
            claimsExisting += 1;
            claimsExistingPage += 1;
          } else {
            claimsConflicting += 1;
            claimsConflictingPage += 1;
          }
        }
      }

      pages.push({
        requestedUrl: page.requestedUrl,
        finalUrl: page.finalUrl,
        kind: page.kind,
        outcome: page.outcome,
        claimsPersisted,
        claimsExisting: claimsExistingPage,
        claimsConflicting: claimsConflictingPage,
      });
    }

    // The BI2 claim RPC already triggers refreshDerived on each
    // successful insert, but call it once more explicitly so an all-
    // existing / all-conflict run still leaves derived state coherent.
    if (sourcesCreated + sourcesExisting > 0) {
      await repos.buyerIntelligenceWriter.refreshDerived(id).catch(() => undefined);
    }

    let outcome: WebsiteResearchOutcome =
      claimsConflicting > 0 && claimsCreated === 0 && claimsExisting === 0
        ? "conflict"
        : plan.status;
    if (outcome === "researched" && claimsCreated === 0 && claimsExisting === 0) {
      outcome = "no_evidence";
    }

    revalidatePath("/buyer-finder");
    revalidatePath(`/buyer-finder/candidate/${id}`);

    return {
      outcome,
      message: messageFor(outcome),
      pagesFetched: plan.pagesFetched,
      claimsCreated,
      claimsExisting,
      claimsConflicting,
      sourcesCreated,
      sourcesExisting,
      pages,
    };
  } catch {
    return empty("temporarily_unavailable", messageFor("temporarily_unavailable"));
  } finally {
    inFlight.delete(id);
  }
}

function labelForKind(kind: WebsitePageResult["kind"]): string {
  switch (kind) {
    case "homepage": return "Homepage";
    case "about": return "About";
    case "company": return "Company";
    case "products": return "Products";
    case "services": return "Services";
    case "contact": return "Contact";
    default: return "Page";
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function safeMetadata(page: WebsitePageResult): Record<string, unknown> {
  const meta: Record<string, unknown> = { pageKind: page.kind };
  if (typeof page.httpStatus === "number") meta.httpStatus = page.httpStatus;
  if (typeof page.bytesRead === "number") meta.bytesRead = page.bytesRead;
  return meta;
}
