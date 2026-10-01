import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the shared worker and service-role client must be
// declared BEFORE the wrapper module is dynamically imported below.
vi.mock("server-only", () => ({}));

const drainMock = vi.hoisted(() => vi.fn(async () => ({
  jobsRequested: 2, claimed: 0, processed: 0, completed: 0, requeued: 0,
  failed: 0, noWork: true, durationMs: 1, automaticSpendRupees: 0 as const,
})));

vi.mock("@/lib/tradeResearch/server/worker", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tradeResearch/server/worker")>(
    "@/lib/tradeResearch/server/worker",
  );
  return { ...actual, drainTradeResearch: drainMock };
});

const getServiceRoleClientMock = vi.hoisted(() => vi.fn(() => ({ from: () => ({}) } as unknown)));
vi.mock("@/lib/tradeResearch/server/serviceRoleClient", () => ({
  getTradeResearchServiceRoleClient: getServiceRoleClientMock,
}));

const writerCtorMock = vi.hoisted(() => vi.fn(() => ({} as unknown)));
vi.mock("@/lib/tradeResearch/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tradeResearch/repository")>(
    "@/lib/tradeResearch/repository",
  );
  return { ...actual, TradeResearchWriter: writerCtorMock };
});

const SECRET = "test-drain-secret-value-1234567890";

async function loadHandler() {
  // The wrapper file lives outside `src/` because Netlify requires
  // `netlify/functions/*` layout for Background Functions. Vitest
  // resolves the relative path just fine.
  return await import("../../../../netlify/functions/trade-research-drain-background");
}

beforeEach(() => {
  drainMock.mockClear();
  writerCtorMock.mockClear();
  process.env.TRADE_RESEARCH_DRAIN_SECRET = SECRET;
});

describe("T14 Stage 1 — Netlify Background Function wrapper", () => {
  it("rejects a request with NO Authorization header (401, secret-required code)", async () => {
    const { default: handler } = await loadHandler();
    const response = await handler(new Request("https://example.test/.netlify/functions/trade-research-drain-background", { method: "POST" }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ outcome: "forbidden", safe_error_code: "SCHEDULER_SECRET_REQUIRED" });
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("rejects a request with a WRONG bearer secret (401)", async () => {
    const { default: handler } = await loadHandler();
    const response = await handler(new Request("https://example.test/.netlify/functions/trade-research-drain-background", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    }));
    expect(response.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("rejects when the env secret is NOT configured, even if the caller sends a bearer (401)", async () => {
    delete process.env.TRADE_RESEARCH_DRAIN_SECRET;
    const { default: handler } = await loadHandler();
    const response = await handler(new Request("https://example.test/.netlify/functions/trade-research-drain-background", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }));
    expect(response.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("authorized invocation reaches the SHARED drainTradeResearch with the shared deadline", async () => {
    const { default: handler } = await loadHandler();
    const response = await handler(new Request("https://example.test/.netlify/functions/trade-research-drain-background", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("processed");
    // Exactly ONE call to the shared worker — no duplicated provider
    // execution path, no local re-implementation.
    expect(drainMock).toHaveBeenCalledTimes(1);
    const call = drainMock.mock.calls[0] as unknown as [Record<string, unknown>];
    const deps = call[0] as {
      maxJobs: number;
      timeBudgetMs: number;
      workerId: string;
      deadlineAt: number;
    };
    expect(deps.maxJobs).toBe(2);
    expect(deps.timeBudgetMs).toBe(45_000);
    expect(deps.workerId).toMatch(/^netlify-bg-/);
    // Shared 50 s deadline helper — same value the Vercel cron & inline
    // paths use. Cannot equal Number.POSITIVE_INFINITY.
    expect(Number.isFinite(deps.deadlineAt)).toBe(true);
  });

  it("returns a controlled 500 with a safe error code if the drain throws", async () => {
    drainMock.mockRejectedValueOnce(Object.assign(new Error("private detail"), { code: "PGRST999" }));
    const { default: handler } = await loadHandler();
    const response = await handler(new Request("https://example.test/.netlify/functions/trade-research-drain-background", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.outcome).toBe("failed");
    expect(typeof body.safe_error_code).toBe("string");
    // Private DB detail must NEVER leak.
    expect(body.safe_error_code).not.toContain("private detail");
  });

  it("timing-safe comparison — exports `isBackgroundDrainAuthorized` that returns false for a length-mismatched secret", async () => {
    const { isBackgroundDrainAuthorized } = await loadHandler();
    const shortReq = new Request("https://example.test", {
      headers: { authorization: "Bearer x" },
    });
    expect(isBackgroundDrainAuthorized(shortReq)).toBe(false);
    const okReq = new Request("https://example.test", {
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(isBackgroundDrainAuthorized(okReq)).toBe(true);
  });
});
