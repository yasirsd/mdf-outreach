import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEntityUuid } from "./ids";
import { discoverAndIngestCandidates } from "./ingestion";
import { BUYER_FINDER_PROCESS_CAP } from "./searchRun";
import {
  createUuidStrictBuyerFinderRepos,
  InvalidEntityIdError,
} from "./testUtils/memoryRepositories";
import type { BuyerCandidate } from "./types";
import type { CompanyDiscoveryProvider, DiscoveredCompany } from "./providers/types";

const TH_CHILLI = { country: "Thailand", productId: "guntur-dry-red-chilli" as const };

function hit(over: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    providerRecordId: over.providerRecordId ?? "h1",
    companyName: over.companyName ?? "Spice Co",
    domain: over.domain ?? "spice.example",
    country: over.country ?? "Thailand",
    evidence: [{ note: "dir", confidence: 40 }],
    source: "hunter",
    ...over,
  };
}

function provider(hits: DiscoveredCompany[]): CompanyDiscoveryProvider {
  return {
    async discover(query) {
      expect(query).not.toHaveProperty("limit");
      return hits;
    },
  };
}

function trackingGets(repos: ReturnType<typeof createUuidStrictBuyerFinderRepos>) {
  const gets: string[] = [];
  const orig = repos.candidates.get.bind(repos.candidates);
  repos.candidates.get = async (id: string) => {
    gets.push(id);
    return orig(id);
  };
  return gets;
}

describe("BF2.2A candidate UUID identity", () => {
  it("does not generate slug candidate/contact/match ids", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/lib/buyerFinder/ingestion.ts"), "utf8");
    expect(src).not.toContain("candidateIdFor");
    expect(src).not.toContain("contactIdFor");
    expect(src).not.toContain("matchIdFor");
    expect(src).not.toMatch(/`cand-/);
    expect(src).not.toMatch(/`ctc-/);
    expect(src).not.toMatch(/`match-/);
  });

  it("persists a new domain candidate with a valid UUID", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([hit()]),
      repositories: repos,
    });
    expect(result.created).toBe(1);
    const stored = await repos.candidates.list();
    expect(stored).toHaveLength(1);
    expect(isEntityUuid(stored[0]!.id)).toBe(true);
    const contacts = await repos.contacts.listByCandidate(stored[0]!.id);
    const matches = await repos.productMatches.listByCandidate(stored[0]!.id);
    expect(contacts).toEqual([]);
    expect(matches).toHaveLength(1);
    expect(isEntityUuid(matches[0]!.id)).toBe(true);
  });

  it("persists a no-domain name-only candidate with a valid UUID", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([
        hit({
          providerRecordId: "name-only",
          companyName: "Harbor Traders",
          domain: undefined,
          website: undefined,
        }),
      ]),
      repositories: repos,
    });
    expect(result.created).toBe(1);
    const stored = await repos.candidates.list();
    expect(stored[0]!.domain).toBeUndefined();
    expect(isEntityUuid(stored[0]!.id)).toBe(true);
  });

  it("reuses the existing UUID on a repeated same-domain search", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const first = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([hit()]),
      repositories: repos,
    });
    const [row] = await repos.candidates.list();
    const second = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([hit()]),
      repositories: repos,
    });
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skippedExactDuplicates + second.enrichedExisting).toBe(1);
    const after = await repos.candidates.list();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(row!.id);
    expect(isEntityUuid(after[0]!.id)).toBe(true);
  });

  it("reuses a name+country candidate rather than creating a duplicate UUID row", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([
        hit({ companyName: "Harbor Traders", domain: undefined, website: undefined }),
      ]),
      repositories: repos,
    });
    const again = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([
        hit({
          providerRecordId: "again",
          companyName: "Harbor Traders",
          domain: undefined,
          website: undefined,
        }),
      ]),
      repositories: repos,
    });
    expect(again.created).toBe(0);
    expect((await repos.candidates.list()).filter((c) => c.companyName === "Harbor Traders")).toHaveLength(1);
  });

  it("never looks up a slug candidate id on the UUID repository", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const gets = trackingGets(repos);
    await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([hit({ domain: "example.com" })]),
      repositories: repos,
    });
    expect(gets.some((id) => id.startsWith("cand-") || id.includes("example"))).toBe(false);
    expect(gets.every((id) => isEntityUuid(id))).toBe(true);
  });

  it("possible-duplicate path does not query get() with a slug", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const seed: BuyerCandidate = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      companyName: "Siam Spice Imports",
      domain: "other-siam.example",
      country: "UAE",
      discoveryStatus: "ready",
      reviewStatus: "pending",
    };
    await repos.candidates.create(seed);
    const gets = trackingGets(repos);
    const result = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider([
        hit({
          companyName: "Siam Spice Imports",
          domain: "siam-spice.example",
          country: "Thailand",
        }),
      ]),
      repositories: repos,
    });
    expect(result.possibleDuplicates.length).toBeGreaterThan(0);
    expect(result.created).toBe(1);
    expect(gets.every((id) => isEntityUuid(id))).toBe(true);
    const siams = (await repos.candidates.list()).filter((c) => c.companyName === "Siam Spice Imports");
    expect(siams).toHaveLength(2);
    expect(siams.every((c) => isEntityUuid(c.id))).toBe(true);
  });

  it("strict UUID fake rejects a slug candidate id", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    await expect(repos.candidates.get("cand-example-com")).rejects.toBeInstanceOf(InvalidEntityIdError);
    await expect(
      repos.candidates.create({
        id: "cand-example-com",
        companyName: "Example",
        country: "Thailand",
        discoveryStatus: "new",
        reviewStatus: "pending",
      }),
    ).rejects.toBeInstanceOf(InvalidEntityIdError);
  });
});

describe("BF2.2A 20-company server process cap", () => {
  function many(n: number): DiscoveredCompany[] {
    return Array.from({ length: n }, (_, i) =>
      hit({
        providerRecordId: `h${i}`,
        companyName: `Co ${i}`,
        domain: `co-${i}.example`,
      }),
    );
  }

  it("processes at most 20 usable companies when the provider returns more", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const completed: Array<{ discovered: number; usable: number }> = [];
    const processedTotals: number[] = [];
    const result = await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider(many(25)),
      repositories: repos,
      progress: {
        discoveryCompleted: (info) => {
          completed.push(info);
        },
        candidateProcessed: (info) => {
          processedTotals.push(info.total);
        },
      },
    });
    expect(result.discovered).toBe(25);
    expect(result.usable).toBe(BUYER_FINDER_PROCESS_CAP);
    expect(result.created).toBe(BUYER_FINDER_PROCESS_CAP);
    expect((await repos.candidates.list()).length).toBe(BUYER_FINDER_PROCESS_CAP);
    expect(completed[0]).toEqual({ discovered: 25, usable: 20 });
    expect(processedTotals.every((t) => t === 20)).toBe(true);
    expect(processedTotals.at(-1)).toBe(20);
  });

  it("does not raise the cap when query.limit is 999", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { ...TH_CHILLI, limit: 999 },
      companyProvider: provider(many(25)),
      repositories: repos,
    });
    expect(result.discovered).toBe(25);
    expect(result.usable).toBe(20);
    expect(result.created).toBe(20);
  });

  it("does not invent contact rows under the cap", async () => {
    const repos = createUuidStrictBuyerFinderRepos();
    await discoverAndIngestCandidates({
      query: TH_CHILLI,
      companyProvider: provider(many(21)),
      repositories: repos,
    });
    for (const c of await repos.candidates.list()) {
      expect(await repos.contacts.listByCandidate(c.id)).toEqual([]);
    }
  });
});
