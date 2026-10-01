import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks are declared before the module under test is imported.
vi.mock("server-only", () => ({}));

const requireMdfSessionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require", () => ({ requireMdfSession: requireMdfSessionMock }));

const cookiesMock = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const serverReposMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/repositories/server", () => ({ serverRepositories: serverReposMock }));

const createSupabaseClientMock = vi.hoisted(() => vi.fn(() => ({} as unknown)));
vi.mock("@/utils/supabase/server", () => ({ createClient: createSupabaseClientMock }));

const getServiceRoleClientMock = vi.hoisted(() => vi.fn(() => ({ from: () => ({}) } as unknown)));
vi.mock("@/lib/tradeResearch/server/serviceRoleClient", () => ({
  getTradeResearchServiceRoleClient: getServiceRoleClientMock,
}));

const createBatchMock = vi.hoisted(() => vi.fn());
const getFreshSnapshotMock = vi.hoisted(() => vi.fn(async () => null));
const getFreshSnapshotByProviderMock = vi.hoisted(() => vi.fn(async () => null));
const writerCtorMock = vi.hoisted(() => vi.fn(() => ({
  createBatch: createBatchMock,
  getFreshSnapshot: getFreshSnapshotMock,
  getFreshSnapshotByProvider: getFreshSnapshotByProviderMock,
})));
const getBatchMock = vi.hoisted(() => vi.fn(async (_id: string) => undefined as unknown));
const getLatestJobForContextMock = vi.hoisted(() => vi.fn(async (
  _candidateId: string,
  _contextFingerprint: string,
) => null as unknown));
const getLatestJobsForContextsMock = vi.hoisted(() => vi.fn(
  async (_items: Array<{ candidateId: string; contextFingerprint: string }>) => new Map<string, unknown>(),
));
const readRepoMock = vi.hoisted(() => vi.fn(() => ({
  getLatestJobsForContexts: getLatestJobsForContextsMock,
  getLatestJobForContext: getLatestJobForContextMock,
  getBatch: getBatchMock,
})));
vi.mock("@/lib/tradeResearch/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tradeResearch/repository")>(
    "@/lib/tradeResearch/repository",
  );
  return {
    ...actual,
    TradeResearchWriter: writerCtorMock,
    createTradeResearchReadRepository: readRepoMock,
  };
});

type DrainDeps = { maxJobs: number; timeBudgetMs: number; workerId: string };
const drainMock = vi.hoisted(() =>
  vi.fn(async (_deps: DrainDeps) => ({
    jobsRequested: 1, claimed: 1, processed: 1, completed: 1, requeued: 0,
    failed: 0, noWork: false, durationMs: 42, automaticSpendRupees: 0 as const,
  })),
);
vi.mock("@/lib/tradeResearch/server/worker", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tradeResearch/server/worker")>(
    "@/lib/tradeResearch/server/worker",
  );
  return { ...actual, drainTradeResearch: drainMock };
});

vi.mock("@/lib/tradeResearch/providers", () => {
  const FDA = { id: "fda_fsvp", version: "v1", costClass: "free", termsVersion: "v1" };
  const CID = { id: "canada-cid", version: "canada-cid-v1", costClass: "free", termsVersion: "ogl-canada-v2.0" };
  const VQIP = { id: "fda-vqip", version: "fda-vqip-v1", costClass: "free", termsVersion: "public-fda-list-v1" };
  return {
    FDA_FSVP_DESCRIPTOR: FDA,
    CANADA_CID_DESCRIPTOR: CID,
    FDA_VQIP_DESCRIPTOR: VQIP,
    DEFAULT_TRADE_RESEARCH_DESCRIPTORS: [FDA, VQIP, CID],
    planTradeResearch: (input: { descriptors?: unknown[] }) => (input.descriptors ?? [FDA]).map((descriptor) => ({
      descriptor,
      role: "primary", eligible: true, reason: "eligible", cacheHit: false,
      automaticSpendRupees: 0,
    })),
  };
});

vi.mock("@/lib/tradeResearch/fdaVqip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tradeResearch/fdaVqip")>();
  return { ...actual, FDA_VQIP_DATASET_ID: "fda-vqip-participant-list" };
});

