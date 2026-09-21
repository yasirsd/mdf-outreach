import { describe, expect, it, vi } from "vitest";
import { buildMalaysiaChilliProofQuery } from "./contract";
import { BaciProviderError } from "./normalize";
import { fetchBaciQuery } from "./server";

const spec = buildMalaysiaChilliProofQuery();
const env = { ...process.env, BACI_OEC_API_KEY: "bot_market_ak_test-only" };

function responseWithStatus(status: number, body?: string, headers: Record<string, string> = {}): Response {
  return new Response(body ?? `stub ${status}`, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * MI1D.3 — Every documented BotMarket / network failure shape must be
 * distinguishable in server logs; the browser sees a sanitized outcome.
 * The pre-fix path collapsed every non-2xx into an opaque "provider_error"
 * with the message "BACI/OEC could not complete the controlled query."
 */
describe("MI1D.3 BACI HTTP classification & sanitized diagnostics", () => {
  it("classifies 401 as invalid_request/auth_error with sanitized detail", async () => {
    const fetchImpl = vi.fn(async () =>
      responseWithStatus(401, JSON.stringify({ detail: "invalid bearer" })),
    );
    let caught: unknown;
    try {
      await fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BaciProviderError);
    const err = caught as BaciProviderError;
    expect(err.outcome).toBe("invalid_request");
    expect(err.diagnostic?.stage).toBe("provider_http");
    expect(err.diagnostic?.httpStatus).toBe(401);
    expect(err.diagnostic?.category).toBe("auth_error");
    expect(err.diagnostic?.sanitizedBody).toContain("invalid bearer");
  });

  it("classifies 403 as invalid_request/auth_error", async () => {
    const fetchImpl = vi.fn(async () => responseWithStatus(403));
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .rejects.toMatchObject({
        outcome: "invalid_request",
        diagnostic: { category: "auth_error", httpStatus: 403 },
      });
  });

  it("classifies 400 / 422 as invalid_request", async () => {
    for (const status of [400, 422] as const) {
      const fetchImpl = vi.fn(async () => responseWithStatus(status));
      await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
        .rejects.toMatchObject({
          outcome: "invalid_request",
          diagnostic: { category: "invalid_request", httpStatus: status },
        });
    }
  });

  it("classifies 404 as invalid_request/not_found (endpoint typo/wrong slug guard)", async () => {
    const fetchImpl = vi.fn(async () => responseWithStatus(404));
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .rejects.toMatchObject({
        outcome: "invalid_request",
        diagnostic: { category: "not_found", httpStatus: 404 },
      });
  });

  it("classifies 429 as quota_exhausted/rate_limited and preserves retry-after", async () => {
    const fetchImpl = vi.fn(async () =>
      responseWithStatus(429, undefined, { "retry-after": "30" }),
    );
    let caught: unknown;
    try {
      await fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env });
    } catch (e) { caught = e; }
    const err = caught as BaciProviderError;
    expect(err.outcome).toBe("quota_exhausted");
    expect(err.diagnostic?.category).toBe("rate_limited");
    expect(err.retryAfter).toBeDefined();
  });

  it("classifies 500 / 502 / 503 as provider_error/upstream_error", async () => {
    for (const status of [500, 502, 503] as const) {
      const fetchImpl = vi.fn(async () => responseWithStatus(status));
      await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
        .rejects.toMatchObject({
          outcome: "provider_error",
          diagnostic: { category: "upstream_error", httpStatus: status },
        });
    }
  });

  it("classifies malformed JSON as provider_error/invalid_json", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .rejects.toMatchObject({
        outcome: "provider_error",
        diagnostic: { stage: "provider_json", category: "invalid_json" },
      });
  });

  it("classifies network failure as provider_error/network_error", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("fetch failed"); });
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .rejects.toMatchObject({
        outcome: "provider_error",
        diagnostic: { stage: "provider_network", category: "network_error" },
      });
  });

  it("classifies abort as timeout with sanitized diagnostic", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")));
      }));
    await expect(fetchBaciQuery(spec, {
      fetchImpl: fetchImpl as typeof fetch,
      env,
      timeoutMs: 1,
    })).rejects.toMatchObject({
      outcome: "timeout",
      diagnostic: { stage: "provider_timeout", category: "timeout" },
    });
  });

  it("hard-scrubs bot_market_ak_ and sb_secret_ if they ever appear in an upstream body", async () => {
    const leaky = JSON.stringify({
      detail: "bearer bot_market_ak_ABCDEFghij123 rejected; sb_secret_XYZ used",
    });
    const fetchImpl = vi.fn(async () => responseWithStatus(401, leaky));
    let caught: unknown;
    try {
      await fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env });
    } catch (e) { caught = e; }
    const body = (caught as BaciProviderError).diagnostic?.sanitizedBody ?? "";
    expect(body).not.toMatch(/bot_market_ak_/);
    expect(body).not.toMatch(/sb_secret_/);
    expect(body).toMatch(/\[REDACTED\]/);
  });

  it("the outgoing request URL never carries the bearer token or the API key", async () => {
    const captured: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(String(input));
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      expect(auth).toBe("Bearer bot_market_ak_test-only");
      return new Response(JSON.stringify({
        columns: ["year", "exporter_id", "exporter_name", "importer_id", "importer_name",
                  "hs_code", "product_name", "hs_revision", "value", "quantity",
                  "unit_abbrevation", "unit_name"],
        rows: [[2024, "ind", "India", "mys", "Malaysia", "090421",
                "Dried Capsicum/Pimenta, neither crushed nor ground", 5, 100, 1, "mt", "Metric Tonne"]],
        count: 1,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env });
    for (const url of captured) {
      expect(url).not.toContain("bot_market_ak_");
      expect(url).not.toContain("Bearer");
      expect(url).not.toContain("BACI_OEC_API_KEY");
    }
  });
});
