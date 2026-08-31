import { describe, expect, it, vi } from "vitest";
import { discoverPeopleForCandidate, PERSON_DISCOVERY_REQUEST_LIMIT } from "./personDiscovery";
import { PERSON_PERSIST_CAP } from "./personRank";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import type { MaskedPerson, PersonDiscoveryProvider } from "./providers/types";
import type { BuyerCandidate, BuyerCandidateProductMatch } from "./types";

const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";
const MATCH_ID = "00000000-0000-4000-8000-0000000000bb";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: CANDIDATE_ID,
    companyName: "Mahmood & Sons",
    website: "https://mahmoodsons.com",
    domain: "mahmoodsons.com",
    country: "United Arab Emirates",
    source: "hunter",
    companyScore: 23,
    evidence: [{ note: "Hunter Discover company match.", confidence: 40 }],
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function match(): BuyerCandidateProductMatch {
  return {
    id: MATCH_ID,
    candidateId: CANDIDATE_ID,
    productId: "guntur-dry-red-chilli",
    relevance: 50,
    evidence: [{ note: "Hunter Discover company match.", confidence: 40 }],
    source: "hunter",
  };
}

function person(over: Partial<MaskedPerson> = {}): MaskedPerson {
  return {
    providerRef: "handle-1",
    source: "hunter",
    domain: "mahmoodsons.com",
    companyName: "Mahmood & Sons",
    maskedName: "Amina K.",
    position: "Head of Procurement",
    department: "finance",
    seniority: "senior",
    decisionMaker: true,
    emailType: "personal",
    fullNameAvailable: true,
    linkedinAvailable: true,
    phoneAvailable: false,
    evidence: [{ note: "Hunter masked professional record. Position: Head of Procurement.", confidence: 0 }],
    ...over,
  };
}

function fakeProvider(people: MaskedPerson[], hasMore = false): PersonDiscoveryProvider & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async findPeople() {
      state.calls += 1;
      return { people, hasMore };
    },
  };
}

async function seed(repos: ReturnType<typeof createMemoryBuyerFinderRepos>) {
  await repos.candidates.create(candidate());
  await repos.productMatches.create(match());
}

