import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drain: vi.fn(),
  client: vi.fn(() => ({})),
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth/require", () => ({ requireMdfSession: mocks.requireSession }));
vi.mock("@/lib/tradeResearch/server/serviceRoleClient", () => ({
  getTradeResearchServiceRoleClient: mocks.client,
}));
vi.mock("@/lib/tradeResearch/server/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tradeResearch/server/worker")>();
  return { ...actual, drainTradeResearch: mocks.drain };
});

import { TradeResearchDrainExecutionError, type TradeResearchDrainResult } from "@/lib/tradeResearch/server/worker";
import { maxDuration, POST, runtime } from "./route";

const noWork: TradeResearchDrainResult = {
  jobsRequested: 2, claimed: 0, processed: 0, completed: 0, requeued: 0,
  failed: 0, noWork: true, durationMs: 4, automaticSpendRupees: 0,
};

function request(headers: Record<string, string> = { authorization: "Bearer test-drain-secret" }): Request {
  return new Request("https://mdf.example/api/internal/trade-research/drain", {
    method: "POST",
    headers,
  });
}

describe("internal trade research drain response", () => {
  beforeEach(() => {
    process.env.TRADE_RESEARCH_DRAIN_SECRET = "test-drain-secret";
    mocks.drain.mockReset();
    mocks.client.mockClear();
    mocks.client.mockImplementation(() => ({}));
    mocks.requireSession.mockReset();
    mocks.requireSession.mockResolvedValue({ membership: { role: "owner" } });
  });
  afterEach(() => { delete process.env.TRADE_RESEARCH_DRAIN_SECRET; });

  it("initializes as a bounded Node server route", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("returns an explicit no_work 200 when zero jobs were claimed", async () => {
    mocks.drain.mockResolvedValue(noWork);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ outcome: "no_work", claimed: 0, processed: 0, no_work: true, duration_ms: 4 });
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("returns processed counts instead of a generic success", async () => {
    mocks.drain.mockResolvedValue({ ...noWork, claimed: 1, processed: 1, completed: 1, noWork: false, durationMs: 25 });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "processed", claimed: 1, processed: 1, completed: 1, no_work: false });
  });

  it("returns a safe 500 diagnostic for an internal worker exception", async () => {
    mocks.drain.mockRejectedValue(new TradeResearchDrainExecutionError("WORKER_INTERNAL_ERROR", { ...noWork, claimed: 1, noWork: false }));
    const response = await POST(request());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ outcome: "failed", safe_error_code: "WORKER_INTERNAL_ERROR", claimed: 1, failed: 1, no_work: false });
    expect(JSON.stringify(body)).not.toContain("test-drain-secret");
  });

  it("allows a same-origin owner to invoke the bounded drain", async () => {
    mocks.drain.mockResolvedValue(noWork);
    const response = await POST(request({ origin: "https://mdf.example", "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(200);
    expect(mocks.requireSession).toHaveBeenCalledOnce();
  });

  it("rejects a same-origin member without constructing the writer", async () => {
    mocks.requireSession.mockResolvedValueOnce({ membership: { role: "member" } });
    const response = await POST(request({ origin: "https://mdf.example", "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ outcome: "forbidden", safe_error_code: "OWNER_REQUIRED" });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("turns a pre-worker owner-session exception into safe non-empty JSON", async () => {
    mocks.requireSession.mockRejectedValueOnce(new Error("fetch failed: private transport detail"));
    const response = await POST(request({ origin: "https://mdf.example", "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body).toMatchObject({
      outcome: "failed", safe_error_code: "AUTHORIZATION_CHECK_FAILED",
      claimed: 0, processed: 0, failed: 1, no_work: false,
    });
    expect(JSON.stringify(body)).not.toContain("private transport detail");
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it("returns a safe configuration code when the server writer cannot initialize", async () => {
    const error = new Error("SUPABASE_SECRET_KEY");
    error.name = "TradeResearchServiceRoleConfigError";
    mocks.client.mockImplementationOnce(() => { throw error; });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      outcome: "failed", safe_error_code: "SERVICE_ROLE_CONFIGURATION_ERROR",
      claimed: 0, failed: 1,
    });
  });
});
