import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const runProof = vi.hoisted(() => vi.fn());
vi.mock("@/lib/marketIntelligence/server/baciProofMaintenance", () => ({
  runControlledBaciProof: runProof,
}));

const URL = "https://outreach.mdfexport.com/api/internal/market-intelligence/baci-proof";
const originalBase = process.env.APP_BASE_URL;

function request(origin = "https://outreach.mdfexport.com", body?: string) {
  return new Request(URL, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

beforeEach(() => {
  process.env.APP_BASE_URL = "https://outreach.mdfexport.com";
  runProof.mockReset();
});
afterEach(() => {
  if (originalBase === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBase;
});

describe("MI1D explicit BACI proof route", () => {
  it("is POST-only and rejects cross-origin before authority", async () => {
    const route = await import("./route");
    expect((route as { GET?: unknown }).GET).toBeUndefined();
    const response = await route.POST(request("https://attacker.example"));
    expect(response.status).toBe(403);
    expect(runProof).not.toHaveBeenCalled();
  });

  it("ignores body-controlled provider, HS code, rows, provenance, and scores", async () => {
    const { POST } = await import("./route");
    runProof.mockResolvedValue({
      outcome: "cache_incomplete",
      message: "The fetch ledger is fresh but the persisted proof observations are incomplete.",
    });
    const response = await POST(request(undefined, JSON.stringify({
      provider: "paid",
      hsCode: "090422",
      tradeRows: [{ value: 999 }],
      publishedFitScore: 100,
    })));
    expect(response.status).toBe(502);
    expect(runProof).toHaveBeenCalledWith();
  });

  it("contains no request-body parser, API key, buyer write, or Market Fit publication", () => {
    const source = readFileSync(path.resolve(
      process.cwd(),
      "src/app/api/internal/market-intelligence/baci-proof/route.ts",
    ), "utf8");
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer)\(/);
    expect(source).not.toMatch(/BACI_OEC_API_KEY|buyer_trade_observations|published_fit_score|composeMarketFit/);
    expect(source).toContain('import "server-only"');
  });
});
