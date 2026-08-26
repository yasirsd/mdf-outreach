import { describe, it, expect } from "vitest";
import type { Buyer } from "@/lib/types";
import { discoverAndIngestCandidates } from "./ingestion";
import { scoreBuyerCandidate } from "./scoring";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import type { BuyerCandidate } from "./types";
import { createMockCompanyDiscoveryProvider } from "./providers/mock/companyDiscovery";
import { createMockContactEnrichmentProvider } from "./providers/mock/contactEnrichment";
import type { CompanyDiscoveryProvider, DiscoveredCompany } from "./providers/types";
import type { ContactEnrichmentProvider } from "./providers/types";

const TH_CHILLI = { country: "Thailand", productKey: "guntur-chilli" };

function harness(over?: {
  companyProvider?: CompanyDiscoveryProvider;
  contactProvider?: ContactEnrichmentProvider;
  existingBuyers?: Buyer[];
}) {
  const repositories = createMemoryBuyerFinderRepos();
  return {
    repositories,
    run: (query = TH_CHILLI) =>
      discoverAndIngestCandidates({
        query,
        companyProvider: over?.companyProvider ?? createMockCompanyDiscoveryProvider(),
        contactProvider: over?.contactProvider ?? createMockContactEnrichmentProvider(),
        repositories,
        existingBuyers: over?.existingBuyers,
      }),
  };
}

