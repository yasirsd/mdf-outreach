import { describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import { discoverPublicCompanyContactsForCandidate } from "./publicCompanyContacts";
import type { CompanyContactDiscoveryProvider } from "./providers/types";
import type { BuyerCandidate } from "./types";
import { scoreBuyerCandidate } from "./scoring";
import { createPublicWebsiteCompanyContactProvider } from "./providers/publicWebsite/companyContacts";

const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";

const candidate: BuyerCandidate = {
  id: CANDIDATE_ID,
  companyName: "Example Co",
  website: "https://company.com",
  domain: "company.com",
  country: "United Arab Emirates",
  source: "hunter",
  companyScore: 23,
  discoveryStatus: "ready",
  reviewStatus: "pending",
  evidence: [{ note: "Hunter Discover company match. Directory match only.", confidence: 40 }],
};

function providerReturning(
  emails: Array<{ email: string; sourceUrl: string; pageQuality?: number }>,
  outcome: "ok" | "no_result" | "incomplete" | "timeout" = emails.length ? "ok" : "no_result",
  extra: { observedWorkingOrigin?: string } = {},
): CompanyContactDiscoveryProvider {
  return {
    async discover() {
      return {
        outcome,
        pagesFetched: 1,
        emails: emails.map((e) => ({
          email: e.email,
          mailboxType: "general",
          mailboxKind: "corporate",
          source: "company_website" as const,
          sourceUrl: e.sourceUrl,
          pageQuality: e.pageQuality ?? 2,
        })),
        ...extra,
      };
    },
  };
}

const PUBLIC_IP = "8.8.8.8";

function html(body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    status: 200,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null;
      },
    },
    body: {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    },
  };
}

function text(body: string, status = 200) {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? "text/plain" : null;
      },
    },
    body: {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    },
  };
}

