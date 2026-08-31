import { describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "@/lib/buyerFinder/testUtils/memoryRepositories";
import { revealPersonalContactForCandidate } from "./personalContactReveal";
import { scoreOneContact, scoreBuyerCandidate } from "./scoring";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidateProductMatch } from "./types";
import type { PersonalContactRevealProvider, PersonalContactRevealResult } from "./providers/types";
import { contactContainsProviderRef } from "./safeContact";
import { RevealEventActiveExistsError } from "@/lib/repositories/interfaces";

const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";
const CONTACT_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_ID = "00000000-0000-4000-8000-0000000000c2";
const MATCH_ID = "00000000-0000-4000-8000-0000000000bb";
const HANDLE = "server-only-reveal-handle";

const candidate: BuyerCandidate = {
  id: CANDIDATE_ID,
  companyName: "Company",
  website: "https://company.com",
  domain: "company.com",
  country: "United Arab Emirates",
  generalEmail: "sales@company.com",
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
  evidence: [{ note: "match", confidence: 40 }],
  source: "hunter",
};

function maskedContact(over: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact {
  return {
    id: CONTACT_ID,
    candidateId: CANDIDATE_ID,
    firstName: "Aditee",
    lastName: "",
    fullName: "Aditee G.",
    jobTitle: "Chief Operating Officer",
    businessEmail: "",
    isPrimary: true,
    contactScore: 7,
    source: "hunter",
    providerRef: HANDLE,
    emailType: "personal",
    linkedinAvailable: true,
    phoneAvailable: false,
    department: "operations",
    seniority: "executive",
    isDecisionMaker: true,
    evidence: [{ note: "Hunter masked professional record.", confidence: 0 }],
    ...over,
  };
}

function successResult(over: Partial<PersonalContactRevealResult> = {}): PersonalContactRevealResult {
  return {
    outcome: "revealed",
    creditsCharged: 1,
    handleOutcome: "revealed",
    person: {
      firstName: "Aditee",
      lastName: "Ganatra",
      position: "Chief Operating Officer",
      email: "aditee@company.com",
      phoneNumber: "+97150000000",
      linkedinUrl: "https://www.linkedin.com/in/aditee",
      type: "personal",
      domain: "company.com",
    },
    ...over,
  };
}

function mockProvider(impl: PersonalContactRevealProvider["reveal"]): PersonalContactRevealProvider {
  return {
    id: "hunter",
    capability: "personal_contact_reveal",
    costKind: "paid",
    maximumCreditsPerAction: 1,
    reveal: vi.fn(impl),
  };
}

async function seed(
  repos: ReturnType<typeof createMemoryBuyerFinderRepos>,
  contact = maskedContact(),
  cand = candidate,
) {
  for (const row of await repos.candidates.list()) {
    for (const c of await repos.contacts.listByCandidate(row.id)) await repos.contacts.delete(c.id);
    for (const m of await repos.productMatches.listByCandidate(row.id)) {
      await repos.productMatches.delete(m.id);
    }
    await repos.candidates.delete(row.id);
  }
  await repos.candidates.create(cand);
  await repos.productMatches.create(productMatch);
  await repos.contacts.create(contact);
}

describe("revealPersonalContactForCandidate", () => {
  it("persists revealed personal details, scores, and 1 credit without creating a Buyer", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const beforeContact = scoreOneContact(maskedContact());
    expect(beforeContact.points).toBe(7);
    const provider = mockProvider(async () => successResult());
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("success");
    expect(result.creditsCharged).toBe(1);
    expect(provider.reveal).toHaveBeenCalledTimes(1);
    expect(provider.reveal).toHaveBeenCalledWith({ providerRef: HANDLE });
    expect(contactContainsProviderRef(result.contact)).toBe(false);
    const stored = await repos.contacts.get(CONTACT_ID);
    expect(stored?.businessEmail).toBe("aditee@company.com");
    expect(stored?.fullName).toBe("Aditee Ganatra");
    expect(stored?.linkedinUrl).toBe("https://www.linkedin.com/in/aditee");
    expect(stored?.phoneNumber).toBe("+97150000000");
    expect(stored?.revealedAt).toBeTruthy();
    expect(stored?.isPrimary).toBe(true);
    expect(stored?.department).toBe("operations");
    expect(stored?.providerRef).toBe(HANDLE);
    // Masked fixture: generic title 2 + decision-maker 3 + executive 2 = 7.
    // After reveal: + business email 6 + LinkedIn 2 = 15. Existing formula;
    // no paid-reveal bonus. Credits are not scoring evidence.
    expect(beforeContact.points).toBe(7);
    expect(stored?.contactScore).toBe(15);
    const refreshed = await repos.candidates.get(CANDIDATE_ID);
    const scored = scoreBuyerCandidate({
      candidate: refreshed!,
      contacts: [stored!],
      productMatches: [productMatch],
      targetProductId: productMatch.productId,
      targetCountry: refreshed!.country,
    });
    expect(refreshed?.companyScore).toBe(scored.total);
    expect(refreshed?.generalEmail).toBe("sales@company.com");
    const event = await repos.revealEvents.getLatestForContact(CONTACT_ID);
    expect(event?.status).toBe("succeeded");
    expect(event?.creditsCharged).toBe(1);
    expect(JSON.stringify(event)).not.toMatch(/server-only-reveal-handle/);
  });

  it("already_revealed with 0 credits still persists once", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = mockProvider(async () =>
      successResult({ outcome: "already_revealed", creditsCharged: 0, handleOutcome: "already_revealed" }),
    );
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("success");
    expect(result.creditsCharged).toBe(0);
    expect(result.message).toMatch(/0 credits used/i);
    expect(await repos.contacts.listByCandidate(CANDIDATE_ID)).toHaveLength(1);
  });

  it("not_found does not persist email and asks for a free refresh", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = mockProvider(async () => ({
      outcome: "not_found",
      creditsCharged: 0,
      handleOutcome: "not_found",
    }));
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("stale_or_invalid_provider_ref");
    expect(result.message).toMatch(/Refresh decision makers · Free/);
    expect((await repos.contacts.get(CONTACT_ID))?.businessEmail).toBe("");
    expect((await repos.revealEvents.getLatestForContact(CONTACT_ID))?.status).toBe("failed");
  });

  it("quota exhausted does not persist personal details", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = mockProvider(async () => ({
      outcome: "quota_exhausted",
      creditsCharged: 0,
    }));
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("quota_exhausted");
    expect((await repos.contacts.get(CONTACT_ID))?.businessEmail).toBe("");
  });

  it("contract violation (2 credits) does not succeed", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = mockProvider(async () => successResult({ outcome: "contract_violation", creditsCharged: 2 }));
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("contract_violation");
    expect((await repos.contacts.get(CONTACT_ID))?.businessEmail).toBe("");
    const event = await repos.revealEvents.getLatestForContact(CONTACT_ID);
    expect(event?.status).toBe("failed");
    expect(event?.errorCode).toBe("contract_credits_charged");
  });

  it("fails closed on a cross-company email", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = mockProvider(async () =>
      successResult({
        person: {
          firstName: "Jane",
          email: "jane@other-company.com",
          type: "personal",
          domain: "other-company.com",
        },
      }),
    );
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("invalid_provider_response");
    expect((await repos.contacts.get(CONTACT_ID))?.businessEmail).toBe("");
  });

  it("rejects generic, non-hunter, already-emailed, and missing-ref contacts before Hunter", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const provider = mockProvider(async () => successResult());
    const run = (id: string) =>
      revealPersonalContactForCandidate({
        contactId: id,
        provider,
        repositories: {
          candidates: repos.candidates,
          contacts: repos.contacts,
          productMatches: repos.productMatches,
          revealEvents: repos.revealEvents,
        },
      });

    await seed(repos, maskedContact({ emailType: "generic" }));
    expect((await run(CONTACT_ID)).outcome).toBe("invalid_input");
    expect(provider.reveal).not.toHaveBeenCalled();

    await seed(repos, maskedContact({ source: "website" }));
    expect((await run(CONTACT_ID)).outcome).toBe("invalid_input");

    await seed(repos, maskedContact({ businessEmail: "aditee@company.com" }));
    expect((await run(CONTACT_ID)).outcome).toBe("invalid_input");

    await seed(repos, maskedContact({ providerRef: "" }));
    expect((await run(CONTACT_ID)).outcome).toBe("invalid_input");
    expect(provider.reveal).not.toHaveBeenCalled();
  });

  it("rejects archived candidates before Hunter", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos, maskedContact(), { ...candidate, discoveryStatus: "archived" });
    const provider = mockProvider(async () => successResult());
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("invalid_input");
    expect(provider.reveal).not.toHaveBeenCalled();
  });

  it("does not make a revealed non-primary contact primary just because a credit was spent", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos, maskedContact({ isPrimary: false, id: OTHER_ID }));
    await repos.contacts.create(maskedContact({ id: CONTACT_ID, isPrimary: true, fullName: "Other P." }));
    const provider = mockProvider(async () => successResult());
    await revealPersonalContactForCandidate({
      contactId: OTHER_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect((await repos.contacts.get(OTHER_ID))?.isPrimary).toBe(false);
    expect((await repos.contacts.get(CONTACT_ID))?.isPrimary).toBe(true);
  });

  it("allows only one provider reveal call for concurrent attempts", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    let release!: (value: PersonalContactRevealResult) => void;
    const provider = mockProvider(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const deps = {
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    };
    const first = revealPersonalContactForCandidate(deps);
    await vi.waitFor(() => expect(provider.reveal).toHaveBeenCalledTimes(1));
    const second = await revealPersonalContactForCandidate(deps);
    expect(second.outcome).toBe("in_progress");
    expect(provider.reveal).toHaveBeenCalledTimes(1);
    release(successResult());
    expect((await first).outcome).toBe("success");
  });

  it("marks reconciliation_required when persist fails after a successful provider call", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const originalUpdate = repos.contacts.update.bind(repos.contacts);
    repos.contacts.update = async () => {
      throw new Error("persist failed");
    };
    const provider = mockProvider(async () => successResult());
    const result = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(result.outcome).toBe("needs_reconciliation");
    expect((await repos.contacts.get(CONTACT_ID))?.businessEmail).toBe("");
    expect((await repos.revealEvents.getLatestForContact(CONTACT_ID))?.status).toBe(
      "reconciliation_required",
    );
    const locked = await repos.revealEvents.getActiveForContact(CONTACT_ID);
    expect(locked?.status).toBe("reconciliation_required");
    await expect(
      repos.revealEvents.insertPending({
        candidateId: CANDIDATE_ID,
        contactId: CONTACT_ID,
        provider: "hunter",
      }),
    ).rejects.toBeInstanceOf(RevealEventActiveExistsError);
    repos.contacts.update = originalUpdate;
    const retry = await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect(retry.outcome).toBe("success");
    expect(provider.reveal).toHaveBeenCalledTimes(2);
    expect((await repos.revealEvents.getLatestForContact(CONTACT_ID))?.id).toBe(locked?.id);
    expect(await repos.revealEvents.getActiveForContact(CONTACT_ID)).toBeUndefined();
  });

  it("rejects a reveal event that points a contact at a different candidate", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const otherCandidate: BuyerCandidate = {
      ...candidate,
      id: "00000000-0000-4000-8000-0000000000cc",
      domain: "other.com",
    };
    await repos.candidates.create(otherCandidate);
    await expect(
      repos.revealEvents.insertPending({
        candidateId: otherCandidate.id,
        contactId: CONTACT_ID,
        provider: "hunter",
      }),
    ).rejects.toThrow(/does not belong to candidate/);
  });

  it("keeps general_email independent of the revealed personal mailbox", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = mockProvider(async () => successResult());
    await revealPersonalContactForCandidate({
      contactId: CONTACT_ID,
      provider,
      repositories: {
        candidates: repos.candidates,
        contacts: repos.contacts,
        productMatches: repos.productMatches,
        revealEvents: repos.revealEvents,
      },
    });
    expect((await repos.candidates.get(CANDIDATE_ID))?.generalEmail).toBe("sales@company.com");
    expect((await repos.contacts.get(CONTACT_ID))?.businessEmail).toBe("aditee@company.com");
  });
});