describe("discoverAndIngestCandidates", () => {
  it("creates one candidate per new company, with contacts and a product match", async () => {
    const h = harness();
    const result = await h.run();
    expect(result.failures).toEqual([]);
    expect(result.created).toBe(result.discovered);
    expect(result.created).toBeGreaterThan(0);

    const companies = await h.repositories.candidates.list();
    expect(companies).toHaveLength(result.created);
    expect(companies.every((c) => c.reviewStatus === "pending")).toBe(true);
    expect(companies.every((c) => c.source === "mock")).toBe(true);

    const siam = companies.find((c) => c.domain === "siam-spice.example")!;
    const people = await h.repositories.contacts.listByCandidate(siam.id);
    const matches = await h.repositories.productMatches.listByCandidate(siam.id);
    expect(people.length).toBeGreaterThan(0);
    expect(people.filter((p) => p.isPrimary)).toHaveLength(1);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.productKey).toBe("guntur-chilli");
    expect(result.contactsAdded).toBeGreaterThan(0);
    expect(result.productMatchesAdded).toBe(result.created);
  });

  it("selects Procurement Manager as primary over a generic manager", async () => {
    const h = harness();
    await h.run();
    const bangkok = (await h.repositories.candidates.list()).find(
      (c) => c.domain === "bangkok-chilli.example",
    )!;
    const people = await h.repositories.contacts.listByCandidate(bangkok.id);
    const primary = people.find((p) => p.isPrimary);
    expect(primary?.jobTitle).toBe("Procurement Manager");
    expect(people.some((p) => p.jobTitle === "Operations Manager")).toBe(true);
  });

  it("selects Owner as primary when no procurement role exists", async () => {
    const h = harness();
    await h.run();
    const chao = (await h.repositories.candidates.list()).find(
      (c) => c.domain === "chaophraya-foods.example",
    )!;
    const people = await h.repositories.contacts.listByCandidate(chao.id);
    expect(people).toHaveLength(1);
    expect(people[0]?.isPrimary).toBe(true);
    expect(people[0]?.jobTitle).toBe("Owner");
  });

  it("stores a score computed by the Phase 3 engine", async () => {
    const h = harness();
    await h.run();
    const siam = (await h.repositories.candidates.list()).find((c) => c.domain === "siam-spice.example")!;
    const expected = scoreBuyerCandidate({
      candidate: siam,
      contacts: await h.repositories.contacts.listByCandidate(siam.id),
      productMatches: await h.repositories.productMatches.listByCandidate(siam.id),
      targetProductKey: "guntur-chilli",
      targetCountry: "Thailand",
    });
    expect(siam.companyScore).toBe(expected.total);
    expect(siam.companyScore).toBeGreaterThan(0);
  });

  it("is idempotent: the same batch twice does not duplicate companies, contacts, or matches", async () => {
    const h = harness();
    const first = await h.run();
    const second = await h.run();
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(second.skippedExactDuplicates + second.enrichedExisting).toBe(first.created);
    expect(second.contactsAdded).toBe(0);
    expect(second.productMatchesAdded).toBe(0);

    const companies = await h.repositories.candidates.list();
    expect(companies).toHaveLength(first.created);
    for (const c of companies) {
      const people = await h.repositories.contacts.listByCandidate(c.id);
      const emails = people.map((p) => p.businessEmail).filter(Boolean);
      expect(emails).toEqual([...new Set(emails)]);
      const matches = await h.repositories.productMatches.listByCandidate(c.id);
      expect(matches).toHaveLength(1);
    }
  });

  it("does not create another company for an exact domain duplicate", async () => {
    const h = harness();
    await h.run();
    const before = (await h.repositories.candidates.list()).length;
    const again = await h.run();
    expect((await h.repositories.candidates.list()).length).toBe(before);
    expect(again.created).toBe(0);
  });

  it("adds a new product match on an existing company instead of a second company row", async () => {
    const h = harness();
    await h.run();
    const mango = await h.run({ country: "Thailand", productKey: "banganapalli-mango" });
    const siam = (await h.repositories.candidates.list()).find((c) => c.domain === "siam-spice.example")!;
    const matches = await h.repositories.productMatches.listByCandidate(siam.id);
    const keys = matches.map((m) => m.productKey).sort();
    expect(keys).toEqual(["banganapalli-mango", "guntur-chilli"]);
    expect(mango.created).toBeGreaterThan(0);
    expect(
      mango.enrichedExisting >= 1 ||
        (await h.repositories.candidates.list()).filter((c) => c.domain === "siam-spice.example"),
    ).toBeTruthy();
    expect((await h.repositories.candidates.list()).filter((c) => c.domain === "siam-spice.example")).toHaveLength(
      1,
    );
  });

  it("does not duplicate an existing product match", async () => {
    const h = harness();
    await h.run();
    await h.run();
    const siam = (await h.repositories.candidates.list()).find((c) => c.domain === "siam-spice.example")!;
    expect(await h.repositories.productMatches.listByCandidate(siam.id)).toHaveLength(1);
  });

  it("does not duplicate an existing contact email", async () => {
    const h = harness();
    await h.run();
    await h.run();
    const siam = (await h.repositories.candidates.list()).find((c) => c.domain === "siam-spice.example")!;
    const people = await h.repositories.contacts.listByCandidate(siam.id);
    expect(people.filter((p) => p.businessEmail === "procurement@siam-spice.example")).toHaveLength(1);
  });

  it("adds a new second contact on a later enrichment pass", async () => {
    const h = harness({
      contactProvider: createMockContactEnrichmentProvider(),
    });
    await discoverAndIngestCandidates({
      query: { ...TH_CHILLI, contactPriorities: ["procurement"] },
      companyProvider: createMockCompanyDiscoveryProvider(),
      contactProvider: createMockContactEnrichmentProvider(),
      repositories: h.repositories,
    });
    const siam = (await h.repositories.candidates.list()).find((c) => c.domain === "siam-spice.example")!;
    const before = await h.repositories.contacts.listByCandidate(siam.id);
    expect(before.some((p) => p.jobTitle === "Procurement Manager")).toBe(true);
    expect(before.some((p) => p.jobTitle === "Import Manager")).toBe(false);

    const second = await h.run();
    const after = await h.repositories.contacts.listByCandidate(siam.id);
    expect(after.some((p) => p.jobTitle === "Import Manager")).toBe(true);
    expect(second.contactsAdded).toBeGreaterThan(0);
  });

  it("reports a possible duplicate instead of auto-merging", async () => {
    const h = harness();
    await h.repositories.candidates.create({
      id: "cand-seed-siam-uae",
      companyName: "Siam Spice Imports",
      domain: "other-siam.example",
      country: "UAE",
      discoveryStatus: "ready",
      reviewStatus: "pending",
    });
    const result = await h.run();
    expect(result.possibleDuplicates.some((p) => p.companyName === "Siam Spice Imports")).toBe(true);
    expect(result.created).toBeGreaterThan(0);
    const siams = (await h.repositories.candidates.list()).filter(
      (c) => c.companyName === "Siam Spice Imports",
    );
    expect(siams.length).toBeGreaterThanOrEqual(2);
  });

  it("does not merge companies that only share a public email domain", async () => {
    const gmailProvider: CompanyDiscoveryProvider = {
      async discover() {
        return [
          {
            providerRecordId: "mock-gmail-a",
            companyName: "Mailbox Trader A",
            domain: "gmail.com",
            country: "Thailand",
            evidence: [{ note: "fake", confidence: 10 }],
            source: "mock",
          },
        ];
      },
    };
    const contactA: ContactEnrichmentProvider = {
      async findContacts() {
        return [
          {
            jobTitle: "Owner",
            businessEmail: "alice@gmail.com",
            source: "mock",
          },
        ];
      },
    };
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: gmailProvider,
      contactProvider: contactA,
      repositories: repos,
    });
    const contactB: ContactEnrichmentProvider = {
      async findContacts() {
        return [
          {
            jobTitle: "Owner",
            businessEmail: "bob@gmail.com",
            source: "mock",
          },
        ];
      },
    };
    const gmailB: CompanyDiscoveryProvider = {
      async discover() {
        return [
          {
            providerRecordId: "mock-gmail-b",
            companyName: "Mailbox Trader B",
            domain: "gmail.com",
            country: "Thailand",
            evidence: [{ note: "fake", confidence: 10 }],
            source: "mock",
          },
        ];
      },
    };
    await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: gmailB,
      contactProvider: contactB,
      repositories: repos,
    });
    const companies = await repos.candidates.list();
    expect(companies).toHaveLength(2);
    expect(companies.every((c) => c.domain !== "gmail.com")).toBe(true);
  });

  it("skips a malformed company and still ingests valid ones", async () => {
    const mixed: CompanyDiscoveryProvider = {
      async discover() {
        return [
          { providerRecordId: "bad", companyName: "", country: "Thailand", evidence: [], source: "mock" },
          {
            providerRecordId: "good",
            companyName: "Valid Spice Co",
            domain: "valid-spice.example",
            country: "Thailand",
            evidence: [{ note: "ok", confidence: 70 }],
            source: "mock",
          },
        ];
      },
    };
    const contacts: ContactEnrichmentProvider = {
      async findContacts() {
        return [{ jobTitle: "Procurement Manager", businessEmail: "p@valid-spice.example", source: "mock" }];
      },
    };
    const h = harness({ companyProvider: mixed, contactProvider: contacts });
    const result = await h.run();
    expect(result.failures.some((f) => f.stage === "validation")).toBe(true);
    expect(result.created).toBe(1);
    expect((await h.repositories.candidates.list())[0]?.companyName).toBe("Valid Spice Co");
  });

  it("does not abort other candidates when one contact enrichment fails", async () => {
    const h = harness({
      contactProvider: createMockContactEnrichmentProvider({
        failForProviderRecordId: "mock-th-siam-spice",
      }),
    });
    const result = await h.run();
    expect(result.failures.some((f) => f.stage === "contacts" && /siam-spice/.test(f.message))).toBe(true);
    expect(result.created).toBeGreaterThan(0);
    const names = (await h.repositories.candidates.list()).map((c) => c.domain);
    expect(names).not.toContain("siam-spice.example");
    expect(names).toContain("bangkok-chilli.example");
  });

  it("returns a valid empty batch when discovery finds nothing", async () => {
    const empty: CompanyDiscoveryProvider = { async discover() { return []; } };
    const h = harness({ companyProvider: empty });
    const result = await h.run();
    expect(result).toMatchObject({
      discovered: 0,
      created: 0,
      enrichedExisting: 0,
      skippedExactDuplicates: 0,
      contactsAdded: 0,
      productMatchesAdded: 0,
    });
    expect(result.failures).toEqual([]);
    expect(await h.repositories.candidates.list()).toEqual([]);
  });

  it("returns a structured failure when company discovery throws", async () => {
    const h = harness({ companyProvider: createMockCompanyDiscoveryProvider({ fail: true }) });
    const result = await h.run();
    expect(result.created).toBe(0);
    expect(result.failures[0]?.stage).toBe("discovery");
    expect(result.failures[0]?.message).toMatch(/Mock company discovery failed/);
    expect(await h.repositories.candidates.list()).toEqual([]);
  });

  it("rejects an invalid ProductKey before calling discovery", async () => {
    let called = false;
    const spy: CompanyDiscoveryProvider = {
      async discover() {
        called = true;
        return [];
      },
    };
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { country: "Thailand", productKey: "not-a-real-product" },
      companyProvider: spy,
      contactProvider: createMockContactEnrichmentProvider(),
      repositories: repos,
    });
    expect(called).toBe(false);
    expect(result.failures[0]?.stage).toBe("validation");
    expect(result.failures[0]?.message).toMatch(/Invalid MDF product key/);
  });

  it("does not persist a provider-supplied workspace id", async () => {
    const provider: CompanyDiscoveryProvider = {
      async discover() {
        return [
          {
            providerRecordId: "ws-test",
            companyName: "No Tenant Co",
            domain: "no-tenant.example",
            country: "Thailand",
            evidence: [{ note: "fake", confidence: 50 }],
            source: "mock",
            workspace_id: "attacker-workspace",
          } as DiscoveredCompany & { workspace_id: string },
        ];
      },
    };
    const contacts: ContactEnrichmentProvider = {
      async findContacts() {
        return [{ jobTitle: "Owner", businessEmail: "o@no-tenant.example", source: "mock" }];
      },
    };
    const h = harness({ companyProvider: provider, contactProvider: contacts });
    await h.run();
    const stored = (await h.repositories.candidates.list())[0] as BuyerCandidate & {
      workspace_id?: string;
    };
    expect(stored.companyName).toBe("No Tenant Co");
    expect(stored.workspace_id).toBeUndefined();
    expect("workspace_id" in stored).toBe(false);
  });

  it("does not require a Buyer repository", async () => {
    const repositories = createMemoryBuyerFinderRepos();
    expect("buyers" in repositories).toBe(false);
    const result = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: createMockCompanyDiscoveryProvider(),
      contactProvider: createMockContactEnrichmentProvider(),
      repositories,
    });
    expect(result.created).toBeGreaterThan(0);
  });
});
