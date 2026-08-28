import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import {
  isBuyerFinderHunterEnabled,
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
  HUNTER_DISCOVERY_DISABLED_MESSAGE,
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
export const maxDuration = 60;
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
  const result = await executeSearchRun({
    runId: id,
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

  const status =
    result.outcome === "not_found"
      ? 404
      : result.outcome === "invalid_input"
        ? 400
        : 200;
  return NextResponse.json(result, { status });
}
