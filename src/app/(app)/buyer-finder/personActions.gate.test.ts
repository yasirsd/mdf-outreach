import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "@/lib/buyerFinder/testUtils/memoryRepositories";
import type { BuyerCandidate, BuyerCandidateProductMatch } from "@/lib/buyerFinder/types";
import type { MaskedPerson } from "@/lib/buyerFinder/providers/types";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };
const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";
const MATCH_ID = "00000000-0000-4000-8000-0000000000bb";

const harness = {
  requireMdfSession: vi.fn(async () => SESSION),
  isConfigured: vi.fn(() => true),
  requireKey: vi.fn(() => "server-only-key"),
  findPeople: vi.fn(async () => ({ people: [] as MaskedPerson[], hasMore: false })),
};

const repos = createMemoryBuyerFinderRepos();

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: () => harness.requireMdfSession(),
}));

vi.mock("@/lib/buyerFinder/config", () => ({
  isBuyerFinderHunterConfigured: () => harness.isConfigured(),
  isBuyerFinderHunterReady: () => harness.isConfigured(),
  requireBuyerFinderHunterApiKey: () => harness.requireKey(),
  isBuyerFinderHunterEnrichmentEnabled: () => {
    throw new Error("enrichment gate must not be consulted for free person discovery");
  },
  HUNTER_NOT_CONFIGURED_MESSAGE: "Hunter is not configured on this server. Contact MDF admin.",
}));

vi.mock("@/lib/buyerFinder/providers/hunter/personDiscovery", () => ({
  createHunterPersonDiscoveryProvider: (opts: { apiKey: string }) => {
    expect(opts.apiKey).toBe("server-only-key");
    return { findPeople: harness.findPeople };
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: SESSION,
    repos: {
      buyerCandidates: repos.candidates,
      buyerCandidateContacts: repos.contacts,
      buyerCandidateProductMatches: repos.productMatches,
      buyerFinderFreeEnrichmentJobs: repos.freeEnrichmentJobs,
      buyerCandidatePublicEmails: repos.publicEmails,
    },
  }),
}));

import { findCandidateDecisionMakersAction } from "./personActions";
import { contactContainsProviderRef } from "@/lib/buyerFinder/safeContact";

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

const masked: MaskedPerson = {
  providerRef: "server-only-reveal-handle",
  source: "hunter",
  domain: "mahmoodsons.com",
  maskedName: "Amina K.",
  position: "Head of Procurement",
  seniority: "senior",
  decisionMaker: true,
  linkedinAvailable: true,
  phoneAvailable: false,
  evidence: [{ note: "Hunter masked professional record.", confidence: 0 }],
};

describe("findCandidateDecisionMakersAction gates", () => {
  beforeEach(async () => {
    harness.requireMdfSession.mockImplementation(async () => SESSION);
    harness.isConfigured.mockReturnValue(true);
    harness.requireKey.mockReturnValue("server-only-key");
    harness.findPeople.mockReset();
    harness.findPeople.mockImplementation(async () => ({ people: [masked], hasMore: false }));
    for (const row of await repos.candidates.list()) {
      for (const c of await repos.contacts.listByCandidate(row.id)) {
        await repos.contacts.delete(c.id);
      }
      for (const m of await repos.productMatches.listByCandidate(row.id)) {
        await repos.productMatches.delete(m.id);
      }
      await repos.candidates.delete(row.id);
    }
    await repos.candidates.create(candidate);
    await repos.productMatches.create(productMatch);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("key absent is not_configured and never calls Hunter", async () => {
    harness.isConfigured.mockReturnValue(false);
    const r = await findCandidateDecisionMakersAction(CANDIDATE_ID);
    expect(r.outcome).toBe("not_configured");
    expect(harness.findPeople).not.toHaveBeenCalled();
    expect(harness.requireKey).not.toHaveBeenCalled();
  });

  it("key present allows free person discovery without consulting enrichment", async () => {
    const r = await findCandidateDecisionMakersAction(CANDIDATE_ID);
    expect(r.outcome).toBe("success");
    expect(harness.findPeople).toHaveBeenCalledTimes(1);
    expect(harness.requireKey).toHaveBeenCalledTimes(1);
    expect(r.contacts.every((c) => !contactContainsProviderRef(c))).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/server-only-reveal-handle|providerRef|reveal_handle/);
    expect(r.contacts[0]?.businessEmail).toBe("");
    expect(r.overallScore).toBeGreaterThan(23);
  });

  it("returns no_result when no same-domain people exist", async () => {
    harness.findPeople.mockImplementation(async () => ({ people: [], hasMore: false }));
    const r = await findCandidateDecisionMakersAction(CANDIDATE_ID);
    expect(r.outcome).toBe("no_result");
    expect(r.contacts).toEqual([]);
    expect(harness.findPeople).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid candidate id before any Hunter call", async () => {
    const r = await findCandidateDecisionMakersAction("not-a-uuid");
    expect(r.outcome).toBe("invalid_input");
    expect(harness.findPeople).not.toHaveBeenCalled();
  });

  it("rejects archived candidates", async () => {
    await repos.candidates.update(CANDIDATE_ID, { discoveryStatus: "archived" });
    const r = await findCandidateDecisionMakersAction(CANDIDATE_ID);
    expect(r.outcome).toBe("invalid_input");
    expect(harness.findPeople).not.toHaveBeenCalled();
  });

  it("blocks a concurrent second click with already_running", async () => {
    let resolvePeople!: (value: { people: MaskedPerson[]; hasMore: boolean }) => void;
    harness.findPeople.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePeople = resolve;
        }),
    );
    const first = findCandidateDecisionMakersAction(CANDIDATE_ID);
    await vi.waitFor(() => expect(harness.findPeople).toHaveBeenCalledTimes(1));
    const second = await findCandidateDecisionMakersAction(CANDIDATE_ID);
    expect(second.outcome).toBe("already_running");
    resolvePeople({ people: [masked], hasMore: false });
    const done = await first;
    expect(done.outcome).toBe("success");
  });
});
