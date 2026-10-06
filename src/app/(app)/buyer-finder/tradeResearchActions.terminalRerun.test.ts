import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TH07 DEFECT 05A-R1 — terminal trade-research reruns.
 *
 * Production evidence: Spunky Food Co. has one job
 *   jobId=be269328-44d0-425b-803d-4c7900fd1a51 status=failed stage=complete
 *   outcome=failed completed_at=2026-10-06T07:27:05Z
 *   contextFingerprint=trctx-v1:eadb9603c451db8f5fdb97a748e08278bef7bf49c4f2d711573f262cc34cc828
 * Clicking "Research trade activity" returned the existing failed row —
 * no new batch/job/attempt was created.
 *
 * Expected contract:
 *   - terminal predecessor (completed/failed/partial/needs_review/cancelled) → NEW job allowed,
 *     carrying supersedes_job_id = predecessor.id; same contextFingerprint OK (DB partial unique
 *     index applies only to active statuses: migration 0029 __one_active_context_idx).
 *   - active predecessor (queued/running/cancel_requested) → outcome="already_active", no new job.
 */

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
const getBatchMock = vi.hoisted(() => vi.fn(async () => undefined as unknown));
const getLatestJobsForContextsMock = vi.hoisted(() => vi.fn(
  async (_items: Array<{ candidateId: string; contextFingerprint: string }>) => new Map<string, unknown>(),
));
const readRepoMock = vi.hoisted(() => vi.fn(() => ({
  getLatestJobsForContexts: getLatestJobsForContextsMock,
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

const drainMock = vi.hoisted(() => vi.fn(async () => ({
  jobsRequested: 1, claimed: 1, processed: 1, completed: 1, requeued: 0,
  failed: 0, noWork: false, durationMs: 42, automaticSpendRupees: 0 as const,
})));
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
  const THAI = { id: "thai-customs-stats", version: "thai-customs-stats-v1", costClass: "free", termsVersion: "open-data-common-v1" };
  const WEB = { id: "public-website", version: "public-website-v1", costClass: "free", termsVersion: "candidate-site-public-content-v1" };
  return {
    FDA_FSVP_DESCRIPTOR: FDA,
    CANADA_CID_DESCRIPTOR: CID,
    FDA_VQIP_DESCRIPTOR: VQIP,
    THAI_CUSTOMS_STATS_DESCRIPTOR: THAI,
    PUBLIC_WEBSITE_DESCRIPTOR: WEB,
    DEFAULT_TRADE_RESEARCH_DESCRIPTORS: [FDA, VQIP, CID, THAI, WEB],
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
const SPUNKY_CANDIDATE_ID = "9a4d22ea-4fa5-4eb1-975f-6275f01d3bcc";
const OLD_FAILED_JOB_ID = "be269328-44d0-425b-803d-4c7900fd1a51";
const SPUNKY_REQUEST = {
  candidateId: SPUNKY_CANDIDATE_ID,
  marketCountryCode: "TH",
  productId: "guntur-dry-red-chilli",
  productForm: null,
  researchGoal: "screen_trade_activity" as const,
};
const NEW_BATCH: TradeResearchBatchSnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "queued",
  requestedGoal: "screen_trade_activity",
  totalJobs: 1, queuedCount: 1, runningCount: 0, completedCount: 0,
  partialCount: 0, needsReviewCount: 0, failedCount: 0, cancelledCount: 0,
  corroboratedCount: 0, automaticSpendRupees: 0, createdAt: "2026-10-06T08:00:00Z",
};

function spunkyRepos() {
  return {
    repos: {
      buyerCandidates: { list: async () => [{ id: SPUNKY_CANDIDATE_ID, companyName: "Spunky Food Co.", country: "Thailand" }] },
      buyerCandidateProductMatches: {
        listByCandidate: async () => [{ candidateId: SPUNKY_CANDIDATE_ID, productId: "guntur-dry-red-chilli" }],
        listByCandidateIds: async () => [{ candidateId: SPUNKY_CANDIDATE_ID, productId: "guntur-dry-red-chilli" }],
      },
    },
  };
}

function seedPredecessor(status: string, jobId: string = OLD_FAILED_JOB_ID): void {
  getLatestJobsForContextsMock.mockImplementationOnce(async (items: Array<{ candidateId: string; contextFingerprint: string }>) => {
    const map = new Map<string, unknown>();
    for (const item of items) {
      map.set(item.contextFingerprint, {
        id: jobId,
        status,
        candidateId: item.candidateId,
        contextFingerprint: item.contextFingerprint,
      });
    }
    return map;
  });
}

beforeEach(() => {
  requireMdfSessionMock.mockReset().mockResolvedValue(OWNER_SESSION);
  revalidatePathMock.mockReset();
  createBatchMock.mockReset();
  drainMock.mockReset().mockResolvedValue({
    jobsRequested: 1, claimed: 1, processed: 1, completed: 1, requeued: 0,
    failed: 0, noWork: false, durationMs: 42, automaticSpendRupees: 0,
  });
  getBatchMock.mockReset().mockResolvedValue({ ...NEW_BATCH, status: "completed" });
  getLatestJobsForContextsMock.mockReset().mockResolvedValue(new Map());
  serverReposMock.mockReset().mockResolvedValue(spunkyRepos());
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TH07 DEFECT 05A-R1 — terminal trade-research rerun", () => {
  for (const terminal of ["failed", "completed", "partial", "needs_review", "cancelled"] as const) {
    it(`terminal predecessor status='${terminal}' → NEW batch + job created; supersedes_job_id = predecessor.id`, async () => {
      seedPredecessor(terminal);
      createBatchMock.mockResolvedValueOnce(NEW_BATCH);
      const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
      const result = await createTradeResearchBatchAction([SPUNKY_REQUEST]);
      expect(createBatchMock).toHaveBeenCalledTimes(1);
      const input = createBatchMock.mock.calls[0]![0] as {
        jobs: Array<{ supersedesJobId: string; context: Record<string, unknown>; contextFingerprint: string }>;
      };
      expect(input.jobs).toHaveLength(1);
      // Supersedes contract — new job carries the old terminal job's id.
      expect(input.jobs[0]!.supersedesJobId).toBe(OLD_FAILED_JOB_ID);
      // Same canonical ResearchContext means same fingerprint; the DB's
      // partial unique index only applies to active statuses so this is OK.
      expect(input.jobs[0]!.contextFingerprint).toMatch(/^trctx-v1:[0-9a-f]{64}$/);
      // The result must be a typed `created` outcome, not already_active.
      expect(result.outcome).toBe("created");
      if (result.outcome === "created") expect(result.jobCount).toBe(NEW_BATCH.totalJobs);
    });
  }

  for (const active of ["queued", "running", "cancel_requested"] as const) {
    it(`active predecessor status='${active}' → outcome='already_active', NO new batch, dedupe preserved`, async () => {
      seedPredecessor(active);
      const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
      const result = await createTradeResearchBatchAction([SPUNKY_REQUEST]);
      expect(createBatchMock).not.toHaveBeenCalled();
      expect(result.outcome).toBe("already_active");
    });
  }

  it("same fingerprint across historical terminal executions is permitted — the fingerprint is a research-context identity, not a globally unique execution id", async () => {
    // Simulate three sequential reruns, each after the previous turned terminal.
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const fingerprintSet = new Set<string>();
    for (let i = 0; i < 3; i++) {
      createBatchMock.mockReset();
      getLatestJobsForContextsMock.mockReset();
      serverReposMock.mockReset().mockResolvedValue(spunkyRepos());
      // Each run: previous run is terminal (failed) OR null for the first run.
      if (i === 0) {
        getLatestJobsForContextsMock.mockResolvedValueOnce(new Map());
      } else {
        seedPredecessor("failed", `prev-${i}`);
      }
      createBatchMock.mockResolvedValueOnce({ ...NEW_BATCH, id: `batch-${i}` });
      const result = await createTradeResearchBatchAction([SPUNKY_REQUEST]);
      expect(result.outcome).toBe("created");
      const input = createBatchMock.mock.calls[0]![0] as { jobs: Array<{ contextFingerprint: string }> };
      fingerprintSet.add(input.jobs[0]!.contextFingerprint);
    }
    // ALL three reruns must emit the SAME canonical fingerprint — the fix must NOT randomize it.
    expect(fingerprintSet.size).toBe(1);
  });

  it("fingerprint is NEVER mutated / randomized to bypass dedupe — same request yields same fingerprint", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    const first = (createBatchMock.mock.calls[0]![0] as { jobs: Array<{ contextFingerprint: string }> }).jobs[0]!.contextFingerprint;
    // reset and call again against another terminal predecessor
    createBatchMock.mockReset();
    getLatestJobsForContextsMock.mockReset();
    serverReposMock.mockReset().mockResolvedValue(spunkyRepos());
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    const second = (createBatchMock.mock.calls[0]![0] as { jobs: Array<{ contextFingerprint: string }> }).jobs[0]!.contextFingerprint;
    expect(first).toBe(second);
  });

  it("new batch id and new job id are produced by the DB (not reusing the predecessor's ids)", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    if (result.outcome !== "created") throw new Error("expected created");
    // The RPC returns a NEW batch id. We assert the test's NEW_BATCH is
    // what the action surfaces; the DB layer (migration 0025 batches +
    // RPC create_buyer_trade_research_batch) generates new UUIDs for
    // both batch and job via `default gen_random_uuid()`.
    expect(result.batch.id).toBe(NEW_BATCH.id);
    expect(result.batch.id).not.toBe("be269328-44d0-425b-803d-4c7900fd1a51");
  });

  it("old terminal predecessor is left immutable — the server action never UPDATEs it, only passes its id into supersedes_job_id", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    // Writer is only called via createBatch (no explicit `update` / `finalize` of the predecessor).
    const writerInstance = writerCtorMock.mock.results[0]!.value as Record<string, unknown>;
    expect(Object.keys(writerInstance).sort()).toEqual([
      "createBatch", "getFreshSnapshot", "getFreshSnapshotByProvider",
    ].sort());
    // No mutation methods on this mock writer; the action never asks for them.
  });

  it("initial Trade Research inline kick fires for the NEW job — drainTradeResearch is invoked after persistence", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    expect(result.outcome).toBe("created");
    // One drain tick is fired as part of the inline kick strategy
    // (invokeTradeResearchDrainStrategy → kickTradeResearchDrain).
    expect(drainMock).toHaveBeenCalled();
  });

  it("TH planner version remains thailand-provider-plan-v1 across the rerun (Defect 02 invariant preserved)", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    const input = createBatchMock.mock.calls[0]![0] as {
      plannerVersion: string;
      jobs: Array<{ context: { providerPlanVersion: string } }>;
    };
    expect(input.plannerVersion).toBe("thailand-provider-plan-v1");
    expect(input.jobs[0]!.context.providerPlanVersion).toBe("thailand-provider-plan-v1");
  });

  it("TH automated plan contains exactly thai-customs-stats + public-website; no manual-only providers", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    const input = createBatchMock.mock.calls[0]![0] as {
      jobs: Array<{ plans: Array<{ providerId: string; eligibility: string }> }>;
    };
    const eligible = input.jobs[0]!.plans.filter((p) => p.eligibility === "eligible").map((p) => p.providerId);
    expect(eligible).toEqual(expect.arrayContaining(["thai-customs-stats", "public-website"]));
    for (const manual of ["thai-dbd", "thai-customs-operator", "thai-fda-importer"]) {
      expect(eligible).not.toContain(manual);
    }
  });

  it("automatic_spend_rupees remains 0 — new job carries no spend (invariant via contract)", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce({ ...NEW_BATCH, automaticSpendRupees: 0 });
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    const result = await createTradeResearchBatchAction([SPUNKY_REQUEST]);
    if (result.outcome !== "created") throw new Error("expected created");
    expect(result.batch.automaticSpendRupees).toBe(0);
  });

  it("US regression: a terminal US predecessor also allows rerun (same contract applies market-neutrally)", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    serverReposMock.mockReset().mockResolvedValueOnce({
      repos: {
        buyerCandidates: { list: async () => [{ id: "00000000-0000-4000-8000-00000000bc01", companyName: "US Co", country: "United States" }] },
        buyerCandidateProductMatches: {
          listByCandidate: async () => [{ candidateId: "00000000-0000-4000-8000-00000000bc01", productId: "guntur-dry-red-chilli" }],
          listByCandidateIds: async () => [{ candidateId: "00000000-0000-4000-8000-00000000bc01", productId: "guntur-dry-red-chilli" }],
        },
      },
    });
    const result = await createTradeResearchBatchAction([{
      candidateId: "00000000-0000-4000-8000-00000000bc01",
      marketCountryCode: "US",
      productId: "guntur-dry-red-chilli",
      productForm: null,
      researchGoal: "screen_trade_activity",
    }]);
    expect(result.outcome).toBe("created");
    const input = createBatchMock.mock.calls[0]![0] as { plannerVersion: string };
    expect(input.plannerVersion).toBe("trade-planner-v1");
  });

  it("Canada regression: a terminal Canadian predecessor also allows rerun", async () => {
    seedPredecessor("failed");
    createBatchMock.mockResolvedValueOnce(NEW_BATCH);
    const { createTradeResearchBatchAction } = await import("./tradeResearchActions");
    serverReposMock.mockReset().mockResolvedValueOnce({
      repos: {
        buyerCandidates: { list: async () => [{ id: "00000000-0000-4000-8000-00000000ca01", companyName: "CA Co", country: "Canada" }] },
        buyerCandidateProductMatches: {
          listByCandidate: async () => [{ candidateId: "00000000-0000-4000-8000-00000000ca01", productId: "guntur-dry-red-chilli" }],
          listByCandidateIds: async () => [{ candidateId: "00000000-0000-4000-8000-00000000ca01", productId: "guntur-dry-red-chilli" }],
        },
      },
    });
    const result = await createTradeResearchBatchAction([{
      candidateId: "00000000-0000-4000-8000-00000000ca01",
      marketCountryCode: "CA",
      productId: "guntur-dry-red-chilli",
      productForm: null,
      researchGoal: "screen_trade_activity",
    }]);
    expect(result.outcome).toBe("created");
    const input = createBatchMock.mock.calls[0]![0] as { plannerVersion: string };
    expect(input.plannerVersion).toBe("trade-planner-v1");
  });

  it("Defect 05A Customs classifier unchanged — classifyFetchFailure returns prefix-specific codes", async () => {
    const { classifyFetchFailure } = await import("@/lib/tradeResearch/thaiCustomsStats");
    const err = new Error("x");
    (err as unknown as { cause: unknown }).cause = { code: "ECONNREFUSED" };
    expect(classifyFetchFailure("CATALOG", err).code).toBe("CATALOG_CONNECT_REFUSED");
  });

  it("Retry scheduler unchanged — migration 0037 is not touched by this fix", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    expect(sql).toMatch(/schedule_trade_research_drain/);
  });

  it("DB partial unique index enforces active-only dedupe (migration 0029 contract)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0029_trade_research_context_binding.sql"),
      "utf8",
    );
    const active = sql.replace(/--[^\n]*/g, "");
    expect(active).toMatch(
      /unique\s+index\s+buyer_trade_research_jobs_one_active_context_idx[\s\S]*?on\s+public\.buyer_trade_research_jobs\s*\(\s*workspace_id,\s*context_fingerprint\s*\)[\s\S]*?where\s+status\s+in\s*\(\s*'queued',\s*'running',\s*'cancel_requested'\s*\)/,
    );
  });
});
