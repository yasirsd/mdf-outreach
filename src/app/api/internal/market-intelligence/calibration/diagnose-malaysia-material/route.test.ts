import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const runMalaysiaMaterialDiagnostic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/marketIntelligence/server/malaysiaMaterialDiagnostic", () => ({
  runMalaysiaMaterialDiagnostic,
}));

const ROUTE_URL = "https://outreach.mdfexport.com/api/internal/market-intelligence/calibration/diagnose-malaysia-material";
const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL;

function request(origin?: string, fetchSite?: string, body?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  if (fetchSite !== undefined) headers.set("sec-fetch-site", fetchSite);
  return new Request(ROUTE_URL, { method: "POST", headers, body });
}

beforeEach(() => {
  process.env.APP_BASE_URL = "https://outreach.mdfexport.com";
  runMalaysiaMaterialDiagnostic.mockReset();
});

afterEach(() => {
  if (ORIGINAL_APP_BASE_URL === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL;
});

describe("MI1F.2 Malaysia material diagnostic route", () => {
  it("is POST-only and rejects non-same-origin calls before authority", async () => {
    const route = await import("./route");
    expect((route as unknown as { GET?: unknown }).GET).toBeUndefined();
    for (const bad of [
      request(),
      request("not a URL"),
      request("https://attacker.example", "cross-site"),
      request("https://outreach.mdfexport.com", "cross-site"),
    ]) {
      const response = await route.POST(bad);
      expect(response.status).toBe(403);
    }
    expect(runMalaysiaMaterialDiagnostic).not.toHaveBeenCalled();
  });

  it("ignores the request body and returns only the server-derived comparison", async () => {
    runMalaysiaMaterialDiagnostic.mockResolvedValueOnce({
      outcome: "comparison_complete",
      providerRequestsUsed: 1,
      providerRows: 204,
      persistedRows: 204,
      exactMatches: 203,
      mismatches: 1,
      providerOnly: 0,
      persistedOnly: 0,
      mismatchFieldCounts: {
        trade_value_usd: 0,
        quantity: 1,
        quantity_unit: 0,
        net_weight_kg: 0,
        source_period: 0,
        source_url: 0,
        safe_source_ref: 0,
      },
      examples: [],
    });
    const response = await (await import("./route")).POST(request(
      "https://outreach.mdfexport.com",
      "same-origin",
      JSON.stringify({ country: "AE", hs: "090422", write: true }),
    ));
    expect(response.status).toBe(200);
    expect(runMalaysiaMaterialDiagnostic).toHaveBeenCalledWith();
    expect(JSON.stringify(await response.json())).not.toMatch(/AE|090422|write/i);
  });

  it("maps owner, provider, and database failures to sanitized statuses", async () => {
    const { POST } = await import("./route");
    const sameOrigin = () => request("https://outreach.mdfexport.com", "same-origin");
    for (const [outcome, status] of [
      ["unauthorised", 401],
      ["forbidden", 403],
      ["mapping_error", 409],
      ["configuration_error", 503],
      ["invalid_request", 422],
      ["provider_error", 502],
      ["database_error", 500],
    ] as const) {
      runMalaysiaMaterialDiagnostic.mockResolvedValueOnce({
        outcome, providerRequestsUsed: 0, message: "Safe diagnostic message.",
      });
      const response = await POST(sameOrigin());
      expect(response.status).toBe(status);
      expect(JSON.stringify(await response.json())).not.toMatch(/api.?key|authorization|cookie|jwt/i);
    }
  });

  it("never parses body-controlled provider, SQL, or write instructions", () => {
    const body = readFileSync(path.resolve(process.cwd(),
      "src/app/api/internal/market-intelligence/calibration/diagnose-malaysia-material/route.ts"), "utf8");
    expect(body).not.toMatch(/request\.(json|text|formData|arrayBuffer)\(/);
    expect(body).not.toMatch(/searchParams/);
    expect(body).not.toMatch(/writer|ingest|recordFetchResult|market_product_scores|buyer_intelligence/i);
  });
});
