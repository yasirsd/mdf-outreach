import { describe, expect, it, vi } from "vitest";
import {
  PUBLIC_WEBSITE_MAX_BODY_BYTES,
  PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES,
  PUBLIC_WEBSITE_TIMEOUT_MS,
  fetchSafeHtmlPage,
  readCappedBody,
} from "./fetchPage";
import { PUBLIC_WEBSITE_USER_AGENT } from "@/lib/buyerFinder/robotsPolicy";
import { pinnedLookup } from "./pinnedLookup";
import type { PinnedFetchInit, SafeFetchResponse } from "./fetchTypes";
import { isDisallowedIp } from "@/lib/buyerFinder/ssrf";

const PUBLIC_IP = "8.8.8.8";
const PRIVATE_IP = "10.0.0.8";

function headers(map: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) normalized[k.toLowerCase()] = v;
  return {
    get(name: string) {
      return normalized[name.toLowerCase()] ?? null;
    },
  };
}

function bodyOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

function html(body: string, extra: Record<string, string> = {}): SafeFetchResponse {
  return {
    status: 200,
    headers: headers({ "content-type": "text/html; charset=utf-8", ...extra }),
    body: bodyOf(new TextEncoder().encode(body)),
  };
}

function redirect(location: string): SafeFetchResponse {
  return {
    status: 302,
    headers: headers({ location }),
    body: bodyOf(new Uint8Array()),
  };
}

describe("pinnedLookup", () => {
  it("returns only the validated addresses and ignores hostname", () => {
    const addresses: Array<{ address: string; family: number }> = [];
    pinnedLookup(["8.8.8.8", "1.1.1.1"], "company.com", { all: true }, (err, result) => {
      expect(err).toBeNull();
      addresses.push(...(result as Array<{ address: string; family: number }>));
    });
    expect(addresses.map((a) => a.address)).toEqual(["8.8.8.8", "1.1.1.1"]);
  });

  it("cannot be influenced by a private rebind at connect time", () => {
    const validated = [PUBLIC_IP];
    pinnedLookup(validated, "company.com", { all: true }, (err, result) => {
      expect(err).toBeNull();
      const addrs = result as Array<{ address: string }>;
      expect(addrs.map((a) => a.address)).toEqual([PUBLIC_IP]);
      expect(addrs.some((a) => isDisallowedIp(a.address))).toBe(false);
      expect(addrs.map((a) => a.address)).not.toContain(PRIVATE_IP);
    });
  });

  it("uses the first validated public address when lookup.all is false", () => {
    pinnedLookup(["1.1.1.1", "8.8.8.8"], "company.com", { all: false }, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe("1.1.1.1");
      expect(family).toBe(4);
    });
  });
});

describe("fetchSafeHtmlPage — DNS pinning and redirects", () => {
  it("pins the connection to the validated public IP; a private rebind cannot be used", async () => {
    const lookup = vi.fn(async () => [PUBLIC_IP]);
    const fetch = vi.fn(async (_url: string, init: PinnedFetchInit) => {
      expect(init.pinnedAddresses).toEqual([PUBLIC_IP]);
      expect(init.pinnedAddresses.some((a) => isDisallowedIp(a))).toBe(false);
      const reboundWouldBe = [PRIVATE_IP];
      expect(init.pinnedAddresses).not.toEqual(reboundWouldBe);
      return html("<p>sales@company.com</p>");
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup, fetch },
    });
    expect(result.status).toBe("ok");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-resolves and re-pins on each redirect hop", async () => {
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === "www.company.com") return ["1.1.1.1"];
      return [PUBLIC_IP];
    });
    const pins: string[][] = [];
    const fetch = vi.fn(async (url: string, init: PinnedFetchInit) => {
      pins.push(init.pinnedAddresses);
      if (url === "https://company.com/" || url === "https://company.com") {
        return redirect("https://www.company.com/");
      }
      return html("<p>ok</p>");
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup, fetch },
    });
    expect(result.status).toBe("ok");
    expect(pins[0]).toEqual([PUBLIC_IP]);
    expect(pins[1]).toEqual(["1.1.1.1"]);
    expect(lookup).toHaveBeenCalledWith("company.com");
    expect(lookup).toHaveBeenCalledWith("www.company.com");
  });

  it("blocks redirect to localhost / private / metadata", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("company.com") && !url.includes("127")) {
        return redirect("http://127.0.0.1/");
      }
      return html("<p>x</p>");
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("rejected");
  });

  it("blocks redirect to an unrelated site", async () => {
    const fetch = vi.fn(async () => redirect("https://evil.com/phish"));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("rejected");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends GET only with no cookies, auth, referer, or internal tokens", async () => {
    const fetch = vi.fn(async (_url: string, init: PinnedFetchInit) => {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.headers["User-Agent"]).toBe(PUBLIC_WEBSITE_USER_AGENT);
      const names = Object.keys(init.headers).map((k) => k.toLowerCase());
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
      expect(names).not.toContain("referer");
      expect(JSON.stringify(init.headers)).not.toMatch(/supabase|session|bearer/i);
      return html("<p>hi</p>");
    });
    await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(fetch).toHaveBeenCalled();
  });
});

