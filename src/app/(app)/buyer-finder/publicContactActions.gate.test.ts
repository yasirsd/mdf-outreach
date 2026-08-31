import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "@/lib/buyerFinder/testUtils/memoryRepositories";
import type { BuyerCandidate, BuyerCandidateProductMatch } from "@/lib/buyerFinder/types";
import type { CompanyContactDiscoveryResult } from "@/lib/buyerFinder/providers/types";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };
const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";
const MATCH_ID = "00000000-0000-4000-8000-0000000000bb";

const harness = {
  requireMdfSession: vi.fn(async () => SESSION),
  discover: vi.fn(
    async (): Promise<CompanyContactDiscoveryResult> => ({
      emails: [],
      pagesFetched: 1,
      outcome: "no_result",
    }),
  ),
};

const repos = createMemoryBuyerFinderRepos();

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: () => harness.requireMdfSession(),
}));

vi.mock("@/lib/buyerFinder/config", () => ({
  isBuyerFinderHunterEnabled: () => {
    throw new Error("Hunter discovery gate must not be consulted");
  },
  isBuyerFinderHunterReady: () => {
    throw new Error("Hunter ready must not be consulted");
  },
  isBuyerFinderHunterEnrichmentEnabled: () => {
    throw new Error("Hunter enrichment gate must not be consulted");
  },
}));

vi.mock("@/lib/buyerFinder/providers/publicWebsite/companyContacts", () => ({
  createPublicWebsiteCompanyContactProvider: () => ({ discover: harness.discover }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: SESSION,
    repos: {
      buyerCandidates: repos.candidates,
      buyerCandidateContacts: repos.contacts,
      buyerCandidateProductMatches: repos.productMatches,
      buyerCandidatePublicEmails: repos.publicEmails,
      buyerFinderFreeEnrichmentJobs: repos.freeEnrichmentJobs,
    },
  }),
}));

import { findCandidatePublicCompanyContactsAction } from "./publicContactActions";

const candidate: BuyerCandidate = {
  id: CANDIDATE_ID,
  companyName: "Mahmood & Sons",
  website: "https://mahmoodsons.com",
  domain: "mahmoodsons.com",
  country: "United Arab Emirates",
  source: "hunter",
  companyScore: 23,
  discoveryStatus: "ready",
  reviewStatus: "pending",
};

const productMatch: BuyerCandidateProductMatch = {
  id: MATCH_ID,
  candidateId: CANDIDATE_ID,
  productId: "guntur-dry-red-chilli",
  relevance: 50,
  evidence: [{ note: "Hunter Discover company match.", confidence: 40 }],
  source: "hunter",
};

describe("findCandidatePublicCompanyContactsAction gates", () => {
  beforeEach(async () => {
    harness.requireMdfSession.mockImplementation(async () => SESSION);
    harness.discover.mockReset();
    harness.discover.mockImplementation(async () => ({
      emails: [
        {
          email: "imports@mahmoodsons.com",
          mailboxType: "imports",
          mailboxKind: "corporate",
          source: "company_website",
          sourceUrl: "https://mahmoodsons.com/contact",
          pageQuality: 0,
        },
      ],
      pagesFetched: 2,
      outcome: "ok",
    }));
    for (const row of await repos.candidates.list()) {
      for (const c of await repos.contacts.listByCandidate(row.id)) {
        await repos.contacts.delete(c.id);
      }
      for (const m of await repos.productMatches.listByCandidate(row.id)) {
        await repos.productMatches.delete(m.id);
      }
      for (const e of await repos.publicEmails.listByCandidate(row.id)) {
        await repos.publicEmails.delete(e.id);
      }
      await repos.candidates.delete(row.id);
    }
    await repos.candidates.create(candidate);
    await repos.productMatches.create(productMatch);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated callers before fetch", async () => {
    harness.requireMdfSession.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(findCandidatePublicCompanyContactsAction(CANDIDATE_ID)).rejects.toThrow(/Unauthorized/);
    expect(harness.discover).not.toHaveBeenCalled();
  });

  it("rejects a malformed candidate UUID before fetch", async () => {
    const r = await findCandidatePublicCompanyContactsAction("not-a-uuid");
    expect(r.outcome).toBe("invalid_input");
    expect(harness.discover).not.toHaveBeenCalled();
  });

  it("treats a missing candidate as unavailable (cross-workspace / RLS)", async () => {
    const r = await findCandidatePublicCompanyContactsAction("00000000-0000-4000-8000-000000000099");
    expect(r.outcome).toBe("invalid_input");
    expect(harness.discover).not.toHaveBeenCalled();
  });

  it("lookup works without any public-website enable environment variable", async () => {
    const r = await findCandidatePublicCompanyContactsAction(CANDIDATE_ID);
    expect(r.outcome).toBe("success");
    expect(harness.discover).toHaveBeenCalledTimes(1);
    expect(r.emails[0]?.email).toBe("imports@mahmoodsons.com");
    expect(r.emails[0]?.source).toBe("company_website");
  });

  it("does not create a Buyer, campaign, or recipient", async () => {
    await findCandidatePublicCompanyContactsAction(CANDIDATE_ID);
    expect(JSON.stringify(await repos.candidates.get(CANDIDATE_ID))).not.toMatch(/campaign|recipient/);
  });

  it("blocks a concurrent second click", async () => {
    let resolveDiscover!: (value: CompanyContactDiscoveryResult) => void;
    harness.discover.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDiscover = resolve;
        }),
    );
    const first = findCandidatePublicCompanyContactsAction(CANDIDATE_ID);
    await vi.waitFor(() => expect(harness.discover).toHaveBeenCalledTimes(1));
    const second = await findCandidatePublicCompanyContactsAction(CANDIDATE_ID);
    expect(second.outcome).toBe("already_running");
    resolveDiscover({
      emails: [],
      pagesFetched: 1,
      outcome: "no_result",
    });
    const done = await first;
    expect(done.outcome).toBe("no_result");
  });
});
