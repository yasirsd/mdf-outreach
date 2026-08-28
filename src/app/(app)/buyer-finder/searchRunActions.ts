"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import { SearchRunActiveExistsError } from "@/lib/repositories/interfaces";
import { isActiveBusinessProductId } from "@/lib/buyerFinder/businessCatalogue";
import {
  isBuyerFinderHunterConfigured,
  isBuyerFinderHunterEnabled,
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
  HUNTER_DISCOVERY_DISABLED_MESSAGE,
  HUNTER_NOT_CONFIGURED_MESSAGE,
} from "@/lib/buyerFinder/config";
import { createHunterCompanyDiscoveryProvider } from "@/lib/buyerFinder/providers/hunter/companyDiscovery";
import { executeSearchRun, finalizeStaleSearchRun } from "@/lib/buyerFinder/executeSearchRun";
import type { ExecuteSearchRunResult } from "@/lib/buyerFinder/executeSearchRun";
import {
  toSnapshot,
  type SafeSearchRunSnapshot,
} from "@/lib/buyerFinder/searchRun";
import {
  BUYER_TYPE_OPTIONS,
  CONTACT_PRIORITY_OPTIONS,
  type BuyerTypeOption,
  type ContactPriorityId,
} from "@/lib/buyerFinder/types";
import { findCountryByName } from "@/lib/catalogue/countries";
import { ALREADY_RUNNING_MESSAGE } from "@/lib/buyerFinder/searchRunCopy";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateBuyerFinderSearchRunInput {
  country: string;
  productId: string;
  buyerTypes?: BuyerTypeOption[];
  contactPriorities?: ContactPriorityId[];
}

export type CreateSearchRunResult =
  | { outcome: "created"; run: SafeSearchRunSnapshot }
  | { outcome: "search_already_running"; run: SafeSearchRunSnapshot }
  | { outcome: "invalid_input"; message: string }
  | { outcome: "not_configured"; message: string }
  | { outcome: "disabled"; message: string };

export type GetSearchRunResult =
  | { outcome: "ok"; run: SafeSearchRunSnapshot }
  | { outcome: "not_found" }
  | { outcome: "invalid_input" };

function parseBuyerTypes(raw: unknown): BuyerTypeOption[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(BUYER_TYPE_OPTIONS);
  const out: BuyerTypeOption[] = [];
  for (const v of raw.slice(0, 8)) {
    if (typeof v === "string" && allowed.has(v) && !out.includes(v as BuyerTypeOption)) {
      out.push(v as BuyerTypeOption);
    }
  }
  return out;
}

function parseContactPriorities(raw: unknown): ContactPriorityId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(CONTACT_PRIORITY_OPTIONS.map((o) => o.id));
  const out: ContactPriorityId[] = [];
  for (const v of raw.slice(0, 12)) {
    if (typeof v === "string" && allowed.has(v as ContactPriorityId) && !out.includes(v as ContactPriorityId)) {
      out.push(v as ContactPriorityId);
    }
  }
  return out;
}

/**
 * Create a queued Search Run. Browser must not supply workspaceId,
 * provider, credits, cost class, status, stage, or an API key.
 *
 * If an active queued/running run already exists, returns that run
 * instead of creating another provider search.
 */
