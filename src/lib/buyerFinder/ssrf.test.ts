import { describe, expect, it } from "vitest";
import {
  UnsafeUrlError,
  assertResolvedPublic,
  assertSafeFetchUrl,
  isBlockedHostname,
  isDisallowedIp,
  parsePublicHttpUrl,
  persistableSourceUrl,
} from "./ssrf";

describe("SSRF URL parsing", () => {
  it("rejects non-http protocols", () => {
    for (const raw of ["file:///etc/passwd", "ftp://company.com/", "data:text/html,hi", "javascript:alert(1)", "blob:https://x"]) {
      expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
      try {
        parsePublicHttpUrl(raw);
      } catch (err) {
        expect((err as UnsafeUrlError).reason).toBe("scheme");
      }
    }
  });

  it("rejects URL credentials", () => {
    expect(() => parsePublicHttpUrl("https://user:pass@company.com/")).toThrow(UnsafeUrlError);
    try {
      parsePublicHttpUrl("https://user:pass@company.com/");
    } catch (err) {
      expect((err as UnsafeUrlError).reason).toBe("credentials");
    }
  });

  it("rejects IP-literal hosts", () => {
    for (const raw of [
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
    ]) {
      expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
    }
  });

  it("rejects localhost and internal-only names", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("foo.localhost")).toBe(true);
    expect(isBlockedHostname("intranet.local")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(() => parsePublicHttpUrl("http://localhost/")).toThrow(UnsafeUrlError);
  });

  it("accepts a normal https company host before DNS", () => {
    const url = parsePublicHttpUrl("https://www.company.com/contact");
    expect(url.hostname).toBe("www.company.com");
    expect(url.protocol).toBe("https:");
  });
});

describe("SSRF IP / DNS checks", () => {
  it("rejects loopback, RFC1918, link-local, CGNAT, and metadata", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.9",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isDisallowedIp(ip)).toBe(true);
    }
  });

  it("allows a public unicast address", () => {
    expect(isDisallowedIp("8.8.8.8")).toBe(false);
    expect(isDisallowedIp("1.1.1.1")).toBe(false);
  });

  it("rejects when DNS lookup throws, without treating it as a private answer", async () => {
    await expect(
      assertResolvedPublic("company.com", async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND company.com"), { code: "ENOTFOUND" });
      }),
    ).rejects.toMatchObject({ reason: "dns" });
  });

  it("rejects when DNS resolves to a private address", async () => {
    await expect(
      assertResolvedPublic("company.com", async () => ["10.0.0.8"]),
    ).rejects.toMatchObject({ reason: "private" });
    await expect(
      assertResolvedPublic("company.com", async () => ["127.0.0.1"]),
    ).rejects.toMatchObject({ reason: "private" });
    await expect(
      assertResolvedPublic("company.com", async () => ["169.254.169.254"]),
    ).rejects.toMatchObject({ reason: "private" });
    await expect(
      assertResolvedPublic("company.com", async () => ["::1"]),
    ).rejects.toMatchObject({ reason: "private" });
  });

  it("rejects an unrelated domain even when DNS is public", async () => {
    await expect(
      assertSafeFetchUrl({
        raw: "https://evilcompany.com/",
        candidateDomain: "company.com",
        lookup: async () => ["8.8.8.8"],
      }),
    ).rejects.toMatchObject({ reason: "same_site" });
    await expect(
      assertSafeFetchUrl({
        raw: "https://www.company.com/contact",
        candidateDomain: "company.com",
        lookup: async () => ["8.8.8.8"],
      }),
    ).resolves.toMatchObject({ url: expect.objectContaining({ hostname: "www.company.com" }), addresses: ["8.8.8.8"] });
  });

  it("rejects mixed public and private A records", async () => {
    await expect(
      assertResolvedPublic("company.com", async () => ["8.8.8.8", "10.0.0.1"]),
    ).rejects.toMatchObject({ reason: "private" });
  });

  it("rejects mixed public IPv4 and private IPv6", async () => {
    await expect(
      assertResolvedPublic("company.com", async () => ["8.8.8.8", "::1"]),
    ).rejects.toMatchObject({ reason: "private" });
  });

  it("rejects nonstandard ports", () => {
    for (const raw of [
      "https://company.com:22/",
      "https://company.com:3000/",
      "https://company.com:5432/",
      "https://company.com:6379/",
      "http://company.com:8080/",
    ]) {
      expect(() => parsePublicHttpUrl(raw)).toThrow(UnsafeUrlError);
      try {
        parsePublicHttpUrl(raw);
      } catch (err) {
        expect((err as UnsafeUrlError).reason).toBe("port");
      }
    }
    expect(parsePublicHttpUrl("https://company.com/").port).toBe("");
    expect(parsePublicHttpUrl("https://company.com:443/").port).toBe("");
    expect(() => parsePublicHttpUrl("http://company.com:443/")).toThrow(UnsafeUrlError);
    expect(() => parsePublicHttpUrl("https://company.com:80/")).toThrow(UnsafeUrlError);
  });

  it("rejects mixed public IPv6 and private IPv4", async () => {
    await expect(
      assertResolvedPublic("company.com", async () => ["2001:4860:4860::8888", "10.0.0.1"]),
    ).rejects.toMatchObject({ reason: "private" });
  });

  it("persistableSourceUrl keeps same-site http(s) and drops javascript/credentials", () => {
    expect(persistableSourceUrl("https://company.com/contact", "company.com")).toBe(
      "https://company.com/contact",
    );
    expect(persistableSourceUrl("https://company.com/contact#section", "company.com")).toBe(
      "https://company.com/contact",
    );
    expect(persistableSourceUrl("javascript:alert(1)", "company.com")).toBeUndefined();
    expect(persistableSourceUrl("data:text/html,hi", "company.com")).toBeUndefined();
    expect(persistableSourceUrl("https://user:pass@company.com/", "company.com")).toBeUndefined();
    expect(persistableSourceUrl("https://evil.com/x", "company.com")).toBeUndefined();
    expect(persistableSourceUrl("https://company.com:8080/contact", "company.com")).toBeUndefined();
    expect(persistableSourceUrl("http://company.com:443/", "company.com")).toBeUndefined();
  });
});
