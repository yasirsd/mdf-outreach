import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySearchRunRepository, createMemorySearchRunStore } from "@/lib/buyerFinder/testUtils/memorySearchRunRepository";
import { createMemoryBuyerFinderRepos } from "@/lib/buyerFinder/testUtils/memoryRepositories";
import type { SafeSearchRunSnapshot } from "@/lib/buyerFinder/searchRun";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };

const store = createMemorySearchRunStore();
const harness = {
  requireMdfSession: vi.fn(async () => SESSION),
  isConfigured: vi.fn(() => true),
  requireKey: vi.fn(() => "server-only-key"),
  revalidatePath: vi.fn(),
  discover: vi.fn(async (_query?: unknown) => [] as unknown[]),
  searchRuns: createMemorySearchRunRepository("ws-a", store),
  ingestion: createMemoryBuyerFinderRepos(),
};

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: () => harness.requireMdfSession(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => harness.revalidatePath(path),
}));

vi.mock("next/headers", () => ({ cookies: () => ({}) }));

vi.mock("@/lib/buyerFinder/config", () => ({
  isBuyerFinderHunterConfigured: () => harness.isConfigured(),
  isBuyerFinderHunterReady: () => harness.isConfigured(),
  requireBuyerFinderHunterApiKey: () => harness.requireKey(),
  HUNTER_NOT_CONFIGURED_MESSAGE: "Hunter is not configured on this server. Contact MDF admin.",
}));

vi.mock("@/lib/buyerFinder/providers/hunter/companyDiscovery", () => ({
  createHunterCompanyDiscoveryProvider: (opts: { apiKey: string }) => {
    expect(opts.apiKey).toBe("server-only-key");
    return { discover: harness.discover };
  },
}));

vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: SESSION,
    repos: {
      buyerFinderSearchRuns: harness.searchRuns,
      buyerCandidates: harness.ingestion.candidates,
      buyerCandidateContacts: harness.ingestion.contacts,
      buyerCandidateProductMatches: harness.ingestion.productMatches,
      buyerFinderFreeEnrichmentJobs: harness.ingestion.freeEnrichmentJobs,
    },
  }),
}));

import {
  createBuyerFinderSearchRunAction,
  executeBuyerFinderSearchRunAction,
  finalizeStaleBuyerFinderSearchRunAction,
  getBuyerFinderSearchRunAction,
  getLatestActiveBuyerFinderSearchRunAction,
} from "./searchRunActions";