import type { TradeResearchBatchSnapshot } from "@/lib/tradeResearch/types";

const OWNER_SESSION = {
  userId: "00000000-0000-4000-8000-000000000010",
  email: "owner@mdfexport.com",
  membership: { workspaceId: "00000000-0000-4000-8000-000000000011", role: "owner" as const },
};
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST = {
  candidateId: CANDIDATE_ID,
  marketCountryCode: "US",
  productId: "guntur-dry-red-chilli",
  productForm: null,
  researchGoal: "screen_trade_activity" as const,
};
const BATCH: TradeResearchBatchSnapshot = {
  id: "00000000-0000-4000-8000-000000000009",
  status: "queued",
  requestedGoal: "screen_trade_activity",
  totalJobs: 1, queuedCount: 1, runningCount: 0, completedCount: 0,
  partialCount: 0, needsReviewCount: 0, failedCount: 0, cancelledCount: 0,
  corroboratedCount: 0, automaticSpendRupees: 0, createdAt: "2026-09-26T00:00:00Z",
};

beforeEach(() => {
  requireMdfSessionMock.mockReset();
  revalidatePathMock.mockReset();
  createBatchMock.mockReset();
  getLatestJobsForContextsMock.mockReset().mockResolvedValue(new Map());
  getLatestJobForContextMock.mockReset().mockResolvedValue(null);
  drainMock.mockReset().mockResolvedValue({
    jobsRequested: 1, claimed: 1, processed: 1, completed: 1, requeued: 0,
    failed: 0, noWork: false, durationMs: 42, automaticSpendRupees: 0,
  });
  // Default: batch has reached a terminal state after the first drain,
  // so the kick loop exits after ONE iteration. Individual tests override.
  getBatchMock.mockReset().mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000009", status: "completed",
    requestedGoal: "screen_trade_activity", totalJobs: 1, queuedCount: 0,
    runningCount: 0, completedCount: 1, partialCount: 0, needsReviewCount: 0,
    failedCount: 0, cancelledCount: 0, corroboratedCount: 0,
    automaticSpendRupees: 0, createdAt: "2026-09-26T00:00:00Z",
  });
  serverReposMock.mockResolvedValue({
    repos: {
      buyerCandidates: { list: async () => [{ id: CANDIDATE_ID, companyName: "Latitude 36 Foods", country: "US" }] },
      buyerCandidateProductMatches: {
        listByCandidate: async () => [{ candidateId: CANDIDATE_ID, productId: "guntur-dry-red-chilli" }],
      },
    },
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("BI4F 2A createTradeResearchBatchAction — inline kick", () => {
  it("owner: create batch → server-side drain kick fires exactly once, secret never sent to caller", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([REQUEST]);
    expect(result).toEqual({ outcome: "created", batch: BATCH });
    expect(drainMock).toHaveBeenCalledTimes(1);
    // Bounded kick: exactly one job, capped time budget.
    const kick = drainMock.mock.calls[0]![0] as {
      maxJobs: number; timeBudgetMs: number; workerId: string;
    };
    expect(kick.maxJobs).toBe(1);
    expect(kick.timeBudgetMs).toBeGreaterThanOrEqual(30_000);
    expect(kick.timeBudgetMs).toBeLessThanOrEqual(45_000);
    expect(kick.workerId).toMatch(/^inline-/);
    // Response payload never carries a secret name.
    expect(JSON.stringify(result)).not.toMatch(/TRADE_RESEARCH_DRAIN_SECRET|CRON_SECRET/);
  });

  it("drain failure is absorbed — the created batch is still returned to the caller", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    drainMock.mockRejectedValueOnce(new Error("worker exploded"));
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([REQUEST]);
    expect(result).toEqual({ outcome: "created", batch: BATCH });
    expect(revalidatePathMock).toHaveBeenCalledWith("/buyer-finder");
  });

  it("drain returns no_work is harmless — the action still succeeds", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    drainMock.mockResolvedValueOnce({
      jobsRequested: 1, claimed: 0, processed: 0, completed: 0, requeued: 0,
      failed: 0, noWork: true, durationMs: 3, automaticSpendRupees: 0,
    });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([REQUEST]);
    expect(result).toEqual({ outcome: "created", batch: BATCH });
  });

  it("non-owner cannot even create a batch, so no drain kick is fired", async () => {
    requireMdfSessionMock.mockResolvedValue({ ...OWNER_SESSION, membership: { ...OWNER_SESSION.membership, role: "member" } });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([REQUEST]);
    expect(result.outcome).toBe("forbidden");
    expect(createBatchMock).not.toHaveBeenCalled();
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("does not pass a candidate absent from the selected workspace to the service-role writer", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    serverReposMock.mockResolvedValueOnce({
      repos: {
        buyerCandidates: { list: async () => [] },
        buyerCandidateProductMatches: { listByCandidate: async () => [] },
      },
    });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([REQUEST]);
    expect(result).toMatchObject({ outcome: "candidate_not_found" });
    expect(createBatchMock).not.toHaveBeenCalled();
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("automatic spend enforcement — the kick's drain callsite forbids paid providers via the shared worker", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([REQUEST]);
    // The action does not pass any `costClass` override to drain — the
    // worker's own PROVIDER_COST_POLICY_VIOLATION guard is authoritative.
    const kick = drainMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(kick.costClass).toBeUndefined();
    expect(kick.automaticSpendRupees).toBeUndefined();
  });
});

describe("T14 Stage 1 — env-driven kick strategy (Netlify Background Function path)", () => {
  const NETLIFY_URL = "https://staging.netlify.app/.netlify/functions/trade-research-drain-background";
  const SECRET = "netlify-bg-secret-1234567890";

  beforeEach(() => {
    process.env.NETLIFY_BG_DRAIN_URL = NETLIFY_URL;
    process.env.TRADE_RESEARCH_DRAIN_SECRET = SECRET;
  });

  it("when NETLIFY_BG_DRAIN_URL is set: server action POSTs to the background function and DOES NOT await a full inline drain", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never)
      .mockImplementation((async () => new Response("ok", { status: 202 })) as never);
    try {
      const started = Date.now();
      const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
      const result = await createTradeResearchBatchAction([REQUEST]);
      const elapsed = Date.now() - started;
      expect(result).toEqual({ outcome: "created", batch: BATCH });
      // Fire-and-forget: the inline drain worker MUST NOT be invoked
      // when the Netlify Background Function URL is configured.
      expect(drainMock).not.toHaveBeenCalled();
      // The background function URL was called exactly once with the
      // secret in the Authorization header — never in the query
      // string, never in the body echoed to the caller.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe(NETLIFY_URL);
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.authorization).toBe(`Bearer ${SECRET}`);
      // Server action returns quickly — the background function's own
      // 15-minute ceiling is not consumed by the caller. Even with
      // network jitter this should be well below the 10 s Netlify
      // sync ceiling.
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("fire-and-forget invocation NEVER leaks TRADE_RESEARCH_DRAIN_SECRET to the caller's result", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never)
      .mockImplementation((async () => new Response("ok", { status: 202 })) as never);
    try {
      const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
      const result = await createTradeResearchBatchAction([REQUEST]);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("background function URL unreachable → server action still succeeds and returns the created batch", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never)
      .mockImplementation((async () => { throw new Error("network unreachable"); }) as never);
    try {
      const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
      const result = await createTradeResearchBatchAction([REQUEST]);
      // Absorbed failure — the batch is safely queued and a future
      // Supabase Cron tick will drain it.
      expect(result).toEqual({ outcome: "created", batch: BATCH });
      expect(revalidatePathMock).toHaveBeenCalledWith("/buyer-finder");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("when NETLIFY_BG_DRAIN_URL is NOT set: Vercel behaviour is preserved — the inline drain kick still runs", async () => {
    delete process.env.NETLIFY_BG_DRAIN_URL;
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never)
      .mockImplementation((async () => new Response("no", { status: 500 })) as never);
    try {
      const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
      const result = await createTradeResearchBatchAction([REQUEST]);
      expect(result).toEqual({ outcome: "created", batch: BATCH });
      // Existing Vercel path — drain worker invoked, no HTTP call to
      // a background function URL.
      expect(drainMock).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("T07 explicit research request binding", () => {
  const MANGO_REQUEST = { ...REQUEST, productId: "banganapalli-mango" };

  function repositoriesWithProducts(productIds: string[]) {
    return {
      repos: {
        buyerCandidates: {
          list: async () => [{ id: CANDIDATE_ID, companyName: "Latitude 36 Foods", country: "United States" }],
        },
        buyerCandidateProductMatches: {
          listByCandidate: async () => productIds.map((productId, index) => ({
            id: `match-${index}`,
            candidateId: CANDIDATE_ID,
            productId,
            evidence: [],
          })),
        },
      },
    };
  }

  it("stores the explicitly requested chilli context with server-owned workspace and versions", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([{ ...REQUEST, workspaceId: "browser-workspace", providerPlanVersion: "browser-v9" } as typeof REQUEST]);
    const input = createBatchMock.mock.calls[0]![0] as {
      workspaceId: string;
      plannerVersion: string;
      jobs: Array<{ context: Record<string, unknown>; contextFingerprint: string }>;
    };
    expect(input.workspaceId).toBe(OWNER_SESSION.membership.workspaceId);
    expect(input.jobs[0]!.context).toMatchObject({
      workspaceId: OWNER_SESSION.membership.workspaceId,
      candidateId: CANDIDATE_ID,
      productId: "guntur-dry-red-chilli",
      marketCountryCode: "US",
      productForm: null,
      providerPlanVersion: "trade-planner-v1",
      interpretationVersion: "trade-interpretation-v1",
    });
    expect(input.jobs[0]!.contextFingerprint).toMatch(/^trctx-v1:[0-9a-f]{64}$/);
  });

  it("uses explicit mango even when chilli is the first product row", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    serverReposMock.mockResolvedValueOnce(repositoriesWithProducts([
      "guntur-dry-red-chilli",
      "banganapalli-mango",
    ]));
    createBatchMock.mockResolvedValueOnce(BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([MANGO_REQUEST]);
    const input = createBatchMock.mock.calls[0]![0] as { jobs: Array<{ productId: string; context: { productId: string } }> };
    expect(input.jobs[0]).toMatchObject({
      productId: "banganapalli-mango",
      context: { productId: "banganapalli-mango" },
    });
  });

  it("creates distinct contexts for chilli and mango on the same candidate", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    serverReposMock.mockResolvedValueOnce(repositoriesWithProducts([
      "guntur-dry-red-chilli",
      "banganapalli-mango",
    ]));
    createBatchMock.mockResolvedValueOnce(BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([REQUEST, MANGO_REQUEST]);
    const input = createBatchMock.mock.calls[0]![0] as { jobs: Array<{ contextFingerprint: string }> };
    expect(input.jobs).toHaveLength(2);
    expect(input.jobs[0]!.contextFingerprint).not.toBe(input.jobs[1]!.contextFingerprint);
  });

  it("rejects missing and arbitrary candidate product contexts", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await expect(createTradeResearchBatchAction([{ ...REQUEST, productId: "" }]))
      .resolves.toMatchObject({ outcome: "invalid_input" });
    await expect(createTradeResearchBatchAction([{ ...REQUEST, productId: "indian-pomegranate" }]))
      .resolves.toMatchObject({ outcome: "invalid_input" });
    expect(createBatchMock).not.toHaveBeenCalled();
  });

  it("rejects non-null form while the current product model has no form selector", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([{ ...REQUEST, productForm: "whole" }]);
    expect(result.outcome).toBe("invalid_input");
  });

  it("blocks only the same active context and permits a different product", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValue(BATCH);
    getLatestJobsForContextsMock.mockImplementationOnce(async (items: Array<{ contextFingerprint: string }>) => new Map([
      [items[0]!.contextFingerprint, {
        id: "00000000-0000-4000-8000-000000000090",
        status: "running",
      }],
    ]));
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await expect(createTradeResearchBatchAction([REQUEST]))
      .resolves.toMatchObject({ outcome: "already_active" });
    expect(createBatchMock).not.toHaveBeenCalled();

    serverReposMock.mockResolvedValueOnce(repositoriesWithProducts([
      "guntur-dry-red-chilli",
      "banganapalli-mango",
    ]));
    getLatestJobsForContextsMock.mockResolvedValueOnce(new Map());
    await expect(createTradeResearchBatchAction([MANGO_REQUEST]))
      .resolves.toMatchObject({ outcome: "created" });
  });

  it("permits a different market while another context fingerprint is active", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValue(BATCH);
    getLatestJobsForContextsMock.mockResolvedValueOnce(new Map([[`trctx-v1:${"a".repeat(64)}`, {
      id: "00000000-0000-4000-8000-000000000090",
      status: "running",
    }]]));
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await expect(createTradeResearchBatchAction([{ ...REQUEST, marketCountryCode: "CA" }]))
      .resolves.toMatchObject({ outcome: "created" });
  });

  it("builds exact-context reads from the selected workspace and server versions", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    const { getLatestTradeResearchJobForContextAction } = await import("./tradeResearchActions");
    await getLatestTradeResearchJobForContextAction({
      ...REQUEST,
      workspaceId: "browser-workspace",
      providerPlanVersion: "browser-v9",
      interpretationVersion: "browser-v9",
    } as typeof REQUEST);

    expect(getLatestJobForContextMock).toHaveBeenCalledWith(
      CANDIDATE_ID,
      expect.stringMatching(/^trctx-v1:[0-9a-f]{64}$/),
    );
  });
});

describe("BI4F 2A createTradeResearchBatchAction — server-only surface", () => {
  const HERE = process.cwd();
  const body = readFileSync(path.resolve(HERE, "src/app/(app)/buyer-finder/tradeResearchActions.ts"), "utf8");

  it("declares \"use server\" and never exposes the drain secret string", () => {
    expect(body.startsWith('"use server";')).toBe(true);
    // The secret NAME may appear ONLY inside a server-side env-var
    // read (T14 Stage 1 introduced a server-to-server POST to the
    // Netlify Background Function that legitimately reads
    // `process.env.TRADE_RESEARCH_DRAIN_SECRET`). It must NEVER appear
    // inline as a bare string literal, in a URL, or in any comment
    // that could suggest client-side use.
    const secretNameOccurrences = body.match(/TRADE_RESEARCH_DRAIN_SECRET/g) ?? [];
    for (const _ of secretNameOccurrences) {
      // Each occurrence must be prefixed by `process.env.` — the only
      // legitimate way to reference this identifier in server code.
      // (Multiple occurrences allowed as long as every one is an env read.)
    }
    const bareRefs = body.match(/(?<!process\.env\.)TRADE_RESEARCH_DRAIN_SECRET/g) ?? [];
    expect(bareRefs).toEqual([]);
    expect(body).not.toMatch(/CRON_SECRET/);
    // No client-visible fetch() to the internal drain route either.
    expect(body).not.toMatch(/\/api\/internal\/trade-research\/drain/);
    expect(body).not.toMatch(/\/api\/cron\/trade-research-drain/);
  });

  it("never starts an unawaited background promise for the drain kick", () => {
    // `void drainTradeResearch(...)` or `drainTradeResearch(...).catch(...)`
    // WITHOUT an `await` in front is exactly the pattern the brief forbids.
    expect(body).not.toMatch(/void\s+drainTradeResearch\(/);
    // The kick MUST be awaited. Search for the awaited invocation.
    expect(body).toMatch(/await\s+kickTradeResearchDrain\(/);
    expect(body).toMatch(/await\s+drainTradeResearch\(/);
  });

  it("kick is bounded — maxJobs = 1, per-drain budget = 45s, hard ceiling ≤ 50s", () => {
    expect(body).toMatch(/INLINE_KICK_JOBS\s*=\s*1\b/);
    expect(body).toMatch(/INLINE_KICK_BUDGET_MS\s*=\s*45_000\b/);
    expect(body).toMatch(/INLINE_KICK_HARD_CEILING_MS\s*=\s*50_000\b/);
    expect(body).toMatch(/INLINE_KICK_MAX_ITERATIONS\s*=\s*2\b/);
  });
});

describe("BI4F 2A createTradeResearchBatchAction — bounded stall-recovery loop", () => {
  it("terminal batch after first drain → kick loop exits after ONE drain call (no busy loop)", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    // Default beforeEach: batch is terminal after first drain.
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([REQUEST]);
    expect(drainMock).toHaveBeenCalledTimes(1);
  });

  it("non-terminal batch after first drain → SECOND drain call is issued to advance retry_wait", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    // Sequence: still running after 1st drain, terminal after 2nd.
    getBatchMock.mockReset()
      .mockResolvedValueOnce({
        id: BATCH.id, status: "running", requestedGoal: "screen_trade_activity",
        totalJobs: 1, queuedCount: 0, runningCount: 1, completedCount: 0,
        partialCount: 0, needsReviewCount: 0, failedCount: 0, cancelledCount: 0,
        corroboratedCount: 0, automaticSpendRupees: 0, createdAt: "2026-09-26T00:00:00Z",
      })
      .mockResolvedValueOnce({
        id: BATCH.id, status: "completed", requestedGoal: "screen_trade_activity",
        totalJobs: 1, queuedCount: 0, runningCount: 0, completedCount: 1,
        partialCount: 0, needsReviewCount: 0, failedCount: 0, cancelledCount: 0,
        corroboratedCount: 0, automaticSpendRupees: 0, createdAt: "2026-09-26T00:00:00Z",
      });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([REQUEST]);
    expect(drainMock).toHaveBeenCalledTimes(2);
  });

  it("no_work first drain → kick loop exits (nothing to reclaim in the retry window)", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    drainMock.mockReset().mockResolvedValueOnce({
      jobsRequested: 1, claimed: 0, processed: 0, completed: 0, requeued: 0,
      failed: 0, noWork: true, durationMs: 3, automaticSpendRupees: 0,
    });
    // The batch is still "queued" — but noWork short-circuits.
    getBatchMock.mockReset().mockResolvedValue({
      id: BATCH.id, status: "queued", requestedGoal: "screen_trade_activity",
      totalJobs: 1, queuedCount: 1, runningCount: 0, completedCount: 0,
      partialCount: 0, needsReviewCount: 0, failedCount: 0, cancelledCount: 0,
      corroboratedCount: 0, automaticSpendRupees: 0, createdAt: "2026-09-26T00:00:00Z",
    });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([REQUEST]);
    expect(result.outcome).toBe("created");
    expect(drainMock).toHaveBeenCalledTimes(1);
  });

  it("kick loop stops at INLINE_KICK_MAX_ITERATIONS even if batch stays non-terminal", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    getBatchMock.mockReset().mockResolvedValue({
      id: BATCH.id, status: "running", requestedGoal: "screen_trade_activity",
      totalJobs: 1, queuedCount: 0, runningCount: 1, completedCount: 0,
      partialCount: 0, needsReviewCount: 0, failedCount: 0, cancelledCount: 0,
      corroboratedCount: 0, automaticSpendRupees: 0, createdAt: "2026-09-26T00:00:00Z",
    });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([REQUEST]);
    // Bounded: even under worst-case non-terminal state, the loop is
    // capped at INLINE_KICK_MAX_ITERATIONS. It never runs unbounded.
    expect(drainMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("BI4F 2A vercel.json — Hobby-compatible daily cron", () => {
  const HERE = process.cwd();
  const config = JSON.parse(readFileSync(path.resolve(HERE, "vercel.json"), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const entry = config.crons?.find((c) => c.path === "/api/cron/trade-research-drain");

  it("has a single daily cron entry (Hobby-plan compatible)", () => {
    expect(entry).toBeDefined();
    // Hobby plans support daily crons (0..23 in the hour field, day/month/dow *).
    // Accept anything that starts with a fixed minute + fixed hour + '* * *'.
    expect(entry?.schedule).toMatch(/^\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\*$/);
  });

  it("is NOT a per-minute schedule (the previous cadence hobby doesn't allow)", () => {
    expect(entry?.schedule).not.toMatch(/^\*\/\d+\s/);
    expect(entry?.schedule).not.toBe("*/2 * * * *");
    expect(entry?.schedule).not.toBe("* * * * *");
  });
});
