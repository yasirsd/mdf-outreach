import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const drainMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tradeResearch/server/worker", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/tradeResearch/server/worker")
  >("@/lib/tradeResearch/server/worker");
  return { ...actual, drainTradeResearch: drainMock };
});

const clientMock = vi.hoisted(() => vi.fn(() => ({ from: () => ({}) } as unknown)));
vi.mock("@/lib/tradeResearch/server/serviceRoleClient", () => ({
  getTradeResearchServiceRoleClient: clientMock,
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  drainMock.mockReset();
  process.env.CRON_SECRET = "cron-token-1234567890";
  process.env.TRADE_RESEARCH_DRAIN_SECRET = "drain-token-abcdefghij";
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

async function req(headers: Record<string, string> = {}) {
  return new Request("https://outreach.mdfexport.com/api/cron/trade-research-drain", {
    method: "GET", headers,
  });
}

describe("BI4F Phase 2A cron scheduler — auth", () => {
  it("rejects a request with no Authorization header (401 forbidden)", async () => {
    const route = await import("./route");
    const response = await route.GET(await req());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.outcome).toBe("forbidden");
    expect(body.safe_error_code).toBe("SCHEDULER_SECRET_REQUIRED");
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token", async () => {
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer wrong-value" }));
    expect(response.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("accepts a valid CRON_SECRET (Vercel-managed path)", async () => {
    drainMock.mockResolvedValueOnce({
      jobsRequested: 2, claimed: 0, processed: 0, completed: 0, requeued: 0,
      failed: 0, noWork: true, durationMs: 5, automaticSpendRupees: 0,
    });
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer cron-token-1234567890" }));
    expect(response.status).toBe(200);
    expect(drainMock).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.outcome).toBe("no_work");
    expect(body.automatic_spend_rupees).toBe(0);
  });

  it("accepts a valid TRADE_RESEARCH_DRAIN_SECRET (operator heartbeat path)", async () => {
    drainMock.mockResolvedValueOnce({
      jobsRequested: 2, claimed: 1, processed: 1, completed: 1, requeued: 0,
      failed: 0, noWork: false, durationMs: 700, automaticSpendRupees: 0,
    });
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer drain-token-abcdefghij" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("processed");
    expect(body.claimed).toBe(1);
    expect(body.completed).toBe(1);
    expect(body.automatic_spend_rupees).toBe(0);
  });

  it("returns 401 when both secrets are unset even with an Authorization header", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.TRADE_RESEARCH_DRAIN_SECRET;
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer anything" }));
    expect(response.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });
});

describe("BI4F Phase 2A cron scheduler — response shape", () => {
  it("no_work is a healthy status (200), not an error", async () => {
    drainMock.mockResolvedValueOnce({
      jobsRequested: 2, claimed: 0, processed: 0, completed: 0, requeued: 0,
      failed: 0, noWork: true, durationMs: 3, automaticSpendRupees: 0,
    });
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer cron-token-1234567890" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("no_work");
    expect(body.no_work).toBe(true);
  });

  it("processed reports counters and remains ₹0 spent", async () => {
    drainMock.mockResolvedValueOnce({
      jobsRequested: 2, claimed: 2, processed: 2, completed: 2, requeued: 0,
      failed: 0, noWork: false, durationMs: 1200, automaticSpendRupees: 0,
    });
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer cron-token-1234567890" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      outcome: "processed",
      jobs_requested: 2, claimed: 2, processed: 2, completed: 2,
      requeued: 0, failed: 0, automatic_spend_rupees: 0,
    });
  });

  it("wraps a thrown worker error into a safe 500 with an operator-friendly error code", async () => {
    drainMock.mockRejectedValueOnce(new Error("boom"));
    const route = await import("./route");
    const response = await route.GET(await req({ authorization: "Bearer cron-token-1234567890" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.outcome).toBe("failed");
    expect(typeof body.safe_error_code).toBe("string");
    expect(body.failed).toBeGreaterThanOrEqual(1);
    expect(body.automatic_spend_rupees).toBe(0);
  });
});

describe("BI4F Phase 2A cron scheduler — safety scan", () => {
  const HERE = process.cwd();
  const body = readFileSync(
    path.resolve(HERE, "src/app/api/cron/trade-research-drain/route.ts"),
    "utf8",
  );

  it("route is GET-only (no POST/PUT/DELETE handlers)", () => {
    expect(body).toContain("export async function GET");
    expect(body).not.toMatch(/export async function (POST|PUT|DELETE)/);
  });

  it("uses timing-safe comparison for secrets, not === on user input", () => {
    expect(body).toMatch(/timingSafeEqual/);
    // The `Buffer.from(a) === Buffer.from(b)` sequence would be a red flag.
    expect(body).not.toMatch(/authorization.*===/);
  });

  it("never writes buyer intelligence rows or invokes ingest RPCs", () => {
    expect(body).not.toMatch(/buyer_trade_observations|buyer_intelligence|ingest_buyer_/);
  });

  it("never mentions any paid provider (ImportYeti / Panjiva / Canada CID / VQIP)", () => {
    expect(body).not.toMatch(/ImportYeti|Panjiva|ImportGenius|Volza|Trademo|Canada CID|VQIP/i);
  });

  it("never spells the drain secret out in a response literal", () => {
    // The token names may be present in identifier form, but no literal
    // response body should include the actual secret values.
    expect(body).not.toMatch(/JSON\.stringify.*TRADE_RESEARCH_DRAIN_SECRET/);
    expect(body).not.toMatch(/JSON\.stringify.*CRON_SECRET/);
  });
});

describe("BI4F Phase 2A cron scheduler — vercel.json cron entry", () => {
  const HERE = process.cwd();
  const config = JSON.parse(readFileSync(path.resolve(HERE, "vercel.json"), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  it("declares the cron path at /api/cron/trade-research-drain", () => {
    expect(Array.isArray(config.crons)).toBe(true);
    expect(config.crons?.some((c) => c.path === "/api/cron/trade-research-drain")).toBe(true);
  });

  it("uses a cron schedule string in the canonical 5-field form", () => {
    const entry = config.crons?.find((c) => c.path === "/api/cron/trade-research-drain");
    expect(entry?.schedule).toMatch(/^\S+\s\S+\s\S+\s\S+\s\S+$/);
  });
});
