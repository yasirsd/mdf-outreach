"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import { discoverAndIngestCandidates } from "@/lib/buyerFinder/ingestion";
import {
  createHunterCompanyDiscoveryProvider,
} from "@/lib/buyerFinder/providers/hunter/companyDiscovery";
import {
  createHunterUsageProvider,
} from "@/lib/buyerFinder/providers/hunter/usage";
import { HunterDiscoveryError } from "@/lib/buyerFinder/providers/hunter/errors";
import type { ProviderUsage } from "@/lib/buyerFinder/usage";
import {
  isBuyerFinderHunterConfigured,
  isBuyerFinderHunterEnabled,
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
  HUNTER_DISCOVERY_DISABLED_MESSAGE,
  HUNTER_NOT_CONFIGURED_MESSAGE,
} from "@/lib/buyerFinder/config";
import { isActiveBusinessProductId } from "@/lib/buyerFinder/businessCatalogue";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidateRecord,
  BuyerTypeOption,
  ContactPriorityId,
} from "@/lib/buyerFinder/types";
import { findCountryByName } from "@/lib/catalogue/countries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * BF2.1 — production candidate ids are DB UUIDs. Previously we accepted
 * the mock-era `[A-Za-z0-9_-]{1,80}` shape; that is now rejected before
 * PostgREST so a malformed browser input fails safely.
 */
const CANDIDATE_ID_RE = UUID_RE;
const QUEUE_LIMIT = 100;

/* ---------------------------------------------------------------------- */
/*  Search + ingest                                                       */
/* ---------------------------------------------------------------------- */

export interface SearchBuyerCandidatesInput {
  /** Canonical country name from the F5 catalogue (e.g. "United Arab Emirates"). */
  country: string;
  /** Business product id from src/lib/catalogue/products.ts (e.g. "guntur-dry-red-chilli"). */
  productId: string;
  buyerTypes?: BuyerTypeOption[];
  industry?: string;
  contactPriorities?: ContactPriorityId[];
}

export type SearchOutcomeCode =
  | "ok"
  | "not_configured"
  | "disabled"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "invalid_request"
  | "invalid_response"
  | "invalid_input";

export interface SafeIngestionSummary {
  outcome: SearchOutcomeCode;
  /**
   * Human-readable message safe to display in the UI. Never contains
   * an API key, a raw provider payload, or a Supabase error message.
   */
  message?: string;
  discovered: number;
  created: number;
  enrichedExisting: number;
  skippedExactDuplicates: number;
  possibleDuplicateCount: number;
  productMatchesAdded: number;
  contactsAdded: number;
  failures: Array<{
    stage: "discovery" | "validation" | "contacts" | "persist";
    companyName?: string;
    message: string;
  }>;
}

function zeroSummary(outcome: SearchOutcomeCode, message?: string): SafeIngestionSummary {
  return {
    outcome,
    message,
    discovered: 0,
    created: 0,
    enrichedExisting: 0,
    skippedExactDuplicates: 0,
    possibleDuplicateCount: 0,
    productMatchesAdded: 0,
    contactsAdded: 0,
    failures: [],
  };
}

/**
 * BF2 — the single production entry point that turns operator input into
 * persisted candidates via Hunter Discover.
 *
 * Safety guarantees enforced here:
 *   1. Requires MDF session. The Supabase client uses that session's
 *      workspace membership (RLS-scoped) — the browser NEVER supplies a
 *      workspaceId, Hunter key, provider identifier, or candidate score.
 *   2. `productId` is validated against the business catalogue
 *      (src/lib/catalogue/products.ts). Only ACTIVE business products
 *      are accepted. BF2.1 — the provider layer and persistence both
 *      speak business ids; there is NO email-theme bridge here.
 *   3. Country is validated against the F5 canonical catalogue.
 *   4. Hunter is invoked ONLY as the company discovery provider. No
 *      contact provider is passed — real Hunter candidates are persisted
 *      with contacts=[] and the UI surfaces an intentional
 *      "contact enrichment not run yet" state.
 *   5. Every HunterDiscoveryError is translated to a UI-safe outcome
 *      code + message. Raw provider payloads / API keys never reach the
 *      caller.
 */
