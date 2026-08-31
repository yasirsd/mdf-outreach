import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logPublicWebsiteLookupDev,
  safePublicPageUrl,
  summarizePublicWebsiteLookup,
} from "./publicWebsiteDiagnostics";

describe("public website lookup diagnostics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("strips query, hash, and credentials from logged URLs", () => {
    expect(safePublicPageUrl("https://www.company.com/contact?utm=1#top")).toBe(
      "https://www.company.com/contact",
    );
    expect(safePublicPageUrl("https://user:pass@company.com/about")).toBe("https://company.com/about");
  });

  it("does not include email addresses in the sanitized summary", () => {
    const summary = summarizePublicWebsiteLookup({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      hostname: "company.com",
      rankedPagePaths: ["https://company.com/contact"],
      selectedPagePaths: ["https://company.com/contact"],
      outcome: "no_result",
      emailCount: 0,
      pageAttempts: [
        {
          url: "https://company.com/",
          outcome: "fetched",
          emailsExtracted: 0,
          linksDiscovered: 1,
          contentEncoding: null as unknown as undefined,
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(/@/);
    expect(summary.emailCount).toBe(0);
  });

  it("includes sanitized origin-resolution fields", () => {
    const summary = summarizePublicWebsiteLookup({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      hostname: "company.com",
      rankedPagePaths: [],
      selectedPagePaths: [],
      preferredOrigin: "https://company.com/",
      alternateOriginAttempted: true,
      observedWorkingOrigin: "https://www.company.com/",
      outcome: "ok",
      emailCount: 1,
      pageAttempts: [],
    });
    expect(summary.preferredOrigin).toBe("https://company.com/");
    expect(summary.alternateOriginAttempted).toBe(true);
    expect(summary.observedWorkingOrigin).toBe("https://www.company.com/");
    expect(JSON.stringify(summary)).not.toMatch(/<html|8\.8\.8\.8|mail@/i);
  });

  it("includes sanitized client-redirect fields without script source", () => {
    const summary = summarizePublicWebsiteLookup({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      hostname: "company.com",
      rankedPagePaths: [],
      selectedPagePaths: [],
      staticClientRedirectsDiscovered: 1,
      selectedClientRedirect: "https://www.company.com/home.html",
      clientRedirectAttempted: true,
      clientRedirectOutcome: "ok",
      outcome: "ok",
      emailCount: 1,
      pageAttempts: [],
    });
    expect(summary.staticClientRedirectsDiscovered).toBe(1);
    expect(summary.selectedClientRedirect).toBe("https://www.company.com/home.html");
    expect(summary.clientRedirectAttempted).toBe(true);
    expect(summary.clientRedirectOutcome).toBe("ok");
    expect(JSON.stringify(summary)).not.toMatch(/window\.location|eval\(|<script/i);
  });

  it("includes sanitized transport and redirect diagnostics without IPs or query secrets", () => {
    const summary = summarizePublicWebsiteLookup({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      hostname: "company.com",
      rankedPagePaths: [],
      selectedPagePaths: [],
      outcome: "unavailable",
      emailCount: 0,
      pageAttempts: [
        {
          url: "https://company.com/?utm=secret",
          outcome: "http_error",
          emailsExtracted: 0,
          linksDiscovered: 0,
          transportStage: "tls",
          safeErrorCode: "TLS_NAME_ERROR",
          redirectOccurred: true,
          redirectTargetHost: "www.company.com",
          redirectTargetPath: "/",
          redirectOutcome: "tls",
        },
      ],
    });
    const pages = summary.pages as Array<Record<string, unknown>>;
    expect(pages[0]?.transportStage).toBe("tls");
    expect(pages[0]?.safeErrorCode).toBe("TLS_NAME_ERROR");
    expect(pages[0]?.redirectOccurred).toBe(true);
    expect(pages[0]?.redirectTargetHost).toBe("www.company.com");
    expect(pages[0]?.redirectTargetPath).toBe("/");
    expect(pages[0]?.redirectOutcome).toBe("tls");
    expect(pages[0]?.url).toBe("https://company.com/");
    expect(JSON.stringify(summary)).not.toMatch(/utm=secret|8\.8\.8\.8|BEGIN CERTIFICATE|10\.0\.0/);
  });

  it("omits IP-literal redirect hosts from the summary", () => {
    const summary = summarizePublicWebsiteLookup({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      hostname: "company.com",
      rankedPagePaths: [],
      selectedPagePaths: [],
      outcome: "unavailable",
      emailCount: 0,
      pageAttempts: [
        {
          url: "https://company.com/",
          outcome: "security_rejected",
          emailsExtracted: 0,
          linksDiscovered: 0,
          redirectOccurred: true,
          redirectTargetHost: "127.0.0.1",
          redirectTargetPath: "/",
          redirectOutcome: "rejected",
        },
      ],
    });
    const pages = summary.pages as Array<Record<string, unknown>>;
    expect(pages[0]?.redirectOccurred).toBe(true);
    expect(pages[0]?.redirectTargetHost).toBeNull();
    expect(JSON.stringify(summary)).not.toMatch(/127\.0\.0\.1/);
  });

  it("does not log in production", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    logPublicWebsiteLookupDev({
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      hostname: "company.com",
      rankedPagePaths: [],
      selectedPagePaths: [],
      outcome: "no_result",
      emailCount: 0,
      pageAttempts: [],
    });
    expect(info).not.toHaveBeenCalled();
  });
});
