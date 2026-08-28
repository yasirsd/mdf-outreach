import { describe, expect, it } from "vitest";
import { discoverAndIngestCandidates } from "./ingestion";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import { createMockCompanyDiscoveryProvider } from "./providers/mock/companyDiscovery";
import type { CompanyDiscoveryProvider, DiscoveredCompany } from "./providers/types";
import { candidateToRow, candidateFromRow, type BuyerCandidateRow } from "@/lib/repositories/supabase/candidateMappers";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";
const QUERY = { country: "United Arab Emirates", productId: "guntur-dry-red-chilli" as const };

function hunterHit(over: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    providerRecordId: "hunter-mahmoodsons.com",
    companyName: "Mahmood & Sons",
    domain: "mahmoodsons.com",
    website: "https://mahmoodsons.com",
    country: "United Arab Emirates",
    evidence: [
      {
        note: "Hunter Discover company match. Country United Arab Emirates (AE). Product guntur-dry-red-chilli. Directory match only — not proof of import or distribution.",
        confidence: 40,
      },
    ],
    source: "hunter",
    ...over,
  };
}

function provider(hits: DiscoveredCompany[]): CompanyDiscoveryProvider {
  return { async discover() { return hits; } };
}

describe("BF2.2C candidate source provenance", () => {
  it("persists source=hunter for a net-new Hunter result (Supabase mapper contract)", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit()]),
      repositories: repos,
    });
    expect(result.created).toBe(1);
    const [stored] = await repos.candidates.list();
    expect(stored.source).toBe("hunter");

    const row = {
      ...candidateToRow(stored, WORKSPACE),
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    } as BuyerCandidateRow;
    expect(row.source).toBe("hunter");
    expect(candidateFromRow(row).source).toBe("hunter");

    const matches = await repos.productMatches.listByCandidate(stored.id);
    expect(matches[0]?.source).toBe("hunter");
    expect(matches[0]?.relevance).toBe(50);
  });

  it("keeps hunter on a repeat Hunter search of the same company", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit()]),
      repositories: repos,
    });
    const second = await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit()]),
      repositories: repos,
    });
    expect(second.created).toBe(0);
    const stored = await repos.candidates.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe("hunter");
  });

  it("persists source=mock from the mock company provider", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: { country: "Thailand", productId: "guntur-dry-red-chilli" },
      companyProvider: createMockCompanyDiscoveryProvider(),
      repositories: repos,
    });
    const companies = await repos.candidates.list();
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.every((c) => c.source === "mock")).toBe(true);
  });

  it("does not let mock overwrite an existing hunter source", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit()]),
      repositories: repos,
    });
    await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit({ source: "mock" })]),
      repositories: repos,
    });
    const stored = await repos.candidates.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe("hunter");
  });

  it("lets real Hunter evidence upgrade mock → hunter", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit({ source: "mock" })]),
      repositories: repos,
    });
    expect((await repos.candidates.list())[0]?.source).toBe("mock");

    const second = await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit({ source: "hunter" })]),
      repositories: repos,
    });
    expect(second.created).toBe(0);
    const stored = await repos.candidates.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe("hunter");
  });

  it("persists zero contacts for the Hunter production path", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit()]),
      repositories: repos,
    });
    expect(result.contactsAdded).toBe(0);
    const [stored] = await repos.candidates.list();
    expect(await repos.contacts.listByCandidate(stored.id)).toEqual([]);
  });

  it("persists unknown/missing provider source as other, never mock", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: QUERY,
      companyProvider: provider([hunterHit({ source: "" as unknown as "hunter" })]),
      repositories: repos,
    });
    expect((await repos.candidates.list())[0]?.source).toBe("other");
  });
});