export async function searchAndIngestBuyerCandidatesAction(
  input: SearchBuyerCandidatesInput,
): Promise<SafeIngestionSummary> {
  await requireMdfSession();

  const country = (input.country ?? "").trim();
  const productId = (input.productId ?? "").trim();

  if (!country || !findCountryByName(country)) {
    return zeroSummary("invalid_input", "Select a valid country from the list.");
  }
  if (!productId || !isActiveBusinessProductId(productId)) {
    return zeroSummary("invalid_input", "Select an active MDF product.");
  }
  if (!isBuyerFinderHunterEnabled()) {
    return zeroSummary("disabled", HUNTER_DISCOVERY_DISABLED_MESSAGE);
  }
  if (!isBuyerFinderHunterReady()) {
    return zeroSummary("not_configured", HUNTER_NOT_CONFIGURED_MESSAGE);
  }

  const { repos } = await serverRepositories();
  const companyProvider = createHunterCompanyDiscoveryProvider({
    apiKey: requireBuyerFinderHunterApiKey(),
  });

  try {
    const result = await discoverAndIngestCandidates({
      query: {
        country,
        productId,
        buyerTypes: input.buyerTypes,
        industry: input.industry,
        contactPriorities: input.contactPriorities,
      },
      companyProvider,
      // Intentionally NO contactProvider — see class doc + brief. Real
      // Hunter candidates are persisted with contacts=[].
      repositories: {
        candidates: repos.buyerCandidates,
        contacts: repos.buyerCandidateContacts,
        productMatches: repos.buyerCandidateProductMatches,
      },
    });

    revalidatePath("/buyer-finder");
    return {
      outcome: "ok",
      discovered: result.discovered,
      created: result.created,
      enrichedExisting: result.enrichedExisting,
      skippedExactDuplicates: result.skippedExactDuplicates,
      possibleDuplicateCount: result.possibleDuplicates.length,
      productMatchesAdded: result.productMatchesAdded,
      contactsAdded: result.contactsAdded,
      failures: result.failures.map((f) => ({
        stage: f.stage,
        companyName: f.companyName,
        // ingestion errors are already redacted; still bounded length.
        message: safeMessage(f.message),
      })),
    };
  } catch (err) {
    return zeroSummary(...translateHunterError(err));
  }
}

/* ---------------------------------------------------------------------- */
/*  Queue + detail                                                        */
/* ---------------------------------------------------------------------- */

export interface QueueRow {
  candidate: BuyerCandidate;
  contactCount: number;
  productMatches: BuyerCandidateProductMatch[];
}

export interface QueueSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  archived: number;
}

/**
 * Loads a bounded list of candidates + contact counts + product matches
 * for the review queue. RLS scopes to the caller's workspace.
 */
export async function loadBuyerCandidateQueueAction(): Promise<{
  rows: QueueRow[];
  summary: QueueSummary;
  limit: number;
}> {
  await requireMdfSession();
  const { repos } = await serverRepositories();
  const all = await repos.buyerCandidates.list();
  const bounded = all.slice(0, QUEUE_LIMIT);
  const rows: QueueRow[] = [];
  for (const candidate of bounded) {
    const [contacts, matches] = await Promise.all([
      repos.buyerCandidateContacts.listByCandidate(candidate.id),
      repos.buyerCandidateProductMatches.listByCandidate(candidate.id),
    ]);
    rows.push({ candidate, contactCount: contacts.length, productMatches: matches });
  }
  const summary: QueueSummary = {
    total: all.length,
    pending: all.filter((c) => c.reviewStatus === "pending").length,
    approved: all.filter((c) => c.reviewStatus === "approved").length,
    rejected: all.filter((c) => c.reviewStatus === "rejected").length,
    archived: all.filter((c) => c.discoveryStatus === "archived").length,
  };
  return { rows, summary, limit: QUEUE_LIMIT };
}

/**
 * Loads one candidate + its contacts + product matches. RLS scopes.
 */
export async function loadBuyerCandidateAction(
  id: string,
): Promise<BuyerCandidateRecord | null> {
  await requireMdfSession();
  if (!CANDIDATE_ID_RE.test(id)) return null;
  const { repos } = await serverRepositories();
  const candidate = await repos.buyerCandidates.get(id);
  if (!candidate) return null;
  const [contacts, productMatches] = await Promise.all([
    repos.buyerCandidateContacts.listByCandidate(id),
    repos.buyerCandidateProductMatches.listByCandidate(id),
  ]);
  return { candidate, contacts, productMatches };
}

/* ---------------------------------------------------------------------- */
/*  Lifecycle actions                                                     */
/* ---------------------------------------------------------------------- */

async function assertCandidate(
  candidateId: string,
): Promise<{ repos: Awaited<ReturnType<typeof serverRepositories>>["repos"]; candidate: BuyerCandidate }> {
  await requireMdfSession();
  if (!CANDIDATE_ID_RE.test(candidateId)) throw new Error("Invalid candidate id.");
  const { repos } = await serverRepositories();
  const candidate = await repos.buyerCandidates.get(candidateId);
  if (!candidate) throw new Error("Candidate not found.");
  return { repos, candidate };
}

