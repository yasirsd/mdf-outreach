import { describe, it, expect, vi } from "vitest";

import { HunterDiscoveryError } from "./errors";
import { HunterCompanyDiscoveryProvider } from "./companyDiscovery";
import { HUNTER_DISCOVER_URL } from "./query";
import { HUNTER_DISCOVER_SUCCESS_FIXTURE } from "./__fixtures__/discoverSuccess";
import type { CompanyDiscoveryQuery } from "../types";

const API_KEY = "test-hunter-key-DO-NOT-LEAK";

const BASE_QUERY: CompanyDiscoveryQuery = {
  country: "Thailand",
  productId: "guntur-dry-red-chilli",
  buyerTypes: ["Importer"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function captureFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const req = init ?? {};
    calls.push({ url, init: req });
    return handler(url, req);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch, extra?: { timeoutMs?: number }) {
  return new HunterCompanyDiscoveryProvider({ apiKey: API_KEY, fetchImpl, timeoutMs: extra?.timeoutMs });
}

describe("HunterCompanyDiscoveryProvider", () => {
  it("POSTs to the Discover endpoint with the key in headers, not the URL", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    await provider(fetchImpl).discover(BASE_QUERY);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HUNTER_DISCOVER_URL);
    expect(calls[0]?.url).not.toContain("api_key");
    expect(calls[0]?.url).not.toContain("api_key=");
    expect(calls[0]?.url).not.toContain(API_KEY);
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("X-API-KEY")).toBe(API_KEY);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("Authorization")).toBeNull();
    const rawHeaders = calls[0]?.init.headers as Record<string, string>;
    expect(rawHeaders).not.toHaveProperty("Authorization");
    expect(JSON.stringify(rawHeaders)).not.toMatch(/Authorization/i);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("does not call paid email/person endpoints or send credit fields (0 credits)", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    await provider(fetchImpl).discover(BASE_QUERY);
    expect(calls[0]?.url).toBe(HUNTER_DISCOVER_URL);
    expect(calls[0]?.url).not.toMatch(/email-finder|people\/find|combined/i);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).not.toHaveProperty("credits");
  });

  it("does not send premium limit or offset on the free-plan request", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    await provider(fetchImpl).discover({ ...BASE_QUERY, limit: 20 });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).not.toHaveProperty("limit");
    expect(body).not.toHaveProperty("offset");
    expect(body).not.toHaveProperty("company_type");
    expect(body).not.toHaveProperty("industry");
  });

  it("honors query.limit locally after the Hunter response", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_DISCOVER_SUCCESS_FIXTURE));
    const hits = await provider(fetchImpl).discover({ ...BASE_QUERY, limit: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.companyName).toBe("Siam Foods Co");
    expect(hits[1]?.companyName).toBe("Gulf Produce Trading");
  });

  it("maps a successful company response and skips malformed records", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_DISCOVER_SUCCESS_FIXTURE));
    const hits = await provider(fetchImpl).discover(BASE_QUERY);
    expect(hits.map((h) => h.companyName)).toEqual([
      "Siam Foods Co",
      "Gulf Produce Trading",
      "Third Ok Imports",
    ]);
    expect(hits.every((h) => h.source === "hunter")).toBe(true);
    expect(hits.every((h) => h.country === "Thailand")).toBe(true);
    expect(hits[0]?.domain).toBe("siam-foods.example");
    expect(hits[0]?.website).toBe("https://siam-foods.example");
    expect(hits[0]?.isImporter).toBeUndefined();
    expect(hits[0]?.isDistributor).toBeUndefined();
    expect(hits[0]?.evidence[0]?.note).toMatch(/directory match only/i);
    expect(hits[0]?.evidence[0]?.note).not.toMatch(/verified importer/i);
    expect(hits[0]?.productRelevance).toBeUndefined();
    expect(hits[0]).not.toHaveProperty("emails_count");
    expect(JSON.stringify(hits[0])).not.toMatch(/emails_count/);
  });

  it("does not fabricate isImporter or isDistributor from search intent", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({
        data: [{ domain: "only-name.example", organization: "Only Name" }],
      }),
    );
    const hits = await provider(fetchImpl).discover({
      ...BASE_QUERY,
      buyerTypes: ["Importer", "Distributor"],
    });
    expect(hits[0]?.isImporter).toBeUndefined();
    expect(hits[0]?.isDistributor).toBeUndefined();
    expect(hits[0]?.buyerType).toBeUndefined();
  });

  it("missing optional Hunter fields do not crash parsing", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({ data: [{ domain: "sparse.example", organization: "Sparse Co" }] }),
    );
    const hits = await provider(fetchImpl).discover(BASE_QUERY);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.city).toBeUndefined();
    expect(hits[0]?.industry).toBeUndefined();
  });

  it("empty Hunter data returns []", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ data: [] }));
    await expect(provider(fetchImpl).discover(BASE_QUERY)).resolves.toEqual([]);
  });

  it("maps HTTP errors to typed codes without leaking the API key", async () => {
    const cases: Array<[number, HunterDiscoveryError["code"]]> = [
      [400, "invalid_request"],
      [401, "unauthorized"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [500, "provider_unavailable"],
    ];
    for (const [status, code] of cases) {
      const { fetchImpl } = captureFetch(() =>
        jsonResponse({ errors: [{ details: `failed ${API_KEY}` }] }, status),
      );
      try {
        await provider(fetchImpl).discover(BASE_QUERY);
        throw new Error(`expected throw for ${status}`);
      } catch (err) {
        expect(err).toBeInstanceOf(HunterDiscoveryError);
        const e = err as HunterDiscoveryError;
        expect(e.code).toBe(code);
        expect(e.message).not.toContain(API_KEY);
        expect(JSON.stringify(e)).not.toContain(API_KEY);
      }
    }
  });

  it("maps invalid JSON safely", async () => {
    const { fetchImpl } = captureFetch(
      () => new Response("{not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(provider(fetchImpl).discover(BASE_QUERY)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("handles timeout via AbortController without leaking the key", async () => {
    const fetchImpl: typeof fetch = vi.fn((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error(`aborted ${API_KEY}`);
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;
    try {
      await provider(fetchImpl, { timeoutMs: 20 }).discover(BASE_QUERY);
      throw new Error("expected timeout");
    } catch (err) {
      expect(err).toBeInstanceOf(HunterDiscoveryError);
      expect((err as HunterDiscoveryError).code).toBe("timeout");
      expect((err as HunterDiscoveryError).message).not.toContain(API_KEY);
    }
  });

  it("does not call the network for invalid ProductKey or country", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    const p = provider(fetchImpl);
    await expect(
      p.discover({ country: "Thailand", productId: "not-real" as string }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(p.discover({ country: "Narnia", productId: "guntur-dry-red-chilli" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(calls).toHaveLength(0);
  });

  it("produces a deterministic request body for the same query", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    const p = provider(fetchImpl);
    await p.discover(BASE_QUERY);
    await p.discover(BASE_QUERY);
    expect(calls[0]?.init.body).toBe(calls[1]?.init.body);
  });
});
