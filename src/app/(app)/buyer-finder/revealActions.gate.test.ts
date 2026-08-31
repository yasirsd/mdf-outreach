import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "@/lib/buyerFinder/testUtils/memoryRepositories";
import type { BuyerCandidate, BuyerCandidateContact } from "@/lib/buyerFinder/types";
import type { PersonalContactRevealResult } from "@/lib/buyerFinder/providers/types";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };
const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";
const CONTACT_ID = "00000000-0000-4000-8000-0000000000c1";
const HANDLE = "db-only-reveal-handle";

const harness = {
  requireMdfSession: vi.fn(async () => SESSION),
  isRevealEnabled: vi.fn(() => true),
  isConfigured: vi.fn(() => true),
  requireKey: vi.fn(() => "server-only-key"),
  reveal: vi.fn(async (): Promise<PersonalContactRevealResult> => ({
    outcome: "revealed",
    creditsCharged: 1,
    handleOutcome: "revealed",
    person: {
      firstName: "Aditee",
      lastName: "Ganatra",
      email: "aditee@company.com",
      type: "personal",
      domain: "company.com",
    },
  })),
};

const repos = createMemoryBuyerFinderRepos();

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: () => harness.requireMdfSession(),
}));

vi.mock("@/lib/buyerFinder/config", () => ({
  isBuyerFinderHunterRevealEnabled: () => harness.isRevealEnabled(),
  isBuyerFinderHunterRevealReady: () => harness.isRevealEnabled() && harness.isConfigured(),
  requireBuyerFinderHunterApiKey: () => harness.requireKey(),
  isBuyerFinderHunterEnrichmentEnabled: () => {
    throw new Error("enrichment gate must not be consulted for dedicated reveal");
  },
  HUNTER_REVEAL_DISABLED_MESSAGE: "Hunter personal contact reveal is disabled on this server.",
  HUNTER_REVEAL_NOT_CONFIGURED_MESSAGE: "Hunter is not configured on this server. Contact MDF admin.",
}));

vi.mock("@/lib/buyerFinder/providers/hunter/personalReveal", () => ({
  createHunterPersonalContactRevealProvider: (opts: { apiKey: string }) => {
    expect(opts.apiKey).toBe("server-only-key");
    return { reveal: harness.reveal };
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
      buyerFinderContactRevealEvents: repos.revealEvents,
    },
  }),
}));

import { revealCandidatePersonalContactAction } from "./revealActions";

const candidate: BuyerCandidate = {
  id: CANDIDATE_ID,
  companyName: "Company",
  website: "https://company.com",
  domain: "company.com",
  country: "United Arab Emirates",
  source: "hunter",
  discoveryStatus: "ready",
  reviewStatus: "pending",
};

const contact: BuyerCandidateContact = {
  id: CONTACT_ID,
  candidateId: CANDIDATE_ID,
  firstName: "Aditee",
  lastName: "",
  fullName: "Aditee G.",
  jobTitle: "COO",
  businessEmail: "",
  isPrimary: true,
  source: "hunter",
  providerRef: HANDLE,
  emailType: "personal",
};

describe("revealCandidatePersonalContactAction gates", () => {
  beforeEach(async () => {
    harness.requireMdfSession.mockImplementation(async () => SESSION);
    harness.isRevealEnabled.mockReturnValue(true);
    harness.isConfigured.mockReturnValue(true);
    harness.requireKey.mockReturnValue("server-only-key");
    harness.reveal.mockReset();
    harness.reveal.mockImplementation(async () => ({
      outcome: "revealed",
      creditsCharged: 1,
      handleOutcome: "revealed",
      person: {
        firstName: "Aditee",
        lastName: "Ganatra",
        email: "aditee@company.com",
        type: "personal",
        domain: "company.com",
      },
    }));
    for (const row of await repos.candidates.list()) {
      for (const c of await repos.contacts.listByCandidate(row.id)) await repos.contacts.delete(c.id);
      await repos.candidates.delete(row.id);
    }
    await repos.candidates.create(candidate);
    await repos.contacts.create(contact);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reveal gate false never calls Hunter", async () => {
    harness.isRevealEnabled.mockReturnValue(false);
    const r = await revealCandidatePersonalContactAction(CONTACT_ID);
    expect(r.outcome).toBe("disabled");
    expect(harness.reveal).not.toHaveBeenCalled();
    expect(harness.requireKey).not.toHaveBeenCalled();
  });

  it("missing configuration is not_configured with no Hunter call", async () => {
    harness.isConfigured.mockReturnValue(false);
    const r = await revealCandidatePersonalContactAction(CONTACT_ID);
    expect(r.outcome).toBe("not_configured");
    expect(harness.reveal).not.toHaveBeenCalled();
  });

  it("exact true + key may reveal using the DB handle, ignoring extra client fields", async () => {
    const r = await revealCandidatePersonalContactAction(CONTACT_ID);
    expect(r.outcome).toBe("success");
    expect(harness.reveal).toHaveBeenCalledTimes(1);
    expect(harness.reveal).toHaveBeenCalledWith({ providerRef: HANDLE });
    expect(JSON.stringify(r)).not.toMatch(/db-only-reveal-handle|providerRef|reveal_handle/);
  });

  it("rejects a malformed UUID before any Hunter call", async () => {
    const r = await revealCandidatePersonalContactAction("not-a-uuid");
    expect(r.outcome).toBe("invalid_input");
    expect(harness.reveal).not.toHaveBeenCalled();
  });
});
