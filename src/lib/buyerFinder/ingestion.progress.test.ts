import { describe, expect, it, vi } from "vitest";
import { discoverAndIngestCandidates } from "./ingestion";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import type { CompanyDiscoveryProvider, DiscoveredCompany } from "./providers/types";
import type { IngestionProgressReporter } from "./ingestion";

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
  return { async discover() { return hits; } };
}

describe("ingestion progress reporter wiring (BF2.2)", () => {
  it("invokes discoveryStarted, discoveryCompleted, candidateProcessed, complete", async () => {
    const calls: string[] = [];
    const reporter: IngestionProgressReporter = {
      discoveryStarted: async (info) => {
        calls.push(`start:${info.provider}`);
      },
      discoveryCompleted: async (info) => {
        calls.push(`done:${info.discovered}:${info.usable}`);
      },
      candidateProcessed: async (info) => {
        calls.push(`proc:${info.processed}/${info.total}`);
      },
      complete: async (info) => {
        calls.push(`complete:${info.summary.created}`);
      },
    };
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { country: "Thailand", productId: "guntur-dry-red-chilli" },
      companyProvider: provider([hit(), hit({ providerRecordId: "h2", companyName: "Two", domain: "two.example" })]),
      repositories: repos,
      progress: reporter,
      progressProvider: "hunter",
    });
    expect(calls[0]).toBe("start:hunter");
    expect(calls[1]).toBe("done:2:2");
    expect(calls.filter((c) => c.startsWith("proc:"))).toEqual(["proc:1/2", "proc:2/2"]);
    expect(calls.at(-1)).toBe("complete:2");
    expect(result.discovered).toBe(2);
    expect(result.usable).toBe(2);
    expect(result.created).toBe(2);
  });

  it("persists discovered vs usable correctly when some rows fail validation", async () => {
    const completed: Array<{ discovered: number; usable: number }> = [];
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { country: "Thailand", productId: "guntur-dry-red-chilli" },
      companyProvider: provider([
        hit({ companyName: "" }),
        hit({ providerRecordId: "ok", companyName: "Ok Co", domain: "ok.example" }),
      ]),
      repositories: repos,
      progress: {
        discoveryCompleted: (info) => {
          completed.push(info);
        },
      },
    });
    expect(result.discovered).toBe(2);
    expect(result.usable).toBe(1);
    expect(result.created).toBe(1);
    expect(completed[0]).toEqual({ discovered: 2, usable: 1 });
  });

  it("advances processed count truthfully including persist failures", async () => {
    const processed: number[] = [];
    const repos = createMemoryBuyerFinderRepos();
    const origCreate = repos.candidates.create.bind(repos.candidates);
    repos.candidates.create = async (row) => {
      if (row.companyName === "Boom") throw new Error("persist boom");
      return origCreate(row);
    };
    const result = await discoverAndIngestCandidates({
      query: { country: "Thailand", productId: "guntur-dry-red-chilli" },
      companyProvider: provider([
        hit({ companyName: "Boom", domain: "boom.example", providerRecordId: "b" }),
        hit({ companyName: "Fine", domain: "fine.example", providerRecordId: "f" }),
      ]),
      repositories: repos,
      progress: {
        candidateProcessed: (info) => {
          processed.push(info.processed);
        },
      },
    });
    expect(processed).toEqual([1, 2]);
    expect(result.usable).toBe(2);
    expect(result.created).toBe(1);
    expect(result.failures.some((f) => f.stage === "persist")).toBe(true);
  });

  it("reporter failure cannot break ingestion", async () => {
    const repos = createMemoryBuyerFinderRepos();
    const result = await discoverAndIngestCandidates({
      query: { country: "Thailand", productId: "guntur-dry-red-chilli" },
      companyProvider: provider([hit()]),
      repositories: repos,
      progress: {
        discoveryStarted: async () => {
          throw new Error("reporter down");
        },
        discoveryCompleted: async () => {
          throw new Error("reporter down");
        },
        candidateProcessed: async () => {
          throw new Error("reporter down");
        },
        complete: async () => {
          throw new Error("reporter down");
        },
      },
      progressProvider: "hunter",
    });
    expect(result.created).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("does not call discoveryCompleted when the provider throws", async () => {
    const spy = {
      discoveryStarted: vi.fn(),
      discoveryCompleted: vi.fn(),
      candidateProcessed: vi.fn(),
      complete: vi.fn(),
    };
    const exploding: CompanyDiscoveryProvider = {
      async discover() {
        throw Object.assign(new Error("rate limited"), { code: "rate_limited" });
      },
    };
    const result = await discoverAndIngestCandidates({
      query: { country: "Thailand", productId: "guntur-dry-red-chilli" },
      companyProvider: exploding,
      repositories: createMemoryBuyerFinderRepos(),
      progress: spy,
      progressProvider: "hunter",
    });
    expect(spy.discoveryStarted).toHaveBeenCalledWith({ provider: "hunter" });
    expect(spy.discoveryCompleted).not.toHaveBeenCalled();
    expect(spy.complete).not.toHaveBeenCalled();
    expect(result.failures[0]?.stage).toBe("discovery");
    expect(result.failures[0]?.code).toBe("rate_limited");
    expect(result.usable).toBe(0);
  });
});
