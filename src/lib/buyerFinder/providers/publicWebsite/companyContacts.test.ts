import { describe, expect, it, vi } from "vitest";
import { createPublicWebsiteCompanyContactProvider } from "./companyContacts";

const PUBLIC_IP = "8.8.8.8";

function headers(map: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) normalized[k.toLowerCase()] = v;
  return {
    get(name: string) {
      return normalized[name.toLowerCase()] ?? null;
    },
  };
}

function bodyOf(text: string): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

function html(body: string, extra: Record<string, string> = {}) {
  return {
    status: 200,
    headers: headers({ "content-type": "text/html; charset=utf-8", ...extra }),
    body: bodyOf(body),
  };
}

function text(body: string, status = 200) {
  return {
    status,
    headers: headers({ "content-type": "text/plain" }),
    body: bodyOf(body),
  };
}

function redirect(location: string, status = 302) {
  return {
    status,
    headers: headers({ location }),
    body: bodyOf(""),
  };
}

function lookupFor(hostnames: Record<string, string[]> = {}) {
  return async (hostname: string) => {
    if (hostnames[hostname]) return hostnames[hostname];
    if (hostname.endsWith("company.com") || hostname === "company.com") return [PUBLIC_IP];
    return [PUBLIC_IP];
  };
}

describe("PublicWebsiteCompanyContactProvider", () => {
  it("extracts a published mailto and does not guess info@", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("robots.txt")) return text("User-agent: *\nDisallow:");
      return html(`<a href="mailto:procurement@company.com">P</a><p>Hello</p>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      website: "https://company.com",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.emails.map((e) => e.email)).toEqual(["procurement@company.com"]);
    expect(result.emails[0]?.source).toBe("company_website");
    expect(result.emails[0]?.sourceUrl).toMatch(/^https:\/\/company\.com/);
    expect(result.emails.map((e) => e.email)).not.toContain("info@company.com");
  });

  it("retains a published Gmail mailbox as external", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("robots.txt")) return text("");
      return html(`<p>Email trade@gmail.com</p>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com",
      domain: "company.com",
    });
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0]?.email).toBe("trade@gmail.com");
    expect(result.emails[0]?.mailboxKind).toBe("external");
  });

  it("recognizes a corporate mailbox", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("robots.txt")) return text("");
      return html(`<p>imports@company.com</p>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      domain: "company.com",
      website: "https://company.com",
    });
    expect(result.emails[0]?.mailboxKind).toBe("corporate");
    expect(result.emails[0]?.mailboxType).toBe("imports");
  });

  it("rejects DNS that resolves to a private IP and does not parse a body", async () => {
    const fetch = vi.fn(async () => html(`<p>info@company.com</p>`));
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: async () => ["10.0.0.8"],
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com",
      domain: "company.com",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.emails).toEqual([]);
    expect(result.outcome).toBe("unavailable");
  });

  it("rejects a redirect to a private IP", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url) === "https://company.com/") return redirect("http://127.0.0.1/");
      return html("<p>x</p>");
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.emails).toEqual([]);
  });

  it("records sanitized redirect/TLS diagnostics on a homepage hop without a fake status", async () => {
    const fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return text("");
      if (u.startsWith("https://company.com/") || u.startsWith("http://company.com/")) {
        return redirect("https://www.company.com/");
      }
      throw Object.assign(new Error("Hostname/IP does not match certificate's altnames"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      });
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("unavailable");
    expect(result.emails).toEqual([]);
    const httpsHome = result.pageAttempts?.find((a) => a.url.startsWith("https://company.com/"));
    expect(httpsHome?.outcome).toBe("http_error");
    expect(httpsHome?.statusCode).toBeUndefined();
    expect(httpsHome?.transportStage).toBe("tls");
    expect(httpsHome?.safeErrorCode).toBe("TLS_NAME_ERROR");
    expect(httpsHome?.redirectOccurred).toBe(true);
    expect(httpsHome?.redirectTargetHost).toBe("www.company.com");
    expect(httpsHome?.redirectTargetPath).toBe("/");
    expect(JSON.stringify(result.pageAttempts)).not.toMatch(/BEGIN CERTIFICATE|8\.8\.8\.8/);
  });

  it("rejects a redirect to an unrelated domain", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url) === "https://company.com/") return redirect("https://evil.com/phish");
      if (String(url).includes("evil.com")) return html("<p>stolen@evil.com</p>");
      if (String(url).includes("robots.txt")) return text("");
      return html("<p>no mail here</p>");
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor({ "evil.com": ["1.1.1.1"], "company.com": [PUBLIC_IP] }),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.emails).toEqual([]);
  });

  it("follows a same-company www redirect", async () => {
    const fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u === "https://company.com/" || u === "https://company.com") {
        return redirect("https://www.company.com/");
      }
      if (u.includes("robots.txt")) return text("");
      return html(`<p>sales@company.com</p>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.emails[0]?.email).toBe("sales@company.com");
  });

  it("does not crawl more than 4 HTML pages", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url) => {
      requested.push(String(url));
      if (String(url).includes("robots.txt")) return text("User-agent: *\nDisallow:");
      if (String(url).includes("company.com") && !String(url).includes("robots")) {
        return html(`
          <a href="/contact">Contact</a>
          <a href="/about">About</a>
          <a href="/company">Company</a>
          <a href="/locations">Locations</a>
          <a href="/reach-us">Reach us</a>
          <p>info@company.com</p>
        `);
      }
      return html("<p></p>");
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    const htmlGets = requested.filter((u) => !u.includes("robots.txt"));
    expect(htmlGets.length).toBeLessThanOrEqual(4);
  });

  it("never generates a guessed mailbox from domain alone", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("robots.txt")) return text("");
      return html(`<html><body><h1>Company</h1></body></html>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com",
      domain: "company.com",
    });
    expect(result.outcome).toBe("no_result");
    expect(result.emails).toEqual([]);
  });

  it("fetches robots.txt through the same pinned GET path", async () => {
    const fetch = vi.fn(async (url: string, init?: { method?: string; pinnedAddresses?: string[] }) => {
      if (String(url).includes("robots.txt")) {
        expect(init?.method).toBe("GET");
        expect(init?.pinnedAddresses).toEqual([PUBLIC_IP]);
        return text("User-agent: *\nDisallow:");
      }
      return html("<p>hello</p>");
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    const robotsCalls = fetch.mock.calls.filter((c) => String(c[0]).includes("robots.txt"));
    expect(robotsCalls.length).toBe(1);
  });

  it("stops further pages once the overall 20s budget is exhausted", async () => {
    let clock = 1_000_000;
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(String(url));
      clock += 15_000;
      if (String(url).includes("robots.txt")) return text("");
      return html(`<a href="/contact">Contact</a><p>info@company.com</p>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
      now: () => clock,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    const extraHtml = requested.filter((u) => u.includes("/contact"));
    expect(extraHtml).toEqual([]);
    expect(result.emails.map((e) => e.email)).toEqual(["info@company.com"]);
    expect(result.outcome).toBe("ok");
  });

  it("keeps a homepage footer email when /contact later times out", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).includes("robots.txt")) return text("");
      if (String(url).includes("/contact")) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      return html(`<footer>info@company.com</footer><a href="/contact">Contact</a>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.emails.map((e) => e.email)).toEqual(["info@company.com"]);
    expect(result.emails[0]?.sourceUrl).toMatch(/^https:\/\/company\.com\/?$/);
  });

  it("does not claim completed no-result when /contact times out with no email", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).includes("robots.txt")) return text("");
      if (String(url).includes("/contact")) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      return html(`<a href="/contact">Contact</a><h1>Company</h1>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("incomplete");
    expect(result.emails).toEqual([]);
  });

  it("returns completed no-result only after selected pages succeed without email", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).includes("robots.txt")) return text("");
      return html(`<a href="/contact">Contact</a><a href="/about-us">About Us</a><h1>Hi</h1>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("no_result");
    expect(result.emails).toEqual([]);
    expect(result.pagesFetched).toBeGreaterThanOrEqual(1);
  });

  it("fetches contact before about when about is listed first", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(String(url));
      if (String(url).includes("robots.txt")) return text("");
      if (String(url).includes("/contact")) return html(`<div>mail@company.com</div>`);
      if (String(url).includes("/about")) return html(`<p>about</p>`);
      return html(`<a href="/about-us">About Us</a><a href="/contact">Contact</a>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    const htmlGets = requested.filter((u) => !u.includes("robots.txt"));
    const contactAt = htmlGets.findIndex((u) => u.includes("/contact"));
    const aboutAt = htmlGets.findIndex((u) => u.includes("/about"));
    expect(contactAt).toBeGreaterThan(0);
    expect(aboutAt).toBeGreaterThan(contactAt);
    expect(result.emails.map((e) => e.email)).toEqual(["mail@company.com"]);
  });

  it("records per-page diagnostics without claiming a completed miss after a timeout", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).includes("robots.txt")) return text("");
      return html(`<footer>info@company.com</footer>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.pageAttempts?.some((a) => a.outcome === "fetched" && a.emailsExtracted >= 1)).toBe(
      true,
    );
    expect(result.pageAttempts?.every((a) => !("html" in a))).toBe(true);
  });

  it("falls back from a sparse apex homepage to www and finds a published contact email", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string, init?: { method?: string; pinnedAddresses?: string[] }) => {
      const u = String(url);
      requested.push(u);
      if (u.includes("robots.txt")) return text("");
      if (u.includes("/contact")) return html(`<div>mail@company.com</div>`);
      if (u.includes("www.company.com")) {
        expect(init?.method).toBe("GET");
        expect(init?.pinnedAddresses).toEqual([PUBLIC_IP]);
        return html(`<a href="/contact">Contact</a>`);
      }
      return html(`<html><body></body></html>`);
    });
    const rawFetch = vi.fn();
    const previous = globalThis.fetch;
    globalThis.fetch = rawFetch as typeof globalThis.fetch;
    try {
      const provider = createPublicWebsiteCompanyContactProvider({
        lookup: lookupFor(),
        fetch,
      });
      const result = await provider.discover({
        candidateId: "c1",
        website: "https://company.com/",
        domain: "company.com",
      });
      expect(result.outcome).toBe("ok");
      expect(result.emails.map((e) => e.email)).toEqual(["mail@company.com"]);
      expect(result.emails[0]?.source).toBe("company_website");
      expect(result.emails[0]?.sourceUrl).toBe("https://www.company.com/contact");
      expect(result.observedWorkingOrigin).toBe("https://www.company.com/");
      expect(result.preferredOrigin).toBe("https://company.com/");
      expect(result.alternateOriginAttempted).toBe(true);
      expect(result.pagesFetched).toBeLessThanOrEqual(4);
      const hostnames = requested.map((u) => new URL(u).hostname);
      expect(hostnames[0]).toBe("company.com");
      expect(hostnames).toContain("www.company.com");
      expect(rawFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("does not request www when the apex homepage already has a useful contact link", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(String(url));
      if (String(url).includes("robots.txt")) return text("");
      if (String(url).includes("/contact")) return html(`<div>mail@company.com</div>`);
      return html(`<a href="/contact">Contact</a>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.emails.map((e) => e.email)).toEqual(["mail@company.com"]);
    expect(result.alternateOriginAttempted).toBe(false);
    expect(result.observedWorkingOrigin).toBeUndefined();
    expect(requested.some((u) => new URL(u).hostname === "www.company.com")).toBe(false);
  });

  it("does not request www when the apex homepage already publishes an email", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(String(url));
      if (String(url).includes("robots.txt")) return text("");
      return html(`<footer>info@company.com</footer>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.emails.map((e) => e.email)).toEqual(["info@company.com"]);
    expect(result.alternateOriginAttempted).toBe(false);
    expect(requested.some((u) => new URL(u).hostname === "www.company.com")).toBe(false);
  });

  it("starts from a persisted www website and does not fetch apex", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(String(url));
      if (String(url).includes("robots.txt")) return text("");
      if (String(url).includes("/contact")) return html(`<div>mail@company.com</div>`);
      return html(`<a href="/contact">Contact</a>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://www.company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.preferredOrigin).toBe("https://www.company.com/");
    expect(result.alternateOriginAttempted).toBe(false);
    expect(result.observedWorkingOrigin).toBeUndefined();
    expect(requested.some((u) => new URL(u).hostname === "company.com")).toBe(false);
    expect(new URL(requested[0] ?? "").hostname).toBe("www.company.com");
  });

  it("does not treat a blank 200 www homepage as a working origin", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (String(url).includes("robots.txt")) return text("");
      return html(`<html><body></body></html>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("no_result");
    expect(result.alternateOriginAttempted).toBe(true);
    expect(result.observedWorkingOrigin).toBeUndefined();
    expect(result.emails).toEqual([]);
  });

  it("returns incomplete when a sparse apex is followed by a www timeout", async () => {
    const fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("www.company.com") && !u.includes("robots.txt")) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      if (u.includes("robots.txt")) return text("");
      return html(`<html><body></body></html>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("incomplete");
    expect(result.observedWorkingOrigin).toBeUndefined();
    expect(result.emails).toEqual([]);
  });

  it("follows a sparse meta-refresh to a same-site entry page", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string, init?: { pinnedAddresses?: string[] }) => {
      const u = String(url);
      requested.push(u);
      if (u.includes("robots.txt")) return text("");
      if (u.includes("/home.html")) {
        expect(init?.pinnedAddresses).toEqual([PUBLIC_IP]);
        return html(`<footer>reachus@company.com</footer>`);
      }
      return html(`<html><head><meta http-equiv="refresh" content="0; url=/home.html"></head></html>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.emails.map((e) => e.email)).toEqual(["reachus@company.com"]);
    expect(result.emails[0]?.sourceUrl).toBe("https://company.com/home.html");
    expect(result.observedWorkingOrigin).toBe("https://company.com/home.html");
    expect(result.clientRedirectAttempted).toBe(true);
    expect(result.staticClientRedirectsDiscovered).toBeGreaterThanOrEqual(1);
    expect(requested.some((u) => new URL(u).hostname === "www.company.com")).toBe(false);
  });

  it("follows a Tenova-style same-script quoted variable redirect", async () => {
    const splash = `<script>
      var redirect = "https://www.company.com/home.html";
      function countDown() {
        if (false) {} else { window.location.href = redirect; }
      }
    </script>`;
    const fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return text("");
      if (u.includes("/home.html")) {
        return html(`<footer>E: reachus@company.com</footer><a href="/reach-us">Reach us</a>`);
      }
      return html(splash);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("ok");
    expect(result.emails.map((e) => e.email)).toEqual(["reachus@company.com"]);
    expect(result.emails[0]?.source).toBe("company_website");
    expect(result.emails[0]?.sourceUrl).toBe("https://www.company.com/home.html");
    expect(result.observedWorkingOrigin).toBe("https://www.company.com/home.html");
    expect(result.clientRedirectOutcome).toBe("ok");
  });

  it("does not declare no_result when a client-redirect destination times out", async () => {
    const fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/home.html")) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      if (u.includes("robots.txt")) return text("");
      return html(`<script>window.location.href = "/home.html";</script>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).toBe("incomplete");
    expect(result.emails).toEqual([]);
    expect(result.clientRedirectAttempted).toBe(true);
  });

  it("terminates an A↔B client-redirect loop without refetching", async () => {
    const counts: Record<string, number> = {};
    const fetch = vi.fn(async (url: string) => {
      const u = String(url).replace(/\/$/, "");
      counts[u] = (counts[u] ?? 0) + 1;
      if (String(url).includes("robots.txt")) return text("");
      if (String(url).includes("/b")) return html(`<script>location.href="/a";</script>`);
      if (String(url).includes("/a")) return html(`<script>location.href="/b";</script>`);
      return html(`<script>location.href="/b";</script>`);
    });
    const provider = createPublicWebsiteCompanyContactProvider({
      lookup: lookupFor(),
      fetch,
    });
    const result = await provider.discover({
      candidateId: "c1",
      website: "https://company.com/",
      domain: "company.com",
    });
    expect(result.outcome).not.toBe("ok");
    expect(result.pagesFetched).toBeLessThanOrEqual(4);
    const htmlA = Object.entries(counts).filter(([u]) => u.endsWith("/a") && !u.includes("robots"));
    const htmlB = Object.entries(counts).filter(([u]) => u.endsWith("/b") && !u.includes("robots"));
    for (const [, n] of [...htmlA, ...htmlB]) expect(n).toBeLessThanOrEqual(1);
  });
});
