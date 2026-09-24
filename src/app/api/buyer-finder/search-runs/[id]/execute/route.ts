import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import {
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
  HUNTER_NOT_CONFIGURED_MESSAGE,
} from "@/lib/buyerFinder/config";
import { createHunterCompanyDiscoveryProvider } from "@/lib/buyerFinder/providers/hunter/companyDiscovery";
import { executeSearchRun } from "@/lib/buyerFinder/executeSearchRun";

/**
 * BF2.2 — Search Run execution route.
 *
 * Next.js serializes Server Actions from the same page, so a long-running
 * execute action would block 1s progress polls. This authenticated POST
 * runs concurrently with `getBuyerFinderSearchRunAction` polling.
 *
 * The handler does not start background work after returning. The
 * request stays open until ingestion finishes (or fails).
 *
 * Query parameters are NEVER read from the request body — the persisted
 * Search Run row is the authority. The browser supplies only the run id
 * in the URL.
 */
// The work is bounded to one Hunter request (15s provider timeout) and at
// most 20 locally processed companies. This headroom protects p95 database
// latency; it is not a substitute for the application-level bounds.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  context: { params: { id: string } },
) {
  await requireMdfSession();
  const id = context.params?.id ?? "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { outcome: "invalid_input", run: null, message: "Invalid search id." },
      { status: 400 },
    );
  }

  const { repos } = await serverRepositories();
  const startedAt = Date.now();
  console.info("[buyer-finder-search]", { event: "execution_started", runId: id });
  let result: Awaited<ReturnType<typeof executeSearchRun>>;
  try {
    result = await executeSearchRun({
      runId: id,
      searchRuns: repos.buyerFinderSearchRuns,
      ingestionRepos: {
        candidates: repos.buyerCandidates,
        contacts: repos.buyerCandidateContacts,
        productMatches: repos.buyerCandidateProductMatches,
      },
      freeEnrichmentJobs: repos.buyerFinderFreeEnrichmentJobs,
      isProviderConfigured: isBuyerFinderHunterReady,
      providerUnavailableMessage: HUNTER_NOT_CONFIGURED_MESSAGE,
      createCompanyProvider: () =>
        createHunterCompanyDiscoveryProvider({
          apiKey: requireBuyerFinderHunterApiKey(),
        }),
    });
  } catch (error) {
    console.error("[buyer-finder-search]", {
      event: "execution_failed",
      runId: id,
      durationMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }
  console.info("[buyer-finder-search]", {
    event: "execution_finished",
    runId: id,
    durationMs: Date.now() - startedAt,
    outcome: result.outcome,
    status: result.run?.status ?? null,
    stage: result.run?.stage ?? null,
    providerStatus: result.run?.providerStatus ?? null,
    discoveredCount: result.run?.discoveredCount ?? 0,
    processedCount: result.run?.processedCount ?? 0,
    createdCount: result.run?.createdCount ?? 0,
    failureCount: result.run?.failureCount ?? 0,
  });

  if (result.outcome === "completed" || result.outcome === "partial" || result.outcome === "failed") {
    revalidatePath("/buyer-finder");
  }

  const status =
    result.outcome === "not_found"
      ? 404
      : result.outcome === "invalid_input"
        ? 400
        : 200;
  return NextResponse.json(result, { status });
}
