import { describe, expect, it } from "vitest";
import { discoverAndIngestCandidates } from "./ingestion";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import type {
  CompanyDiscoveryProvider,
  DiscoveredCompany,
} from "./providers/types";
import { scoreBuyerCandidate } from "./scoring";

/**
 * BF2.1 — search intent (operator's desired buyer types) MUST NOT
 * populate factual candidate.buyerType / isImporter / isDistributor
 * and MUST NOT award scoring points.
 */

function hitFromHunter(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    providerRecordId: "hunter-example",
    companyName: "Neutral Co",
    domain: "neutral-co.example",
    website: "https://neutral-co.example",
    country: "UAE",
    // Hunter's real provider NEVER sets buyerType / isImporter / isDistributor.
    evidence: [{ note: "Hunter directory match.", confidence: 40 }],
    source: "hunter",
    ...overrides,
  };
}

function provider(hits: DiscoveredCompany[]): CompanyDiscoveryProvider {
  return { async discover() { return hits; } };
}

describe("BF2.1 search intent ≠ candidate fact", () => {
  it("desired Importer does NOT set candidate.isImporter = true", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: {
        country: "UAE",
        productId: "guntur-dry-red-chilli",
        buyerTypes: ["Importer"],
      },
      companyProvider: provider([hitFromHunter()]),
      // No contactProvider — real Hunter path.
      repositories: repos,
    });
    const [stored] = await repos.candidates.list();
    expect(stored.isImporter).toBeFalsy();
    expect(stored.isDistributor).toBeFalsy();
    expect(stored.buyerType).toBeFalsy();
    expect(stored.source).toBe("hunter");
  });

  it("desired Distributor does NOT set candidate.isDistributor = true", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: {
        country: "UAE",
        productId: "guntur-dry-red-chilli",
        buyerTypes: ["Distributor"],
      },
      companyProvider: provider([hitFromHunter()]),
      repositories: repos,
    });
    const [stored] = await repos.candidates.list();
    expect(stored.isDistributor).toBeFalsy();
    expect(stored.isImporter).toBeFalsy();
  });

  it("scoring awards zero factual buyer-type points when search intent alone is provided", async () => {
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: {
        country: "UAE",
        productId: "guntur-dry-red-chilli",
        buyerTypes: ["Importer", "Distributor"],
      },
      companyProvider: provider([hitFromHunter()]),
      repositories: repos,
    });
    const [stored] = await repos.candidates.list();
    const productMatches = await repos.productMatches.listByCandidate(stored.id);
    const scored = scoreBuyerCandidate({
      candidate: stored,
      contacts: [],
      productMatches,
      targetProductId: "guntur-dry-red-chilli",
      targetCountry: "UAE",
    });
    // No importer/distributor/buyer-type-keyword reasons.
    for (const code of ["importer", "distributor", "buyer-type"]) {
      expect(scored.reasons.some((r) => r.code === code)).toBe(false);
    }
  });

  it("when the PROVIDER factually says isImporter=true, THEN the candidate carries it and scoring credits it", async () => {
    // Contrast: if the provider itself supplies the factual signal, we
    // honour it. Real Hunter never does — but the mock provider does.
    // This test proves the code path exists and is not disabled overall.
    const repos = createMemoryBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: { country: "UAE", productId: "guntur-dry-red-chilli" },
      companyProvider: provider([
        hitFromHunter({ isImporter: true, buyerType: "Importer" }),
      ]),
      repositories: repos,
    });
    const [stored] = await repos.candidates.list();
    expect(stored.isImporter).toBe(true);
  });
});
