import { describe, expect, it } from "vitest";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type {
  FetchLike,
  SafeFetchResponse,
} from "@/lib/buyerFinder/providers/publicWebsite/fetchTypes";
import { planWebsiteResearch } from "./websiteResearch";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    companyName: "Sun Impex",
    website: "https://sunimpex.example",
    domain: "sunimpex.example",
    country: "UAE",
    source: "hunter",
    discoveryStatus: "ready",
    reviewStatus: "approved",
    ...over,
  };
}

/**
 * Minimal FetchLike + node-lookup double so tests never touch the real
 * network or DNS. Every call returns a canned response by URL prefix.
 */
function mockPipeline(routes: Record<string, { status: number; body: string; contentType?: string }>): {
  fetch: FetchLike;
  lookup: (host: string) => Promise<string[]>;
  calls: string[];
} {
  const calls: string[] = [];
  const lookup = async (host: string): Promise<string[]> => {
    if (host === "localhost" || host === "127.0.0.1") return ["127.0.0.1"];
    // A public-looking IPv4 so ssrf.ts accepts it.
    return ["93.184.216.34"];
  };
  async function* iterOne(bytes: Uint8Array): AsyncIterable<Uint8Array> {
    yield bytes;
  }
  const fetch: FetchLike = async (input, init) => {
    const url = input;
    calls.push(url);
    void init;
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) {
      return {
        status: 404,
        headers: new Headers({ "content-type": "text/html" }),
        body: iterOne(new Uint8Array(0)),
      } satisfies SafeFetchResponse;
    }
    const route = routes[key]!;
    const bytes = new TextEncoder().encode(route.body);
    return {
      status: route.status,
      headers: new Headers({
        "content-type": route.contentType ?? "text/html; charset=utf-8",
        "content-length": String(bytes.byteLength),
      }),
      body: iterOne(bytes),
    } satisfies SafeFetchResponse;
  };
  return { fetch, lookup, calls };
}

describe("BI3 planWebsiteResearch — page selection and extraction", () => {
  it("fetches the homepage plus ranked same-domain internal pages and extracts business claims", async () => {
    const homepage = `
      <html><head><meta name="description" content="Kuwait-based specialty foods importer and distributor for the GCC market." /></head>
      <body>
        <p>We are a leading importer of dry red chillies and spices.</p>
        <a href="/about">About us</a>
        <a href="/products">Products</a>
        <a href="https://linkedin.com/company/sun-impex">LinkedIn</a>
      </body></html>
    `;
    const about = `
      <html><body>
        <h1>About</h1>
        <p>Sun Impex is a distributor of premium ingredients across the GCC.</p>
      </body></html>
    `;
    const products = `<html><body><h1>Products</h1><p>Our catalogue features Banganapalli Mango.</p></body></html>`;
    const { fetch, lookup, calls } = mockPipeline({
      "https://sunimpex.example/": { status: 200, body: homepage },
      "https://sunimpex.example/about": { status: 200, body: about },
      "https://sunimpex.example/products": { status: 200, body: products },
    });
    const result = await planWebsiteResearch({
      candidate: candidate(),
      deps: { fetch, lookup },
    });
    expect(result.status).toBe("researched");
    expect(result.pagesFetched).toBe(3);
    expect(result.claimsExtracted).toBeGreaterThan(0);
    // Homepage and about both classified with claims; products has no
    // qualifying claim (no first-person import phrase).
    const kinds = result.pages.filter((p) => p.claims.length > 0).map((p) => p.kind);
    expect(kinds).toContain("homepage");
    expect(kinds).toContain("about");
    // External LinkedIn link was never fetched (mock records every call).
    expect(calls.some((c) => c.includes("linkedin.com"))).toBe(false);
  });

  it("returns invalid_website for a candidate with no website or domain", async () => {
    const { fetch, lookup } = mockPipeline({});
    const result = await planWebsiteResearch({
      candidate: candidate({ website: undefined, domain: undefined }),
      deps: { fetch, lookup },
    });
    expect(result.status).toBe("invalid_website");
    expect(result.pagesFetched).toBe(0);
  });

  it("returns no_evidence when the homepage loads but no qualifying language is found", async () => {
    const html = `<html><body><h1>Welcome</h1><p>Menu.</p></body></html>`;
    const { fetch, lookup } = mockPipeline({
      "https://sunimpex.example/": { status: 200, body: html },
    });
    const result = await planWebsiteResearch({
      candidate: candidate(),
      deps: { fetch, lookup },
    });
    expect(result.status).toBe("no_evidence");
    expect(result.claimsExtracted).toBe(0);
  });

  it("does not fetch an external-domain link even when it appears in the homepage", async () => {
    const homepage = `
      <html><body>
        <p>We import specialty ingredients from around the world.</p>
        <a href="https://not-sunimpex.example/products">Some other site</a>
      </body></html>
    `;
    const { fetch, lookup, calls } = mockPipeline({
      "https://sunimpex.example/": { status: 200, body: homepage },
    });
    await planWebsiteResearch({
      candidate: candidate(),
      deps: { fetch, lookup },
    });
    expect(calls.some((c) => c.startsWith("https://not-sunimpex.example/"))).toBe(false);
  });

  it("returns unsupported_content when the homepage is not HTML", async () => {
    const { fetch, lookup } = mockPipeline({
      "https://sunimpex.example/": {
        status: 200,
        body: "%PDF-1.4",
        contentType: "application/pdf",
      },
    });
    const result = await planWebsiteResearch({
      candidate: candidate(),
      deps: { fetch, lookup },
    });
    expect(["unsupported_content", "unreachable"]).toContain(result.status);
    expect(result.claimsExtracted).toBe(0);
  });

  it("stops at the max page cap even when many internal links are present", async () => {
    const homepage = `
      <html><body>
        <p>We are a leading importer of specialty spices.</p>
        <a href="/about">About</a>
        <a href="/company">Company</a>
        <a href="/products">Products</a>
        <a href="/services">Services</a>
        <a href="/contact">Contact</a>
        <a href="/products/all">More products</a>
      </body></html>
    `;
    const subpage = `<html><body><p>page.</p></body></html>`;
    const { fetch, lookup } = mockPipeline({
      "https://sunimpex.example/": { status: 200, body: homepage },
      "https://sunimpex.example/about": { status: 200, body: subpage },
      "https://sunimpex.example/company": { status: 200, body: subpage },
      "https://sunimpex.example/products": { status: 200, body: subpage },
      "https://sunimpex.example/services": { status: 200, body: subpage },
      "https://sunimpex.example/contact": { status: 200, body: subpage },
      "https://sunimpex.example/products/all": { status: 200, body: subpage },
    });
    const result = await planWebsiteResearch({
      candidate: candidate(),
      deps: { fetch, lookup, maxPages: 4 },
    });
    expect(result.pagesFetched).toBeLessThanOrEqual(4);
  });
});