describe("searchRunActions", () => {
  beforeEach(() => {
    harness.requireMdfSession.mockImplementation(async () => SESSION);
    harness.isConfigured.mockReturnValue(true);
    harness.requireKey.mockReturnValue("server-only-key");
    harness.discover.mockReset();
    harness.discover.mockResolvedValue([]);
    harness.revalidatePath.mockReset();
    store.rows.clear();
    harness.searchRuns = createMemorySearchRunRepository("ws-a", store);
    harness.ingestion = createMemoryBuyerFinderRepos();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated create", async () => {
    harness.requireMdfSession.mockRejectedValueOnce(new Error("unauth"));
    await expect(
      createBuyerFinderSearchRunAction({
        country: "Thailand",
        productId: "guntur-dry-red-chilli",
      }),
    ).rejects.toThrow(/unauth/);
  });

  it("rejects invalid country", async () => {
    const r = await createBuyerFinderSearchRunAction({
      country: "Narnia",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("invalid_input");
  });

  it("rejects invalid product", async () => {
    const r = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "not-a-product",
    });
    expect(r.outcome).toBe("invalid_input");
  });

  it("create returns a safe snapshot with free / 0 credits", async () => {
    const r = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
      buyerTypes: ["Importer"],
      contactPriorities: ["procurement"],
    });
    expect(r.outcome).toBe("created");
    if (r.outcome !== "created") return;
    assertSafe(r.run);
    expect(r.run.status).toBe("queued");
    expect(r.run.provider).toBe("hunter");
    expect(r.run.costClass).toBe("free");
    expect(r.run.creditsUsed).toBe(0);
  });

  it("duplicate active creation resumes the existing run", async () => {
    const first = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    const second = await createBuyerFinderSearchRunAction({
      country: "United Arab Emirates",
      productId: "banganapalli-mango",
    });
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("search_already_running");
    if (first.outcome === "created" && second.outcome === "search_already_running") {
      expect(second.run.id).toBe(first.run.id);
      expect(second.run.country).toBe("Thailand");
    }
  });

  it("Hunter not configured is a safe failure on create", async () => {
    harness.isConfigured.mockReturnValue(false);
    const r = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("not_configured");
    expect(store.rows.size).toBe(0);
  });

  it("API key present allows create without a Hunter enable switch", async () => {
    const r = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
    expect(harness.requireKey).not.toHaveBeenCalled();
  });

  it("key absent during execute never calls the Hunter provider", async () => {
    const created = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    harness.isConfigured.mockReturnValue(false);
    const exec = await executeBuyerFinderSearchRunAction(created.run.id);
    expect(harness.discover).not.toHaveBeenCalled();
    expect(exec.outcome).toBe("failed");
    expect(exec.run?.providerStatus).toBe("not_configured");
    expect(exec.message).toMatch(/not configured/i);
    expect(JSON.stringify(exec)).not.toMatch(/server-only-key|BUYER_FINDER_HUNTER/i);
  });

  it("get rejects a malformed UUID", async () => {
    const r = await getBuyerFinderSearchRunAction("cand-not-a-uuid");
    expect(r.outcome).toBe("invalid_input");
  });

  it("get returns not_found for an unknown id (cross-workspace included)", async () => {
    const r = await getBuyerFinderSearchRunAction("00000000-0000-4000-8000-ffffffffffff");
    expect(r.outcome).toBe("not_found");
  });

  it("execute loads query from the persisted run, not the browser", async () => {
    const created = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
      buyerTypes: ["Importer"],
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    harness.discover.mockResolvedValueOnce([
      {
        providerRecordId: "h1",
        companyName: "Spice Co",
        domain: "spice.example",
        country: "Thailand",
        evidence: [{ note: "dir", confidence: 40 }],
        source: "hunter",
      },
    ]);
    const exec = await executeBuyerFinderSearchRunAction(created.run.id);
    expect(harness.discover).toHaveBeenCalledTimes(1);
    expect(harness.discover.mock.calls[0]?.[0]).toMatchObject({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
      buyerTypes: ["Importer"],
    });
    expect(exec.outcome).toBe("completed");
    expect(exec.run?.creditsUsed).toBe(0);
    assertSafe(exec.run);
  });

  it("malformed execute id is rejected before Hunter", async () => {
    const r = await executeBuyerFinderSearchRunAction("nope");
    expect(r.outcome).toBe("invalid_input");
    expect(harness.discover).not.toHaveBeenCalled();
  });

  it("latest active returns the queued run", async () => {
    const created = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    expect(created.outcome).toBe("created");
    const latest = await getLatestActiveBuyerFinderSearchRunAction();
    expect(latest?.id).toBe(created.outcome === "created" ? created.run.id : "");
    assertSafe(latest);
  });

  it("finalizeStale refuses a healthy run", async () => {
    const created = await createBuyerFinderSearchRunAction({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;
    const r = await finalizeStaleBuyerFinderSearchRunAction(created.run.id);
    expect(r.outcome).toBe("not_stale");
    expect(r.run?.status).toBe("queued");
  });
});

function assertSafe(run: SafeSearchRunSnapshot | null | undefined) {
  expect(run).toBeTruthy();
  const json = JSON.stringify(run);
  expect(json).not.toMatch(/workspaceId/);
  expect(json).not.toMatch(/server-only-key/);
  expect(json).not.toMatch(/BUYER_FINDER_HUNTER/);
  expect(json).not.toMatch(/api[_-]?key/i);
  expect(run as object).not.toHaveProperty("workspaceId");
}
