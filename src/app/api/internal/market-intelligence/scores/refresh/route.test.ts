import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshPersistedMarketScore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/marketIntelligence/server/scoreRefresh", () => ({
  refreshPersistedMarketScore,
}));

import { POST } from "./route";

const URL = "https://mdf.example/api/internal/market-intelligence/scores/refresh";

function request(body: unknown, origin = "https://mdf.example"): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": origin === "https://mdf.example" ? "same-origin" : "cross-site",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("MI1I score refresh route", () => {
  beforeEach(() => {
    refreshPersistedMarketScore.mockReset();
    refreshPersistedMarketScore.mockResolvedValue({
      outcome: "created",
      dryRun: true,
      country: "MY",
      product: "guntur-dry-red-chilli",
      providerCalls: 0,
      databaseWrites: 0,
    });
  });

  it("accepts exactly one country/product with explicit dryRun", async () => {
    const response = await POST(request({
      country: "MY",
      product: "guntur-dry-red-chilli",
      dryRun: true,
    }));
    expect(response.status).toBe(200);
    expect(refreshPersistedMarketScore).toHaveBeenCalledWith({
      country: "MY",
      product: "guntur-dry-red-chilli",
      dryRun: true,
    });
  });

  it("rejects cross-origin, bulk-shaped, arbitrary, and implicit-write requests", async () => {
    expect((await POST(request({}, "https://evil.example"))).status).toBe(403);
    expect((await POST(request({
      country: ["MY", "US"], product: "guntur-dry-red-chilli", dryRun: true,
    }))).status).toBe(400);
    expect((await POST(request({
      country: "MY", product: "guntur-dry-red-chilli", dryRun: true, provider: "anything",
    }))).status).toBe(400);
    expect((await POST(request({
      country: "MY", product: "guntur-dry-red-chilli",
    }))).status).toBe(400);
    expect(refreshPersistedMarketScore).not.toHaveBeenCalled();
  });
});
