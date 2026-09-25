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
const writerCtorMock = vi.hoisted(() => vi.fn(() => ({
  createBatch: createBatchMock,
  getFreshSnapshot: getFreshSnapshotMock,
})));
const readRepoMock = vi.hoisted(() => vi.fn(() => ({
  getLatestJobsForCandidates: vi.fn(async () => new Map()),
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

vi.mock("@/lib/tradeResearch/providers", () => ({
  FDA_FSVP_DESCRIPTOR: { id: "fda_fsvp", version: "v1" },
  planTradeResearch: () => [
    {
      descriptor: { id: "fda_fsvp", version: "v1", costClass: "free", termsVersion: "v1" },
      role: "primary", eligible: true, reason: "", cacheHit: false,
    },
  ],
}));

import type { TradeResearchBatchSnapshot } from "@/lib/tradeResearch/types";

const OWNER_SESSION = {
  userId: "user-1",
  email: "owner@mdfexport.com",
  membership: { workspaceId: "ws-1", role: "owner" as const },
};
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000001";
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
  drainMock.mockReset().mockResolvedValue({
    jobsRequested: 1, claimed: 1, processed: 1, completed: 1, requeued: 0,
    failed: 0, noWork: false, durationMs: 42, automaticSpendRupees: 0,
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
    const result = await createTradeResearchBatchAction([CANDIDATE_ID]);
    expect(result).toEqual({ outcome: "created", batch: BATCH });
    expect(drainMock).toHaveBeenCalledTimes(1);
    // Bounded kick: exactly one job, capped time budget.
    const kick = drainMock.mock.calls[0]![0] as {
      maxJobs: number; timeBudgetMs: number; workerId: string;
    };
    expect(kick.maxJobs).toBe(1);
    expect(kick.timeBudgetMs).toBeLessThanOrEqual(12_000);
    expect(kick.workerId).toMatch(/^inline-/);
    // Response payload never carries a secret name.
    expect(JSON.stringify(result)).not.toMatch(/TRADE_RESEARCH_DRAIN_SECRET|CRON_SECRET/);
  });

  it("drain failure is absorbed — the created batch is still returned to the caller", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    drainMock.mockRejectedValueOnce(new Error("worker exploded"));
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([CANDIDATE_ID]);
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
    const result = await createTradeResearchBatchAction([CANDIDATE_ID]);
    expect(result).toEqual({ outcome: "created", batch: BATCH });
  });

  it("non-owner cannot even create a batch, so no drain kick is fired", async () => {
    requireMdfSessionMock.mockResolvedValue({ ...OWNER_SESSION, membership: { ...OWNER_SESSION.membership, role: "member" } });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([CANDIDATE_ID]);
    expect(result.outcome).toBe("forbidden");
    expect(createBatchMock).not.toHaveBeenCalled();
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("automatic spend enforcement — the kick's drain callsite forbids paid providers via the shared worker", async () => {
    requireMdfSessionMock.mockResolvedValue(OWNER_SESSION);
    createBatchMock.mockResolvedValueOnce(BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([CANDIDATE_ID]);
    // The action does not pass any `costClass` override to drain — the
    // worker's own PROVIDER_COST_POLICY_VIOLATION guard is authoritative.
    const kick = drainMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(kick.costClass).toBeUndefined();
    expect(kick.automaticSpendRupees).toBeUndefined();
  });
});

describe("BI4F 2A createTradeResearchBatchAction — server-only surface", () => {
  const HERE = process.cwd();
  const body = readFileSync(path.resolve(HERE, "src/app/(app)/buyer-finder/tradeResearchActions.ts"), "utf8");

  it("declares \"use server\" and never exposes the drain secret string", () => {
    expect(body.startsWith('"use server";')).toBe(true);
    expect(body).not.toMatch(/TRADE_RESEARCH_DRAIN_SECRET/);
    expect(body).not.toMatch(/CRON_SECRET/);
    // No client-visible fetch() to the drain route either.
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

  it("kick is bounded — maxJobs = 1, timeBudgetMs ≤ 12000", () => {
    expect(body).toMatch(/INLINE_KICK_JOBS\s*=\s*1\b/);
    expect(body).toMatch(/INLINE_KICK_MS\s*=\s*12_000\b/);
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
