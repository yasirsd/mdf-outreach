import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const syncCurrentMarketProductMappingsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/marketIntelligence/server/mappingSyncMaintenance", () => ({
  syncCurrentMarketProductMappings: syncCurrentMarketProductMappingsMock,
}));

const ROUTE_URL = "https://outreach.mdfexport.com/api/internal/market-intelligence/sync-mappings";
const ORIGINAL_APP_BASE_URL = process.env.APP_BASE_URL;

function request(options: { origin?: string; fetchSite?: string; body?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.fetchSite !== undefined) headers.set("sec-fetch-site", options.fetchSite);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(ROUTE_URL, {
    method: "POST",
    headers,
    body: options.body,
  });
}

function sameOriginRequest(body?: string) {
  return request({
    origin: "https://outreach.mdfexport.com",
    fetchSite: "same-origin",
    body,
  });
}

beforeEach(() => {
  process.env.APP_BASE_URL = "https://outreach.mdfexport.com";
  syncCurrentMarketProductMappingsMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_APP_BASE_URL === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = ORIGINAL_APP_BASE_URL;
});

describe("MI1C.2 internal mapping-sync route", () => {
  it("is POST-only: no GET handler is exported", async () => {
    const route = await import("./route");
    expect((route as unknown as { GET?: unknown }).GET).toBeUndefined();
  });

  it("rejects missing, malformed, cross-origin, and cross-site origins before authority", async () => {
    const { POST } = await import("./route");
    for (const badRequest of [
      request(),
      request({ origin: "not a URL" }),
      request({ origin: "https://attacker.example", fetchSite: "cross-site" }),
      request({ origin: "https://outreach.mdfexport.com", fetchSite: "cross-site" }),
    ]) {
      const response = await POST(badRequest);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        outcome: "forbidden",
        message: "Same-origin request required.",
      });
    }
    expect(syncCurrentMarketProductMappingsMock).not.toHaveBeenCalled();
  });

  it("returns unauthorised and forbidden outcomes without leaking internal state", async () => {
    const { POST } = await import("./route");
    syncCurrentMarketProductMappingsMock
      .mockResolvedValueOnce({
        outcome: "unauthorised",
        registryVersion: "mi-product-map-v1",
        message: "MDF session required to run market-mapping sync.",
      })
      .mockResolvedValueOnce({
        outcome: "forbidden",
        registryVersion: "mi-product-map-v1",
        message: "Global market-mapping synchronisation requires an MDF owner role.",
      });

    const unauthorised = await POST(sameOriginRequest());
    expect(unauthorised.status).toBe(401);
    expect((await unauthorised.json()).outcome).toBe("unauthorised");

    const forbidden = await POST(sameOriginRequest());
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).outcome).toBe("forbidden");
  });

  it("returns a sanitized configuration error before a Secret API Key exists", async () => {
    const { POST } = await import("./route");
    syncCurrentMarketProductMappingsMock.mockResolvedValueOnce({
      outcome: "configuration_error",
      registryVersion: "mi-product-map-v1",
      message: "Market Intelligence server writer is not configured on this server.",
    });
    const response = await POST(sameOriginRequest());
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json).toEqual({
      outcome: "configuration_error",
      registryVersion: "mi-product-map-v1",
      message: "Market Intelligence server writer is not configured on this server.",
    });
    expect(JSON.stringify(json)).not.toMatch(/SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)|sb_secret_|jwt|postgres|stack/i);
  });

  it("returns only exact sanitized sync counts for a successful owner operation", async () => {
    const { POST } = await import("./route");
    syncCurrentMarketProductMappingsMock.mockResolvedValueOnce({
      outcome: "synced",
      registryVersion: "mi-product-map-v1",
      summary: {
        outcome: "synced",
        registryVersion: "mi-product-map-v1",
        created: 5,
        updated: 1,
        reactivated: 2,
        deactivated: 3,
        unchanged: 4,
      },
    });
    const response = await POST(sameOriginRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "synced",
      registryVersion: "mi-product-map-v1",
      summary: { created: 5, updated: 1, reactivated: 2, deactivated: 3, unchanged: 4 },
    });
  });

  it("never parses or forwards body-controlled mappings, versions, products, SQL, or RPC names", async () => {
    const { POST } = await import("./route");
    syncCurrentMarketProductMappingsMock.mockResolvedValueOnce({
      outcome: "synced",
      registryVersion: "mi-product-map-v1",
      summary: {
        outcome: "synced", registryVersion: "mi-product-map-v1",
        created: 0, updated: 0, reactivated: 0, deactivated: 0, unchanged: 5,
      },
    });
    const response = await POST(sameOriginRequest(JSON.stringify({
      mappings: [{ hs_code: "INJECTED" }],
      registryVersion: "attacker-version",
      productId: "attacker-product",
      sql: "drop table buyers",
      rpc: "attacker_rpc",
    })));
    expect(response.status).toBe(200);
    expect(syncCurrentMarketProductMappingsMock).toHaveBeenCalledTimes(1);
    expect(syncCurrentMarketProductMappingsMock.mock.calls[0]).toHaveLength(0);
    expect(JSON.stringify(await response.json())).not.toMatch(/INJECTED|attacker|drop table/i);
  });
});

describe("MI1C.2 route isolation and immutable migration guardrails", () => {
  const root = process.cwd();
  const routeSource = readFileSync(path.resolve(root,
    "src/app/api/internal/market-intelligence/sync-mappings/route.ts"), "utf8");
  const actionSource = readFileSync(path.resolve(root,
    "src/lib/marketIntelligence/server/actions.ts"), "utf8");
  const maintenanceSource = readFileSync(path.resolve(root,
    "src/lib/marketIntelligence/server/mappingSyncMaintenance.ts"), "utf8");

  it("imports only server-safe authority code and exposes no client/key/provider surface", () => {
    expect(routeSource).toContain('import "server-only"');
    expect(routeSource).toContain("syncCurrentMarketProductMappings");
    expect(routeSource).not.toMatch(/use client|SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)|NEXT_PUBLIC_.*SERVICE_ROLE/);
    expect(routeSource).not.toMatch(/@\/lib\/marketIntelligence\/server\/(writer|serviceRoleClient)/);
    expect(routeSource).not.toMatch(/request\.(json|formData|text|arrayBuffer)\(/);
    expect(routeSource).not.toMatch(/searchParams/);
    for (const source of [routeSource, actionSource, maintenanceSource]) {
      expect(source).not.toMatch(/fetch\s*\(|BACI|Hunter|api\.oec|api\.hunter/i);
      expect(source).not.toMatch(/use client/);
    }
  });

  it("keeps applied migrations 0022 and 0023 content-identical across line endings", () => {
    const hash = (relative: string) => createHash("sha256")
      .update(readFileSync(path.resolve(root, relative), "utf8").replace(/\r\n/g, "\n"))
      .digest("hex");
    expect(hash("supabase/migrations/0022_market_intelligence_foundation.sql"))
      .toBe("eb6ba7077c957664f64f3b8595ab26dfb30953416508a9fb7bbb8cb0147357e3");
    expect(hash("supabase/migrations/0023_market_product_mapping_sync.sql"))
      .toBe("eec6892b0c69f8c28b070fd8aef4cd699961eaf159d94cb2a62a43e70b95bdda");
  });
});
