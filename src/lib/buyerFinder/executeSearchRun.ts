import "server-only";

import {
  discoverAndIngestCandidates,
  type BuyerFinderIngestionRepos,
  type IngestionBatchResult,
} from "./ingestion";
import { createCoalescedSearchRunReporter } from "./searchRunProgress";
import {
  INTERRUPTED_ERROR_CODE,
  isRunStale,
  isTerminal,
  toSnapshot,
  BUYER_FINDER_PROCESS_CAP,
  type BuyerFinderSearchRun,
  type SafeSearchRunSnapshot,
  type SearchRunPatch,
  type SearchRunStatus,
} from "./searchRun";
import type { ProviderNeutralOutcome } from "./providers/descriptors";
import type { CompanyDiscoveryProvider } from "./providers/types";
import type { BuyerFinderSearchRunRepository } from "@/lib/repositories/interfaces";
import {
  hunterCodeToSafeMessage,
  INTERRUPTED_MESSAGE,
  mapUnknownCodeToOutcome,
} from "./searchRunCopy";

export type ExecuteSearchRunOutcomeCode =
  | "completed"
  | "partial"
  | "failed"
  | "already_running"
  | "not_claimable"
  | "not_found"
  | "invalid_input";

export interface ExecuteSearchRunResult {
  outcome: ExecuteSearchRunOutcomeCode;
  run: SafeSearchRunSnapshot | null;
  message?: string;
}

export interface ExecuteSearchRunDeps {
  runId: string;
  searchRuns: BuyerFinderSearchRunRepository;
  ingestionRepos: BuyerFinderIngestionRepos;
  createCompanyProvider: () => CompanyDiscoveryProvider;
  isProviderConfigured: () => boolean;
  /**
   * Optional copy when the provider is blocked before construction.
   * Used so a disabled runtime gate is not described as a missing key.
   */
  providerUnavailableMessage?: string;
  now?: () => Date;
  /** Injected by tests. Default is a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

function candidateFailures(result: IngestionBatchResult): number {
  return result.failures.filter((f) => f.stage === "persist" || f.stage === "contacts").length;
}

function usefulPersisted(result: IngestionBatchResult): boolean {
  return result.created + result.enrichedExisting > 0;
}

/**
 * COMPLETED — provider ran and candidate processing finished with zero
 *   candidate-level (persist/contacts) failures.
 * PARTIAL — at least some candidates persisted AND one or more
 *   candidate-processing failures occurred.
 * FAILED — provider/search failed before useful completion, or nothing
 *   safe can be considered completed.
 * no_result — provider-neutral; the Search Run itself may still complete
 *   successfully with zero candidates. Not a technical failure.
 */
export function terminalStatusFor(result: IngestionBatchResult): {
  status: Extract<SearchRunStatus, "completed" | "partial" | "failed">;
  providerStatus: ProviderNeutralOutcome;
} {
  const discovery = result.failures.find((f) => f.stage === "discovery");
  if (discovery) {
    return {
      status: "failed",
      providerStatus: mapUnknownCodeToOutcome(discovery.code),
    };
  }
  const candFail = candidateFailures(result);
  if (candFail > 0 && usefulPersisted(result)) {
    return { status: "partial", providerStatus: "success" };
  }
  if (candFail > 0 && !usefulPersisted(result)) {
    return { status: "failed", providerStatus: "success" };
  }
  if (result.usable === 0) {
    return { status: "completed", providerStatus: "no_result" };
  }
  return { status: "completed", providerStatus: "success" };
}

const FINALIZE_RETRY_BACKOFF_MS = [50, 100] as const;

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function finalizeWithRetry(
  searchRuns: BuyerFinderSearchRunRepository,
  runId: string,
  patch: SearchRunPatch,
  sleep: (ms: number) => Promise<void>,
): Promise<BuyerFinderSearchRun> {
  let lastError: unknown;
  const attempts = 1 + FINALIZE_RETRY_BACKOFF_MS.length;
  for (let i = 0; i < attempts; i++) {
    try {
      return await searchRuns.update(runId, patch);
    } catch (err) {
      lastError = err;
      const backoff = FINALIZE_RETRY_BACKOFF_MS[i];
      if (backoff != null) await sleep(backoff);
    }
  }
  throw lastError;
}

/**
 * Atomic claim + ingest + finalize. Query parameters are loaded from
 * the persisted run row — never from a second browser payload.
 *
 * Two concurrent callers: exactly one claim succeeds; the other
 * receives `already_running` / `not_claimable` and does not call the
 * company provider.
 */
export async function executeSearchRun(deps: ExecuteSearchRunDeps): Promise<ExecuteSearchRunResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const existing = await deps.searchRuns.get(deps.runId);
  if (!existing) return { outcome: "not_found", run: null, message: "Search not found." };
  if (isTerminal(existing.status)) {
    return { outcome: "not_claimable", run: toSnapshot(existing) };
  }
  if (existing.status === "running") {
    return { outcome: "already_running", run: toSnapshot(existing) };
  }

