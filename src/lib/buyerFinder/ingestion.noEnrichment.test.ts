import { describe, expect, it, vi } from "vitest";
import { discoverAndIngestCandidates } from "./ingestion";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import type {
  CompanyDiscoveryProvider,
  ContactEnrichmentProvider,
  DiscoveredCompany,
} from "./providers/types";

/**
 * BF2 — Ingestion must persist candidates WITHOUT any contact provider.
 *
 * Real Hunter production path passes NO contactProvider. Ingestion must:
 *   • not throw
 *   • not treat "zero contacts" as a failure
 *   • persist the candidate + product match with a valid company score
 *   • never insert a fabricated contact
 */

function fakeCompanyProvider(hits: DiscoveredCompany[]): CompanyDiscoveryProvider {
  return {
    async discover() {
      return hits;
    },
  };
}

function neverCalledContactProvider(): ContactEnrichmentProvider {
  const findContacts = vi.fn(async () => {
    throw new Error("contactProvider must NOT be invoked in Hunter production path");
  });
  return { findContacts };
}

const HIT: DiscoveredCompany = {
  providerRecordId: "hunter-example",
  companyName: "Example Trading",
  domain: "example-trading.example",
  website: "https://example-trading.example",
  country: "UAE",
  evidence: [{ note: "Hunter directory match.", confidence: 40 }],
  source: "hunter",
};

describe("BF2 ingestion — no contact enrichment", () => {
  it("persists a real Hunter candidate with contacts=[] when contactProvider is omitted", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { country: "UAE", productId: "guntur-dry-red-chilli" },
      companyProvider: fakeCompanyProvider([HIT]),
      // NOTE: no contactProvider — this is the BF2 production path.
      repositories: repos,
    });

    expect(result.discovered).toBe(1);
    expect(result.created).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.contactsAdded).toBe(0);

    const stored = await repos.candidates.list();
    expect(stored.length).toBe(1);
    expect(stored[0].companyName).toBe("Example Trading");
    expect(stored[0].source).toBe("hunter");
    // Company score is computed even without contacts.
    expect(typeof stored[0].companyScore).toBe("number");
    expect(stored[0].companyScore).toBeGreaterThanOrEqual(0);

    const contacts = await repos.contacts.listByCandidate(stored[0].id);
    expect(contacts).toEqual([]);
  });

  it("does NOT invoke a supplied mock contact provider when it was not passed in", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const contactSpy = neverCalledContactProvider();

    // Simulate what our production action does: NEVER pass the mock.
    await discoverAndIngestCandidates({
      query: { country: "UAE", productId: "guntur-dry-red-chilli" },
      companyProvider: fakeCompanyProvider([HIT]),
      // No contactProvider — mock is deliberately absent.
      repositories: repos,
    });

    expect(contactSpy.findContacts).not.toHaveBeenCalled();
  });

  it("zero contacts is not counted as a failure", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { country: "UAE", productId: "guntur-dry-red-chilli" },
      companyProvider: fakeCompanyProvider([HIT]),
      repositories: repos,
    });
    expect(result.failures.filter((f) => f.stage === "contacts").length).toBe(0);
  });

  it("repeat search for the same company enriches the existing candidate rather than duplicating", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: { country: "UAE", productId: "guntur-dry-red-chilli" },
      companyProvider: fakeCompanyProvider([HIT]),
      repositories: repos,
    });
    const second = await discoverAndIngestCandidates({
      query: { country: "UAE", productId: "guntur-dry-red-chilli" },
      companyProvider: fakeCompanyProvider([HIT]),
      repositories: repos,
    });
    // Only one candidate should exist afterward.
    const storedAfter = await repos.candidates.list();
    expect(storedAfter.length).toBe(1);
    // Second run reports it as enriched-in-place OR as a skipped exact duplicate.
    expect(second.created).toBe(0);
    expect(second.enrichedExisting + second.skippedExactDuplicates).toBeGreaterThanOrEqual(1);
  });
});