describe("fetchSafeHtmlPage — Agrozan-shaped transport diagnostics", () => {
  it("A: apex HTTPS 301 to www then www TLS failure reports redirect + TLS, not a fake status", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith("https://company.com/")) {
        return redirect("https://www.company.com/?utm=secret");
      }
      throw Object.assign(new Error("Hostname/IP does not match certificate's altnames: Host: www.company.com"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
        cert: { pem: "-----BEGIN CERTIFICATE-----" },
      });
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("unavailable");
    expect(result.httpStatus).toBeUndefined();
    expect(result.transportStage).toBe("tls");
    expect(result.safeErrorCode).toBe("TLS_NAME_ERROR");
    expect(result.redirectOccurred).toBe(true);
    expect(result.redirectTargetHost).toBe("www.company.com");
    expect(result.redirectTargetPath).toBe("/");
    expect(result.redirectOutcome).toBe("tls");
    expect(JSON.stringify(result)).not.toMatch(/BEGIN CERTIFICATE|utm=secret|8\.8\.8\.8/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("B: apex /contact HTTPS 200 uses the same pinned path as root", async () => {
    const pins: string[][] = [];
    const fetch = vi.fn(async (url: string, init: PinnedFetchInit) => {
      pins.push(init.pinnedAddresses);
      expect(url).toBe("https://company.com/contact/");
      return html("<p>trade desk</p>");
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/contact/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("ok");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toContain("trade desk");
    expect(pins[0]).toEqual([PUBLIC_IP]);
    expect(result.redirectOccurred).toBeUndefined();
  });

  it("C: apex root HTTPS 200 is unchanged", async () => {
    const fetch = vi.fn(async () => html("<p>home</p>"));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("ok");
    expect(result.httpStatus).toBe(200);
    expect(result.body).toContain("home");
    expect(result.transportStage).toBeUndefined();
    expect(result.redirectOccurred).toBeUndefined();
  });

  it("D: redirect to an unrelated domain is still rejected", async () => {
    const fetch = vi.fn(async () => redirect("https://evil.com/phish?token=abc"));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("rejected");
    expect(result.redirectOccurred).toBe(true);
    expect(result.redirectTargetHost).toBe("evil.com");
    expect(result.redirectTargetPath).toBe("/phish");
    expect(result.redirectOutcome).toBe("rejected");
    expect(result.safeErrorCode).toBe("REDIRECT_TARGET_ERROR");
    expect(JSON.stringify(result)).not.toMatch(/token=abc/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("E: redirect to a hostname that resolves private is blocked before connect", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith("https://company.com/")) {
        return redirect("https://www.company.com/");
      }
      throw new Error("must not connect to private destination");
    });
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === "www.company.com") return [PRIVATE_IP];
      return [PUBLIC_IP];
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup, fetch },
    });
    expect(result.status).toBe("rejected");
    expect(result.redirectOccurred).toBe(true);
    expect(result.redirectTargetHost).toBe("www.company.com");
    expect(result.redirectOutcome).toBe("rejected");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("HTTP apex that redirects to HTTPS www then TLS-fails reports the redirect hop", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith("http://company.com/")) {
        return { status: 301, headers: headers({ location: "https://www.company.com/" }), body: bodyOf(new Uint8Array()) };
      }
      throw Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });
    });
    const result = await fetchSafeHtmlPage({
      rawUrl: "http://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("unavailable");
    expect(result.httpStatus).toBeUndefined();
    expect(result.transportStage).toBe("tls");
    expect(result.safeErrorCode).toBe("CERT_ERROR");
    expect(result.redirectOccurred).toBe(true);
    expect(result.redirectTargetHost).toBe("www.company.com");
    expect(result.redirectOutcome).toBe("tls");
  });

  it("does not treat path as special: / and /contact/ both pin the same addresses", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string, init: PinnedFetchInit) => {
      seen.push(`${url}|${init.pinnedAddresses.join(",")}`);
      return html("<p>ok</p>");
    });
    const lookup = vi.fn(async () => [PUBLIC_IP]);
    await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup, fetch },
    });
    await fetchSafeHtmlPage({
      rawUrl: "https://company.com/contact/",
      candidateDomain: "company.com",
      deps: { lookup, fetch },
    });
    expect(seen[0]?.split("|")[1]).toBe(PUBLIC_IP);
    expect(seen[1]?.split("|")[1]).toBe(PUBLIC_IP);
  });

  it("classifies DNS resolver failure as dns, not private/security", async () => {
    const fetch = vi.fn(async () => html("<p>ok</p>"));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: {
        lookup: async () => {
          throw Object.assign(new Error("getaddrinfo ENOTFOUND company.com"), { code: "ENOTFOUND" });
        },
        fetch,
      },
    });
    expect(result.status).toBe("unavailable");
    expect(result.transportStage).toBe("dns");
    expect(result.safeErrorCode).toBe("ENOTFOUND");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("fetchSafeHtmlPage — body cap", () => {
  it("accepts a body exactly at the cap", async () => {
    const bytes = Buffer.alloc(PUBLIC_WEBSITE_MAX_BODY_BYTES, 0x61);
    const fetch = vi.fn(async () => ({
      status: 200,
      headers: headers({ "content-type": "text/html" }),
      body: bodyOf(bytes),
    }));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("ok");
    expect(result.body?.length).toBe(PUBLIC_WEBSITE_MAX_BODY_BYTES);
  });

  it("rejects Content-Length over the cap before reading the body", async () => {
    let iterated = false;
    const fetch = vi.fn(async () => ({
      status: 200,
      headers: headers({
        "content-type": "text/html",
        "content-length": String(PUBLIC_WEBSITE_MAX_BODY_BYTES + 1),
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          iterated = true;
          yield Buffer.alloc(PUBLIC_WEBSITE_MAX_BODY_BYTES + 1, 0x61);
        },
      },
    }));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("too_large");
    expect(iterated).toBe(false);
  });

  it("aborts a streaming body that exceeds the cap without Content-Length", async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      headers: headers({ "content-type": "text/html" }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.alloc(700_000, 0x61);
          yield Buffer.alloc(700_000, 0x61);
        },
      },
    }));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: { lookup: async () => [PUBLIC_IP], fetch },
    });
    expect(result.status).toBe("too_large");
  });

  it("counts multi-byte UTF-8 by bytes, not characters", async () => {
    const eAcute = Buffer.from("é", "utf8");
    expect(eAcute.byteLength).toBe(2);
    const over = Buffer.alloc(PUBLIC_WEBSITE_MAX_BODY_BYTES + 2);
    eAcute.copy(over, 0);
    over.fill(0x61, 2);
    const fetched = await readCappedBody(bodyOf(over), PUBLIC_WEBSITE_MAX_BODY_BYTES);
    expect(fetched.ok).toBe(false);
  });

  it("applies the smaller robots body cap", async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      headers: headers({
        "content-type": "text/plain",
        "content-length": String(PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES + 1),
      }),
      body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.alloc(PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES + 1, 0x61);
        },
      },
    }));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/robots.txt",
      candidateDomain: "company.com",
      deps: {
        lookup: async () => [PUBLIC_IP],
        fetch,
        maxBodyBytes: PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES,
      },
      allowedTypes: ["text/plain", "text/html", "application/xhtml+xml"],
    });
    expect(result.status).toBe("too_large");
  });
});

describe("fetchSafeHtmlPage — deadline", () => {
  it("does not start a hop after the overall deadline", async () => {
    const fetch = vi.fn(async () => html("<p>late</p>"));
    const result = await fetchSafeHtmlPage({
      rawUrl: "https://company.com/",
      candidateDomain: "company.com",
      deps: {
        lookup: async () => [PUBLIC_IP],
        fetch,
        deadlineAt: Date.now() - 1,
        now: () => Date.now(),
        timeoutMs: PUBLIC_WEBSITE_TIMEOUT_MS,
      },
    });
    expect(result.status).toBe("timeout");
    expect(fetch).not.toHaveBeenCalled();
  });
});
