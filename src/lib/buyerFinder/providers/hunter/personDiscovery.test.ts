import { describe, expect, it, vi } from "vitest";
import { HunterDiscoveryError } from "./errors";
import {
  HUNTER_MULTI_DOMAIN_SEARCH_URL,
  HunterPersonDiscoveryProvider,
} from "./personDiscovery";
import { HUNTER_MULTI_DOMAIN_SUCCESS_FIXTURE } from "./__fixtures__/multiDomainSuccess";

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

function provider(fetchImpl: typeof fetch) {
  return new HunterPersonDiscoveryProvider({ apiKey: API_KEY, fetchImpl });
}

describe("HunterPersonDiscoveryProvider", () => {
  it("POSTs to Multi-Domain Search with company_name, type=personal, and no pagination cursor", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse({ data: [] }));
    await provider(fetchImpl).findPeople({
      companyName: "Mahmood & Sons",
      domain: "mahmoodsons.com",
      limit: 25,
    });
    expect(calls).toHaveLength(1);
    const requested = new URL(calls[0]!.url);
    expect(requested.origin + requested.pathname).toBe(HUNTER_MULTI_DOMAIN_SEARCH_URL);
    expect(requested.searchParams.get("company_name")).toBe("Mahmood & Sons");
    expect(requested.searchParams.get("type")).toBe("personal");
    expect(requested.searchParams.has("api_key")).toBe(false);
    expect(requested.searchParams.has("search_after")).toBe(false);
    expect(requested.searchParams.has("decision_maker")).toBe(false);
    expect(requested.pathname).toBe("/v2/multi-domain-search");
    expect(requested.pathname).not.toContain("reveal");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("X-API-KEY")).toBe(API_KEY);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ company_name: "Mahmood & Sons", type: "personal", limit: 25 });
    expect(body).not.toHaveProperty("search_after");
    expect(body).not.toHaveProperty("decision_maker");
    expect(body).not.toHaveProperty("domain");
  });

  it("caps the request limit at 25 and never follows next_search_after", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse(HUNTER_MULTI_DOMAIN_SUCCESS_FIXTURE));
    const result = await provider(fetchImpl).findPeople({
      companyName: "Mahmood & Sons",
      domain: "mahmoodsons.com",
      limit: 100,
    });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.limit).toBe(25);
    expect(result.hasMore).toBe(true);
  });

  it("maps supported masked fields and skips malformed Beta rows", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(HUNTER_MULTI_DOMAIN_SUCCESS_FIXTURE));
    const result = await provider(fetchImpl).findPeople({
      companyName: "Mahmood & Sons",
      domain: "mahmoodsons.com",
    });
    expect(result.people).toHaveLength(3);
    const first = result.people[0]!;
    expect(first.maskedName).toBe("Amina K.");
    expect(first.position).toBe("Head of Procurement");
    expect(first.department).toBe("finance");
    expect(first.seniority).toBe("senior");
    expect(first.decisionMaker).toBe(true);
    expect(first.emailType).toBe("personal");
    expect(first.verificationStatus).toBe("valid");
    expect(first.fullNameAvailable).toBe(true);
    expect(first.linkedinAvailable).toBe(true);
    expect(first.phoneAvailable).toBe(false);
    expect(first.domain).toBe("mahmoodsons.com");
    expect(first.source).toBe("hunter");
    expect(first.providerRef).toBe("handle-procurement-same-domain");
    expect(first.evidence[0]?.note).toMatch(/Hunter masked professional record/i);
    expect(first.evidence[0]?.note).not.toMatch(/verified buyer|verified importer/i);
  });

  it("never copies actual email, LinkedIn URL, or phone from a poisoned Beta row", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({
        data: [
          {
            reveal_handle: "handle-poison",
            name: "Poison P.",
            position: "Buyer",
            domain: "mahmoodsons.com",
            value: "secret@mahmoodsons.com",
            email: "secret@mahmoodsons.com",
            linkedin: "https://www.linkedin.com/in/poison",
            phone_number: "+9710000000",
            full_name_exists: true,
            linkedin_exists: true,
            phone_number_exists: true,
          },
        ],
      }),
    );
    const result = await provider(fetchImpl).findPeople({
      companyName: "Mahmood & Sons",
      domain: "mahmoodsons.com",
    });
    const person = result.people[0]!;
    const serialized = JSON.stringify(person);
    expect(serialized).not.toMatch(/secret@mahmoodsons\.com/);
    expect(serialized).not.toMatch(/linkedin\.com\/in\/poison/);
    expect(serialized).not.toMatch(/\+9710000000/);
    expect(person).not.toHaveProperty("businessEmail");
    expect(person).not.toHaveProperty("linkedinUrl");
    expect(person).not.toHaveProperty("phone");
    expect(person.linkedinAvailable).toBe(true);
    expect(person.phoneAvailable).toBe(true);
  });

  it("rejects malformed Beta JSON as invalid_response", async () => {
    const { fetchImpl } = captureFetch(
      () => new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(
      provider(fetchImpl).findPeople({ companyName: "Mahmood & Sons", domain: "mahmoodsons.com" }),
    ).rejects.toMatchObject({ code: "invalid_response" } satisfies Partial<HunterDiscoveryError>);
  });

  it("rejects a non-array data payload as invalid_response", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ data: { unexpected: true } }));
    await expect(
      provider(fetchImpl).findPeople({ companyName: "Mahmood & Sons", domain: "mahmoodsons.com" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("treats null data as no people", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ data: null }));
    const result = await provider(fetchImpl).findPeople({
      companyName: "Mahmood & Sons",
      domain: "mahmoodsons.com",
    });
    expect(result).toEqual({ people: [], hasMore: false });
  });

  it("does not put the API key in thrown errors", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ errors: [] }, 401));
    await expect(
      provider(fetchImpl).findPeople({ companyName: "Mahmood & Sons", domain: "mahmoodsons.com" }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(HunterDiscoveryError);
      expect(String(err)).not.toContain(API_KEY);
      return true;
    });
  });
});