export async function createBuyerFinderSearchRunAction(
  input: CreateBuyerFinderSearchRunInput,
): Promise<CreateSearchRunResult> {
  await requireMdfSession();

  const country = (input?.country ?? "").trim().slice(0, 80);
  const productId = (input?.productId ?? "").trim().slice(0, 80);
  const buyerTypes = parseBuyerTypes(input?.buyerTypes);
  const contactPriorities = parseContactPriorities(input?.contactPriorities);

  if (!country || !findCountryByName(country)) {
    return { outcome: "invalid_input", message: "Select a valid country from the list." };
  }
  if (!productId || !isActiveBusinessProductId(productId)) {
    return { outcome: "invalid_input", message: "Select an active MDF product." };
  }
  if (!isBuyerFinderHunterEnabled()) {
    return {
      outcome: "disabled",
      message: HUNTER_DISCOVERY_DISABLED_MESSAGE,
    };
  }
  if (!isBuyerFinderHunterConfigured()) {
    return {
      outcome: "not_configured",
      message: HUNTER_NOT_CONFIGURED_MESSAGE,
    };
  }

  const { repos } = await serverRepositories();

  const active = await repos.buyerFinderSearchRuns.getLatestActive();
  if (active) {
    return { outcome: "search_already_running", run: toSnapshot(active) };
  }

  try {
    const run = await repos.buyerFinderSearchRuns.create({
      country,
      businessProductId: productId,
      desiredBuyerTypes: buyerTypes,
      contactPriorities,
    });
    return { outcome: "created", run: toSnapshot(run) };
  } catch (err) {
    if (err instanceof SearchRunActiveExistsError) {
      const existing = await repos.buyerFinderSearchRuns.getLatestActive();
      if (existing) {
        return { outcome: "search_already_running", run: toSnapshot(existing) };
      }
    }
    return { outcome: "invalid_input", message: ALREADY_RUNNING_MESSAGE };
  }
}

export async function getBuyerFinderSearchRunAction(runId: string): Promise<GetSearchRunResult> {
  await requireMdfSession();
  if (typeof runId !== "string" || !UUID_RE.test(runId)) {
    return { outcome: "invalid_input" };
  }
  const { repos } = await serverRepositories();
  const run = await repos.buyerFinderSearchRuns.get(runId);
  if (!run) return { outcome: "not_found" };
  return { outcome: "ok", run: toSnapshot(run) };
}

export async function getLatestActiveBuyerFinderSearchRunAction(): Promise<SafeSearchRunSnapshot | null> {
  await requireMdfSession();
  const { repos } = await serverRepositories();
  const run = await repos.buyerFinderSearchRuns.getLatestActive();
  return run ? toSnapshot(run) : null;
}

/**
 * Execute a queued Search Run. Query is loaded from the persisted row.
 *
 * Prefer the authenticated route handler from the browser so polling
 * can run concurrently (Next.js serializes Server Actions). Tests and
 * any caller may use this action directly.
 */
export async function executeBuyerFinderSearchRunAction(
  runId: string,
): Promise<ExecuteSearchRunResult> {
  await requireMdfSession();
  if (typeof runId !== "string" || !UUID_RE.test(runId)) {
    return { outcome: "invalid_input", run: null, message: "Invalid search id." };
  }
  const { repos } = await serverRepositories();
  const result = await executeSearchRun({
    runId,
    searchRuns: repos.buyerFinderSearchRuns,
    ingestionRepos: {
      candidates: repos.buyerCandidates,
      contacts: repos.buyerCandidateContacts,
      productMatches: repos.buyerCandidateProductMatches,
    },
    isProviderConfigured: isBuyerFinderHunterReady,
    providerUnavailableMessage: isBuyerFinderHunterEnabled()
      ? undefined
      : HUNTER_DISCOVERY_DISABLED_MESSAGE,
    createCompanyProvider: () =>
      createHunterCompanyDiscoveryProvider({
        apiKey: requireBuyerFinderHunterApiKey(),
      }),
  });
  if (result.outcome === "completed" || result.outcome === "partial" || result.outcome === "failed") {
    revalidatePath("/buyer-finder");
  }
  return result;
}

export async function finalizeStaleBuyerFinderSearchRunAction(
  runId: string,
): Promise<{ outcome: "finalized" | "not_stale" | "not_found" | "invalid_input"; run: SafeSearchRunSnapshot | null }> {
  await requireMdfSession();
  if (typeof runId !== "string" || !UUID_RE.test(runId)) {
    return { outcome: "invalid_input", run: null };
  }
  const { repos } = await serverRepositories();
  const result = await finalizeStaleSearchRun({
    runId,
    searchRuns: repos.buyerFinderSearchRuns,
  });
  if (result.outcome === "finalized") revalidatePath("/buyer-finder");
  return result;
}
