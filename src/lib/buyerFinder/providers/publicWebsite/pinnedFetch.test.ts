import { describe, expect, it } from "vitest";
import { pinnedRequestIdentity } from "./pinnedFetch";

describe("pinnedRequestIdentity", () => {
  it("uses the requested hostname for Host and TLS SNI, never a pinned IP", () => {
    const url = new URL("https://www.company.com/contact/");
    const identity = pinnedRequestIdentity(url);
    expect(identity.hostname).toBe("www.company.com");
    expect(identity.hostHeader).toBe("www.company.com");
    expect(identity.servername).toBe("www.company.com");
    expect(identity.rejectUnauthorized).toBe(true);
    expect(identity.servername).not.toBe("8.8.8.8");
    expect(identity.hostHeader).not.toMatch(/^\d/);
  });

  it("does not set TLS options for HTTP", () => {
    const identity = pinnedRequestIdentity(new URL("http://company.com/"));
    expect(identity.hostname).toBe("company.com");
    expect(identity.hostHeader).toBe("company.com");
    expect(identity.servername).toBeUndefined();
    expect(identity.rejectUnauthorized).toBeUndefined();
  });
});