  const claimed = await deps.searchRuns.claimQueued(deps.runId);
  if (!claimed) {
    const again = await deps.searchRuns.get(deps.runId);
    if (!again) return { outcome: "not_found", run: null, message: "Search not found." };
    if (isTerminal(again.status)) return { outcome: "not_claimable", run: toSnapshot(again) };
    return { outcome: "already_running", run: toSnapshot(again) };
  }

  if (!deps.isProviderConfigured()) {
    const failed = await finalizeWithRetry(deps.searchRuns, claimed.id, {
      status: "failed",
      stage: "complete",
      providerStatus: "not_configured",
      errorCode: "not_configured",
      errorMessage:
        deps.providerUnavailableMessage ?? hunterCodeToSafeMessage("unauthorized"),
      completedAt: (deps.now ?? (() => new Date()))().toISOString(),
    }, sleep);
    return { outcome: "failed", run: toSnapshot(failed), message: failed.errorMessage ?? undefined };
  }

  // Provider is constructed ONLY after a successful claim.
  const companyProvider = deps.createCompanyProvider();

  const reporter = createCoalescedSearchRunReporter({
    persist: async (patch) => {
      await deps.searchRuns.update(claimed.id, patch);
    },
    initialStage: claimed.stage,
  });

  let result: IngestionBatchResult;
  try {
    result = await discoverAndIngestCandidates({
      query: {
        country: claimed.country,
        productId: claimed.businessProductId,
        buyerTypes: claimed.desiredBuyerTypes,
        contactPriorities: claimed.contactPriorities,
        limit: BUYER_FINDER_PROCESS_CAP,
      },
      companyProvider,
      // Production path: no contactProvider.
      repositories: deps.ingestionRepos,
      progress: reporter,
      progressProvider: claimed.provider,
    });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
    const providerStatus = mapUnknownCodeToOutcome(code);
    const message = hunterCodeToSafeMessage(code);
    const failed = await finalizeWithRetry(deps.searchRuns, claimed.id, {
      status: "failed",
      stage: "complete",
      providerStatus,
      errorCode: code ?? "provider_unavailable",
      errorMessage: message,
      completedAt: (deps.now ?? (() => new Date()))().toISOString(),
    }, sleep);
    return { outcome: "failed", run: toSnapshot(failed), message };
  }

  await reporter.flush();

  const terminal = terminalStatusFor(result);
  const discovery = result.failures.find((f) => f.stage === "discovery");
  const errorCode = discovery?.code;
  const errorMessage =
    terminal.status === "failed"
      ? hunterCodeToSafeMessage(errorCode)
      : terminal.status === "partial"
        ? undefined
        : undefined;

  const done = await finalizeWithRetry(deps.searchRuns, claimed.id, {
    status: terminal.status,
    stage: "complete",
    providerStatus: terminal.providerStatus,
    discoveredCount: result.discovered,
    usableCount: result.usable,
    processedCount: result.usable,
    createdCount: result.created,
    enrichedExistingCount: result.enrichedExisting,
    duplicateCount: result.skippedExactDuplicates,
    productMatchesAdded: result.productMatchesAdded,
    failureCount: result.failures.length,
    errorCode: terminal.status === "failed" ? errorCode ?? "provider_unavailable" : null,
    errorMessage: errorMessage ?? null,
    completedAt: (deps.now ?? (() => new Date()))().toISOString(),
  }, sleep);

  return {
    outcome: terminal.status,
    run: toSnapshot(done),
    message: done.errorMessage ?? undefined,
  };
}

export async function finalizeStaleSearchRun(input: {
  runId: string;
  searchRuns: BuyerFinderSearchRunRepository;
  now?: () => Date;
}): Promise<{ outcome: "finalized" | "not_stale" | "not_found"; run: SafeSearchRunSnapshot | null }> {
  const now = input.now ?? (() => new Date());
  const run = await input.searchRuns.get(input.runId);
  if (!run) return { outcome: "not_found", run: null };
  if (!isRunStale(run, now())) {
    return { outcome: "not_stale", run: toSnapshot(run) };
  }
  const failed = await input.searchRuns.update(run.id, {
    status: "failed",
    stage: "complete",
    errorCode: INTERRUPTED_ERROR_CODE,
    errorMessage: INTERRUPTED_MESSAGE,
    completedAt: now().toISOString(),
  });
  return { outcome: "finalized", run: toSnapshot(failed) };
}