/**
 * Sets review_status = 'approved'. Does NOT create a Buyer, campaign,
 * recipient, or send. Approval is a queue-state change only.
 */
export async function approveCandidateAction(candidateId: string): Promise<void> {
  const { repos, candidate } = await assertCandidate(candidateId);
  await repos.buyerCandidates.update(candidate.id, { reviewStatus: "approved" });
  revalidatePath("/buyer-finder");
  revalidatePath(`/buyer-finder/candidate/${candidate.id}`);
}

/**
 * Sets review_status = 'rejected' with an optional short reason.
 */
export async function rejectCandidateAction(
  candidateId: string,
  reason?: string,
): Promise<void> {
  const { repos, candidate } = await assertCandidate(candidateId);
  const bounded = (reason ?? "").trim().slice(0, 500) || undefined;
  await repos.buyerCandidates.update(candidate.id, {
    reviewStatus: "rejected",
    rejectionReason: bounded,
  });
  revalidatePath("/buyer-finder");
  revalidatePath(`/buyer-finder/candidate/${candidate.id}`);
}

/**
 * Sets discovery_status = 'archived'. Independent of review_status.
 */
export async function archiveCandidateAction(candidateId: string): Promise<void> {
  const { repos, candidate } = await assertCandidate(candidateId);
  await repos.buyerCandidates.update(candidate.id, { discoveryStatus: "archived" });
  revalidatePath("/buyer-finder");
  revalidatePath(`/buyer-finder/candidate/${candidate.id}`);
}

/* ---------------------------------------------------------------------- */
/*  Hunter usage                                                          */
/* ---------------------------------------------------------------------- */

export type HunterUsageOutcome = "ok" | "not_configured" | "unavailable" | "disabled";

export interface HunterUsageResult {
  outcome: HunterUsageOutcome;
  usage: ProviderUsage | null;
  message?: string;
}

/**
 * Server-only Hunter usage fetch. Called from the UI as a plain server
 * action. Never returns the API key.
 *
 * NOTE ON SEMANTICS: Hunter Discover is FREE and NOT gated by the
 * unified 50-credit bucket. The UI presents Discover as "Free"
 * separately, and only the contact/email bucket is shown as a real
 * usage number. Discover MUST NOT be blocked when contact/email
 * credits are exhausted.
 */
export async function getHunterUsageAction(): Promise<HunterUsageResult> {
  await requireMdfSession();
  if (!isBuyerFinderHunterEnabled()) {
    return {
      outcome: "disabled",
      usage: null,
      message: HUNTER_DISCOVERY_DISABLED_MESSAGE,
    };
  }
  if (!isBuyerFinderHunterConfigured()) {
    return { outcome: "not_configured", usage: null, message: "Hunter is not configured." };
  }
  try {
    const provider = createHunterUsageProvider({
      apiKey: requireBuyerFinderHunterApiKey(),
    });
    const usage = await provider.getUsage();
    return { outcome: "ok", usage };
  } catch (err) {
    return {
      outcome: "unavailable",
      usage: null,
      message: translateHunterError(err)[1] ?? "Usage unavailable.",
    };
  }
}

/* ---------------------------------------------------------------------- */
/*  Helpers                                                               */
/* ---------------------------------------------------------------------- */

function safeMessage(raw: string | undefined): string {
  const s = (raw ?? "").trim().slice(0, 300);
  return s || "Unknown error";
}

function translateHunterError(err: unknown): [SearchOutcomeCode, string] {
  if (err instanceof HunterDiscoveryError) {
    switch (err.code) {
      case "unauthorized":
        return ["unauthorized", "Hunter configuration needs attention."];
      case "forbidden":
        return ["forbidden", "Hunter refused this request."];
      case "rate_limited":
        return ["rate_limited", "Hunter is temporarily rate limited. Try again shortly."];
      case "timeout":
        return ["timeout", "Hunter did not respond in time."];
      case "provider_unavailable":
        return ["provider_unavailable", "Hunter is temporarily unavailable."];
      case "invalid_request":
        return ["invalid_request", "Search parameters were rejected by Hunter."];
      case "invalid_response":
        return ["provider_unavailable", "Hunter returned an unexpected response."];
      case "invalid_input":
      default:
        return ["invalid_input", "Search parameters were invalid."];
    }
  }
  return ["provider_unavailable", "Hunter is temporarily unavailable."];
}
