import { describe, expect, it, vi } from "vitest";
import { HunterDiscoveryError } from "./errors";
import {
  HUNTER_MULTI_DOMAIN_REVEAL_URL,
  HunterPersonalContactRevealProvider,
} from "./personalReveal";

const API_KEY = "test-hunter-key-DO-NOT-LEAK";
const HANDLE = "opaque-reveal-handle";

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

function provider(fetchImpl: typeof fetch) {
  return new HunterPersonalContactRevealProvider({ apiKey: API_KEY, fetchImpl });
}

function successBody(over: Record<string, unknown> = {}) {
  return {
    data: [
      {
        reveal_handle: HANDLE,
        email: "aditee@company.com",
        first_name: "Aditee",
        last_name: "Ganatra",
        position: "Chief Operating Officer",
        phone_number: "+97150000000",
        linkedin_url: "https://www.linkedin.com/in/aditee",
        type: "personal",
        domain: "company.com",
        outcome: "revealed",
        ...over,
      },
    ],
    meta: {
      credits_charged: 1,
      handles: [{ handle: HANDLE, outcome: "revealed" }],
    },
  };
}

describe("HunterPersonalContactRevealProvider", () => {
  it("POSTs exactly one handle to Multi-Domain reveal and no other Hunter endpoints", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse(successBody()));
    await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HUNTER_MULTI_DOMAIN_REVEAL_URL);
    expect(calls[0]?.init.method).toBe("POST");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.handles).toEqual([HANDLE]);
    expect(body.handles).toHaveLength(1);
    expect(calls[0]?.url).toBe(HUNTER_MULTI_DOMAIN_REVEAL_URL);
    expect(calls[0]?.url).not.toContain("/v2/domain-search");
    expect(calls[0]?.url).not.toContain("/v2/email-finder");
    expect(calls[0]?.url).not.toContain("/v2/email-verifier");
    expect(calls[0]?.url).not.toContain("/v2/discover");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("X-API-KEY")).toBe(API_KEY);
  });

  it("maps revealed + credits_charged 1", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(successBody()));
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.outcome).toBe("revealed");
    expect(result.creditsCharged).toBe(1);
    expect(result.person?.email).toBe("aditee@company.com");
    expect(result.person?.linkedinUrl).toBe("https://www.linkedin.com/in/aditee");
  });

  it("maps already_revealed + credits_charged 0", async () => {
    const body = successBody({ outcome: "already_revealed" });
    (body.meta as { credits_charged: number; handles: unknown }).credits_charged = 0;
    (body.meta as { handles: Array<{ outcome: string }> }).handles[0]!.outcome = "already_revealed";
    const { fetchImpl } = captureFetch(() => jsonResponse(body));
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.outcome).toBe("already_revealed");
    expect(result.creditsCharged).toBe(0);
  });

  it("maps not_found without fabricating a person email", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({
        data: [{ reveal_handle: HANDLE, outcome: "not_found" }],
        meta: { credits_charged: 0, handles: [{ handle: HANDLE, outcome: "not_found" }] },
      }),
    );
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.outcome).toBe("not_found");
    expect(result.creditsCharged).toBe(0);
  });

  it("treats credits_charged 2 as a contract violation", async () => {
    const body = successBody();
    (body.meta as { credits_charged: number }).credits_charged = 2;
    const { fetchImpl } = captureFetch(() => jsonResponse(body));
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.outcome).toBe("contract_violation");
    expect(result.creditsCharged).toBe(2);
  });

  it("maps 429 insufficient credits to quota_exhausted with 0 credits", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({ errors: [{ id: "insufficient_credits", details: "No credits" }] }, 429),
    );
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.outcome).toBe("quota_exhausted");
    expect(result.creditsCharged).toBe(0);
  });

  it("maps a plain 429 to rate_limited", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ errors: [{ id: "rate_limit" }] }, 429));
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.outcome).toBe("rate_limited");
  });

  it("throws on 401", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({}, 401));
    await expect(provider(fetchImpl).reveal({ providerRef: HANDLE })).rejects.toBeInstanceOf(
      HunterDiscoveryError,
    );
  });

  it("drops unsafe LinkedIn URLs while keeping a valid email", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse(successBody({ linkedin_url: "javascript:alert(1)" })),
    );
    const result = await provider(fetchImpl).reveal({ providerRef: HANDLE });
    expect(result.person?.email).toBe("aditee@company.com");
    expect(result.person?.linkedinUrl).toBeUndefined();
  });
});