describe("discoverPublicCompanyContactsForCandidate", () => {
  it("persists source_url and mirrors primary into general_email", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([
        { email: "sales@company.com", sourceUrl: "https://company.com/" },
        { email: "procurement@company.com", sourceUrl: "https://company.com/contact" },
      ]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(result.outcome).toBe("ok");
    expect(result.persisted).toBe(2);
    const stored = await repos.publicEmails.listByCandidate(CANDIDATE_ID);
    const primary = stored.find((e) => e.isPrimary);
    expect(primary?.email).toBe("procurement@company.com");
    expect(primary?.source).toBe("company_website");
    expect(primary?.sourceUrl).toBe("https://company.com/contact");
    const updated = await repos.candidates.get(CANDIDATE_ID);
    expect(updated?.generalEmail).toBe("procurement@company.com");
    expect(updated?.publicContactsSearchedAt).toBeTruthy();
  });

  it("does not duplicate on a repeated lookup", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const provider = providerReturning([
      { email: "info@company.com", sourceUrl: "https://company.com/" },
    ]);
    await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider,
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    const again = await discoverPublicCompanyContactsForCandidate({
      candidate: (await repos.candidates.get(CANDIDATE_ID))!,
      contacts: [],
      productMatches: [],
      provider,
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(again.persisted).toBe(0);
    expect(again.updatedExisting).toBe(1);
    expect(await repos.publicEmails.listByCandidate(CANDIDATE_ID)).toHaveLength(1);
  });

  it("updates provenance when rediscovered on a better page", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([
        { email: "info@company.com", sourceUrl: "https://company.com/", pageQuality: 2 },
      ]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    await discoverPublicCompanyContactsForCandidate({
      candidate: (await repos.candidates.get(CANDIDATE_ID))!,
      contacts: [],
      productMatches: [],
      provider: providerReturning([
        { email: "info@company.com", sourceUrl: "https://company.com/contact", pageQuality: 0 },
      ]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    const row = (await repos.publicEmails.listByCandidate(CANDIDATE_ID))[0];
    expect(row?.sourceUrl).toBe("https://company.com/contact");
  });

  it("does not add public email points to personal contact quality", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([
        { email: "imports@company.com", sourceUrl: "https://company.com/contact" },
      ]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    const updated = await repos.candidates.get(CANDIDATE_ID);
    const scored = scoreBuyerCandidate({
      candidate: updated!,
      contacts: [],
      productMatches: [],
    });
    expect(scored.contactQuality).toBe(0);
    expect(scored.reasons.some((r) => r.code === "general-email")).toBe(true);
  });

  it("skips emails whose source_url is not a persistable same-site http(s) URL", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([
        { email: "evil@company.com", sourceUrl: "javascript:alert(1)" },
        { email: "scan@company.com", sourceUrl: "https://company.com:8080/contact" },
        { email: "ok@company.com", sourceUrl: "https://company.com/contact" },
      ]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    const stored = await repos.publicEmails.listByCandidate(CANDIDATE_ID);
    expect(stored.map((e) => e.email)).toEqual(["ok@company.com"]);
    expect(result.persisted).toBe(1);
  });

  it("scopes source_url using the website host when domain is empty", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const websiteOnly = { ...candidate, domain: undefined };
    await repos.candidates.create(websiteOnly);
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate: websiteOnly,
      contacts: [],
      productMatches: [],
      provider: providerReturning([{ email: "info@company.com", sourceUrl: "https://company.com/" }]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(result.persisted).toBe(1);
    expect((await repos.publicEmails.listByCandidate(CANDIDATE_ID))[0]?.sourceUrl).toBe(
      "https://company.com/",
    );
  });

  it("does not set public_contacts_searched_at on timeout or incomplete with no emails", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const timedOut = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([], "timeout"),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(timedOut.outcome).toBe("timeout");
    expect((await repos.candidates.get(CANDIDATE_ID))?.publicContactsSearchedAt).toBeUndefined();

    const incomplete = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([], "incomplete"),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(incomplete.outcome).toBe("incomplete");
    expect((await repos.candidates.get(CANDIDATE_ID))?.publicContactsSearchedAt).toBeUndefined();
  });

  it("persists a homepage email even when the provider reports a later-page failure as ok", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([{ email: "info@company.com", sourceUrl: "https://company.com/" }]),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(result.outcome).toBe("ok");
    expect(result.persisted).toBe(1);
    expect((await repos.candidates.get(CANDIDATE_ID))?.generalEmail).toBe("info@company.com");
    expect((await repos.candidates.get(CANDIDATE_ID))?.publicContactsSearchedAt).toBeTruthy();
  });

  it("persists observed www website without rewriting domain or source_url", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const other: BuyerCandidate = {
      ...candidate,
      id: "00000000-0000-4000-8000-0000000000bb",
      domain: "other.com",
      website: "https://other.com/",
    };
    await repos.candidates.create(other);
    const before = scoreBuyerCandidate({ candidate, contacts: [], productMatches: [] });
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning(
        [{ email: "mail@company.com", sourceUrl: "https://www.company.com/contact", pageQuality: 0 }],
        "ok",
        { observedWorkingOrigin: "https://www.company.com/" },
      ),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(result.outcome).toBe("ok");
    const updated = await repos.candidates.get(CANDIDATE_ID);
    expect(updated?.domain).toBe("company.com");
    expect(updated?.website).toBe("https://www.company.com/");
    const row = (await repos.publicEmails.listByCandidate(CANDIDATE_ID))[0];
    expect(row?.source).toBe("company_website");
    expect(row?.sourceUrl).toBe("https://www.company.com/contact");
    expect((await repos.candidates.get(other.id))?.website).toBe("https://other.com/");
    const after = scoreBuyerCandidate({ candidate: updated!, contacts: [], productMatches: [] });
    expect(after.reasons.some((r) => r.code === "website")).toBe(true);
    expect(after.reasons.filter((r) => r.code === "website")[0]?.points).toBe(
      before.reasons.filter((r) => r.code === "website")[0]?.points,
    );
  });

  it("does not rewrite website when both origins are blank 200s", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([], "no_result"),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    const updated = await repos.candidates.get(CANDIDATE_ID);
    expect(updated?.website).toBe("https://company.com");
    expect(updated?.domain).toBe("company.com");
  });

  it("does not rewrite website on incomplete/timeout", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning([], "incomplete"),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect((await repos.candidates.get(CANDIDATE_ID))?.website).toBe("https://company.com");
  });

  it("KMG shape: sparse apex then www contact persists working website only", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const fetch = vi.fn(async (url: string, init?: { pinnedAddresses?: string[] }) => {
      const u = String(url);
      if (u.includes("robots.txt")) return text("");
      if (u.includes("www.company.com") && u.includes("/contact")) {
        expect(init?.pinnedAddresses).toEqual([PUBLIC_IP]);
        return html(`<div>mail@company.com</div>`);
      }
      if (u.includes("www.company.com")) return html(`<a href="/contact">Contact</a>`);
      return html(`<html><body></body></html>`);
    });
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: createPublicWebsiteCompanyContactProvider({
        lookup: async () => [PUBLIC_IP],
        fetch,
      }),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(result.outcome).toBe("ok");
    const updated = await repos.candidates.get(CANDIDATE_ID);
    expect(updated?.domain).toBe("company.com");
    expect(updated?.website).toBe("https://www.company.com/");
    const row = (await repos.publicEmails.listByCandidate(CANDIDATE_ID))[0];
    expect(row?.email).toBe("mail@company.com");
    expect(row?.source).toBe("company_website");
    expect(row?.sourceUrl).toBe("https://www.company.com/contact");
  });

  it("persists a proven entry-page path without rewriting domain", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await repos.candidates.create(candidate);
    const result = await discoverPublicCompanyContactsForCandidate({
      candidate,
      contacts: [],
      productMatches: [],
      provider: providerReturning(
        [{ email: "reachus@company.com", sourceUrl: "https://www.company.com/home.html", pageQuality: 2 }],
        "ok",
        { observedWorkingOrigin: "https://www.company.com/home.html" },
      ),
      repositories: { candidates: repos.candidates, publicEmails: repos.publicEmails },
    });
    expect(result.outcome).toBe("ok");
    const updated = await repos.candidates.get(CANDIDATE_ID);
    expect(updated?.domain).toBe("company.com");
    expect(updated?.website).toBe("https://www.company.com/home.html");
    expect((await repos.publicEmails.listByCandidate(CANDIDATE_ID))[0]?.sourceUrl).toBe(
      "https://www.company.com/home.html",
    );
  });
});