describe("discoverPeopleForCandidate", () => {
  it("calls the provider once with the persisted company name and bounded limit", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const findPeople = vi.fn(async (query: { companyName: string; domain: string; limit?: number }) => {
      expect(query.companyName).toBe("Mahmood & Sons");
      expect(query.domain).toBe("mahmoodsons.com");
      expect(query.limit).toBe(PERSON_DISCOVERY_REQUEST_LIMIT);
      return { people: [person()], hasMore: false };
    });
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: { findPeople },
      repositories: repos,
    });
    expect(findPeople).toHaveBeenCalledTimes(1);
  });

  it("persists masked contacts with email, LinkedIn URL, and phone empty", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const result = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([person()]),
      repositories: repos,
    });
    expect(result.persisted).toBe(1);
    const contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.businessEmail).toBe("");
    expect(contacts[0]?.linkedinUrl).toBeUndefined();
    expect(contacts[0]?.source).toBe("hunter");
    expect(contacts[0]?.providerRef).toBe("handle-1");
    expect(contacts[0]?.isPrimary).toBe(true);
    expect(contacts[0]?.fullName).toBe("Amina K.");
    expect(JSON.stringify(contacts[0])).not.toMatch(/@mahmoodsons|linkedin\.com\/in/i);
  });

  it("discards people whose returned domain is not the candidate domain", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const result = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([
        person(),
        person({
          providerRef: "handle-other",
          domain: "other-company.example",
          position: "Procurement Manager",
          maskedName: "Other Co",
        }),
      ]),
      repositories: repos,
    });
    expect(result.discovered).toBe(2);
    expect(result.acceptedSameDomain).toBe(1);
    expect(result.discardedOtherDomain).toBe(1);
    expect(result.persisted).toBe(1);
  });

  it("does not duplicate the same provider person on repeat search", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const provider = fakeProvider([person(), person({ providerRef: "handle-2", maskedName: "Omar S.", position: "Sales Manager", decisionMaker: false })]);
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider,
      repositories: repos,
    });
    const second = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider,
      repositories: repos,
    });
    expect(second.persisted).toBe(0);
    expect(second.updatedExisting).toBe(2);
    const contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts).toHaveLength(2);
  });

  it("same person + same handle does not create a duplicate", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([person({ providerRef: "handle-A" })]),
      repositories: repos,
    });
    const second = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([person({ providerRef: "handle-A" })]),
      repositories: repos,
    });
    expect(second.persisted).toBe(0);
    expect(second.updatedExisting).toBe(1);
    expect(await repos.contacts.listByCandidate(CANDIDATE_ID)).toHaveLength(1);
  });

  it("same person fingerprint + rotated handle updates provider_ref on the same row", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([person({ providerRef: "handle-A" })]),
      repositories: repos,
    });
    const first = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(first).toHaveLength(1);
    const firstId = first[0]!.id;
    expect(first[0]?.providerRef).toBe("handle-A");

    const second = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([person({ providerRef: "handle-B" })]),
      repositories: repos,
    });
    expect(second.persisted).toBe(0);
    expect(second.updatedExisting).toBe(1);
    const after = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(firstId);
    expect(after[0]?.providerRef).toBe("handle-B");
    expect(after[0]?.fullName).toBe("Amina K.");
    expect(after.filter((c) => c.isPrimary)).toHaveLength(1);
  });

  it("different people persist as separate rows", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([
        person({ providerRef: "handle-A" }),
        person({
          providerRef: "handle-B",
          maskedName: "Omar S.",
          position: "Sales Manager",
          decisionMaker: false,
        }),
      ]),
      repositories: repos,
    });
    const contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts).toHaveLength(2);
    expect(contacts.map((c) => c.fullName).sort()).toEqual(["Amina K.", "Omar S."]);
  });

  it("demotes the previous primary before promoting the next (unique-index safe)", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([
        person({
          providerRef: "handle-sales",
          maskedName: "Omar S.",
          position: "Sales Manager",
          decisionMaker: false,
        }),
      ]),
      repositories: repos,
    });
    const firstPrimary = (await repos.contacts.listByCandidate(CANDIDATE_ID)).find((c) => c.isPrimary);
    expect(firstPrimary?.jobTitle).toBe("Sales Manager");

    const primaryWrites: Array<{ id: string; isPrimary: boolean | undefined }> = [];
    const innerUpdate = repos.contacts.update.bind(repos.contacts);
    repos.contacts.update = async (id, patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "isPrimary")) {
        primaryWrites.push({ id, isPrimary: patch.isPrimary });
      }
      return innerUpdate(id, patch);
    };

    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([
        person({
          providerRef: "handle-sales",
          maskedName: "Omar S.",
          position: "Sales Manager",
          decisionMaker: false,
        }),
        person({ providerRef: "handle-proc" }),
      ]),
      repositories: repos,
    });

    const demote = primaryWrites.findIndex((w) => w.id === firstPrimary?.id && w.isPrimary === false);
    const promote = primaryWrites.findIndex((w) => w.isPrimary === true);
    expect(demote).toBeGreaterThanOrEqual(0);
    expect(promote).toBeGreaterThan(demote);
    const contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(contacts.find((c) => c.isPrimary)?.jobTitle).toBe("Head of Procurement");
  });

  it("marks exactly one primary and switches when a stronger person appears", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([
        person({
          providerRef: "handle-sales",
          maskedName: "Omar S.",
          position: "Sales Manager",
          decisionMaker: false,
          seniority: "senior",
        }),
      ]),
      repositories: repos,
    });
    let contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(contacts.find((c) => c.isPrimary)?.jobTitle).toBe("Sales Manager");

    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([
        person({
          providerRef: "handle-sales",
          maskedName: "Omar S.",
          position: "Sales Manager",
          decisionMaker: false,
        }),
        person(),
      ]),
      repositories: repos,
    });
    contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(contacts.find((c) => c.isPrimary)?.jobTitle).toBe("Head of Procurement");
    expect(contacts.find((c) => c.jobTitle === "Sales Manager")?.isPrimary).toBe(false);
  });

  it("rescores the candidate from the strongest contact and leaves source/product data intact", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const listSpy = vi.spyOn(repos.candidates, "list");
    await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([person()]),
      repositories: repos,
    });
    expect(listSpy).not.toHaveBeenCalled();
    const stored = await repos.candidates.get(CANDIDATE_ID);
    expect(stored?.source).toBe("hunter");
    expect(stored?.companyScore).toBeGreaterThan(23);
    expect(stored?.peopleSearchedAt).toBeTruthy();
    const matches = await repos.productMatches.listByCandidate(CANDIDATE_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe("hunter");
    expect(matches[0]?.relevance).toBe(50);
  });

  it("treats a zero-contact exact-domain result as valid and stamps peopleSearchedAt", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const result = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider([]),
      repositories: repos,
    });
    expect(result.persisted).toBe(0);
    expect(result.acceptedSameDomain).toBe(0);
    const stored = await repos.candidates.get(CANDIDATE_ID);
    expect(stored?.peopleSearchedAt).toBeTruthy();
    expect(stored?.source).toBe("hunter");
    expect(await repos.contacts.listByCandidate(CANDIDATE_ID)).toEqual([]);
  });

  it("persists at most the ranked cap even when the provider returns more same-domain people", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await seed(repos);
    const people = Array.from({ length: 20 }, (_, i) =>
      person({
        providerRef: `handle-${i}`,
        maskedName: `Person ${i}`,
        position: i === 0 ? "Head of Procurement" : "Sales Associate",
        decisionMaker: i === 0,
      }),
    );
    const result = await discoverPeopleForCandidate({
      candidate: candidate(),
      productMatches: [match()],
      provider: fakeProvider(people, true),
      repositories: repos,
    });
    expect(result.acceptedSameDomain).toBe(20);
    expect(result.persisted).toBe(PERSON_PERSIST_CAP);
    expect(result.hasMore).toBe(true);
    const contacts = await repos.contacts.listByCandidate(CANDIDATE_ID);
    expect(contacts).toHaveLength(PERSON_PERSIST_CAP);
    expect(contacts.find((c) => c.isPrimary)?.jobTitle).toBe("Head of Procurement");
  });
});
