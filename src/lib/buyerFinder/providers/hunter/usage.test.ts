import { describe, it, expect, vi } from "vitest";
import { HunterDiscoveryError } from "./errors";
import { HunterUsageProvider, HUNTER_USAGE_URL } from "./usage";
import {
  HUNTER_USAGE_EMPTY_REQUESTS_FIXTURE,
  HUNTER_USAGE_OVER_ALLOCATION_FIXTURE,
  HUNTER_USAGE_SPLIT_FIXTURE,
  HUNTER_USAGE_UNIFIED_FIXTURE,
  HUNTER_USAGE_ZERO_AVAILABLE_FIXTURE,
} from "./__fixtures__/usage";

const API_KEY = "test-hunter-key-DO-NOT-LEAK";

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
  return new HunterUsageProvider({ apiKey: API_KEY, fetchImpl, timeoutMs: extra?.timeoutMs });
}

describe("HunterUsageProvider", () => {
  it("GETs the usage endpoint with X-API-KEY only, never in the URL", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse(HUNTER_USAGE_UNIFIED_FIXTURE));
    await provider(fetchImpl).getUsage();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HUNTER_USAGE_URL);
    expect(calls[0]?.url).not.toContain("api_key");
    expect(calls[0]?.url).not.toContain("api_key=");
    expect(calls[0]?.url).not.toContain(API_KEY);
    expect(calls[0]?.init.method).toBe("GET");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("X-API-KEY")).toBe(API_KEY);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("Authorization")).toBeNull();
    const rawHeaders = calls[0]?.init.headers as Record<string, string>;
    expect(rawHeaders).not.toHaveProperty("Authorization");
  });

  it("parses unified credits and reset_date", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_USAGE_UNIFIED_FIXTURE));
    const usage = await provider(fetchImpl).getUsage();
    expect(usage.provider).toBe("hunter");
    expect(usage.resetDate).toBe("2026-09-17");
    expect(usage.unifiedCredits).toEqual({
      used: 8,
      available: 50,
      remaining: 42,
      percentUsed: 16,
    });
    expect(usage.searches).toBeUndefined();
    expect(usage.verifications).toBeUndefined();
  });

  it("parses separate searches and verifications without inventing unified credits", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_USAGE_SPLIT_FIXTURE));
    const usage = await provider(fetchImpl).getUsage();
    expect(usage.unifiedCredits).toBeUndefined();
    expect(usage.searches).toEqual({
      used: 10,
      available: 50,
      remaining: 40,
      percentUsed: 20,
    });
    expect(usage.verifications).toEqual({
      used: 5,
      available: 50,
      remaining: 45,
      percentUsed: 10,
    });
    expect(usage.resetDate).toBe("2026-09-04");
  });

  it("handles missing optional buckets", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_USAGE_EMPTY_REQUESTS_FIXTURE));
    const usage = await provider(fetchImpl).getUsage();
    expect(usage.resetDate).toBe("2026-09-17");
    expect(usage.unifiedCredits).toBeUndefined();
    expect(usage.searches).toBeUndefined();
    expect(usage.verifications).toBeUndefined();
  });

  it("clamps percent used at 100 when used exceeds available", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_USAGE_OVER_ALLOCATION_FIXTURE));
    const usage = await provider(fetchImpl).getUsage();
    expect(usage.unifiedCredits?.percentUsed).toBe(100);
  });

  it("available=0 is a safe zero percent", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_USAGE_ZERO_AVAILABLE_FIXTURE));
    const usage = await provider(fetchImpl).getUsage();
    expect(usage.unifiedCredits?.percentUsed).toBe(0);
    expect(usage.unifiedCredits?.remaining).toBe(0);
  });

  it("maps HTTP errors to typed codes without leaking the API key", async () => {
    const cases: Array<[number, HunterDiscoveryError["code"]]> = [
      [401, "unauthorized"],
      [429, "rate_limited"],
      [500, "provider_unavailable"],
    ];
    for (const [status, code] of cases) {
      const { fetchImpl } = captureFetch(() =>
        jsonResponse({ errors: [{ details: `failed ${API_KEY}` }] }, status),
      );
      try {
        await provider(fetchImpl).getUsage();
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
    await expect(provider(fetchImpl).getUsage()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps malformed usage payloads safely", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ data: [] }));
    await expect(provider(fetchImpl).getUsage()).rejects.toMatchObject({
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
      await provider(fetchImpl, { timeoutMs: 20 }).getUsage();
      throw new Error("expected timeout");
    } catch (err) {
      expect(err).toBeInstanceOf(HunterDiscoveryError);
      expect((err as HunterDiscoveryError).code).toBe("timeout");
      expect((err as HunterDiscoveryError).message).not.toContain(API_KEY);
    }
  });
});
