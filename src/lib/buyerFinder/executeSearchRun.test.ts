import { describe, expect, it, vi } from "vitest";
import { executeSearchRun, finalizeStaleSearchRun, terminalStatusFor } from "./executeSearchRun";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import { createMemorySearchRunRepository } from "./testUtils/memorySearchRunRepository";
import { HunterDiscoveryError } from "./providers/hunter/errors";
import type { CompanyDiscoveryProvider, DiscoveredCompany } from "./providers/types";
import { STALE_THRESHOLD_MS } from "./searchRun";

const QUERY = {
  country: "Thailand",
  businessProductId: "guntur-dry-red-chilli",
  desiredBuyerTypes: [] as const,
  contactPriorities: [] as const,
};

function hit(over: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    providerRecordId: over.providerRecordId ?? "h1",
    companyName: over.companyName ?? "Spice Co",
    domain: over.domain ?? "spice.example",
    country: "Thailand",
    evidence: [{ note: "dir", confidence: 40 }],
    source: "hunter",
    ...over,
  };
}

function setup(provider: CompanyDiscoveryProvider, configured = true) {
  const searchRuns = createMemorySearchRunRepository("ws-a");
  const ingestionRepos = createMemoryBuyerFinderRepos();
  const createCompanyProvider = vi.fn(() => provider);
  return {
    searchRuns,
    ingestionRepos,
    createCompanyProvider,
    isProviderConfigured: () => configured,
    async seed() {
      return searchRuns.create({ ...QUERY, desiredBuyerTypes: [], contactPriorities: [] });
    },
  };
}

describe("executeSearchRun", () => {
  it("loads query from the persisted run and claims atomically", async () => {
    const discovered: unknown[] = [];
    const provider: CompanyDiscoveryProvider = {
      async discover(q) {
        discovered.push(q);
        return [hit()];
      },
    };
    const ctx = setup(provider);
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("completed");
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      country: "Thailand",
      productId: "guntur-dry-red-chilli",
    });
    expect(ctx.createCompanyProvider).toHaveBeenCalledTimes(1);
    expect(result.run?.creditsUsed).toBe(0);
    expect(result.run?.costClass).toBe("free");
    expect(result.run?.providerStatus).toBe("success");
    expect(result.run?.status).toBe("completed");
    expect(result.run?.provider).toBe("hunter");
    const created = await ctx.ingestionRepos.candidates.list();
    expect(created).toHaveLength(1);
    expect(created[0]?.source).toBe("hunter");
    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key/i);
  });

  it("duplicate execute does not call Hunter twice", async () => {
    let discoverCalls = 0;
    const provider: CompanyDiscoveryProvider = {
      async discover() {
        discoverCalls += 1;
        return [hit()];
      },
    };
    const ctx = setup(provider);
    const run = await ctx.seed();
    const first = executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    const second = executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    const [a, b] = await Promise.all([first, second]);
    expect(discoverCalls).toBe(1);
    expect(ctx.createCompanyProvider).toHaveBeenCalledTimes(1);
    const outcomes = [a.outcome, b.outcome];
    expect(outcomes.filter((o) => o === "completed")).toHaveLength(1);
    expect(outcomes.some((o) => o === "already_running" || o === "not_claimable")).toBe(true);
  });

  it("Hunter rate limit maps to a safe failed snapshot", async () => {
    const provider: CompanyDiscoveryProvider = {
      async discover() {
        throw new HunterDiscoveryError("rate_limited", "429 from hunter");
      },
    };
    const ctx = setup(provider);
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("failed");
    expect(result.run?.providerStatus).toBe("rate_limited");
    expect(result.run?.errorMessage).toMatch(/rate limited/i);
    expect(result.run?.errorMessage).not.toMatch(/429 from hunter/i);
    expect(JSON.stringify(result)).not.toMatch(/hunter-api/);
  });

  it("Hunter no-result completes with providerStatus no_result, not a crash", async () => {
    const provider: CompanyDiscoveryProvider = { async discover() { return []; } };
    const ctx = setup(provider);
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("completed");
    expect(result.run?.providerStatus).toBe("no_result");
    expect(result.run?.status).toBe("completed");
    expect(result.run?.createdCount).toBe(0);
  });

  it("not configured after claim fails the run without calling the provider factory", async () => {
    const ctx = setup({ async discover() { return [hit()]; } }, false);
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("failed");
    expect(result.run?.providerStatus).toBe("not_configured");
    expect(ctx.createCompanyProvider).not.toHaveBeenCalled();
  });

  it("uses the not-configured message when Hunter credentials are missing", async () => {
    const ctx = setup({ async discover() { return [hit()]; } }, false);
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
      providerUnavailableMessage: "Hunter is not configured on this server.",
    });
    expect(result.outcome).toBe("failed");
    expect(result.message).toMatch(/not configured/i);
    expect(ctx.createCompanyProvider).not.toHaveBeenCalled();
  });

  it("missing run returns not_found", async () => {
    const ctx = setup({ async discover() { return []; } });
    const result = await executeSearchRun({
      runId: "00000000-0000-4000-8000-ffffffffffff",
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("not_found");
    expect(result.run).toBeNull();
  });

  it("keeps credits at 0 even when processing companies", async () => {
    const ctx = setup({
      async discover() {
        return [hit(), hit({ providerRecordId: "h2", companyName: "B", domain: "b.example" })];
      },
    });
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.run?.creditsUsed).toBe(0);
    expect(result.run?.costClass).toBe("free");
    const stored = await ctx.ingestionRepos.contacts.listByCandidate(
      (await ctx.ingestionRepos.candidates.list())[0]!.id,
    );
    expect(stored).toEqual([]);
  });

  it("partial when some candidates persist and some fail", async () => {
    const ingestionRepos = createMemoryBuyerFinderRepos();
    const orig = ingestionRepos.candidates.create.bind(ingestionRepos.candidates);
    ingestionRepos.candidates.create = async (row) => {
      if (row.companyName === "Bad") throw new Error("nope");
      return orig(row);
    };
    const searchRuns = createMemorySearchRunRepository("ws-a");
    const run = await searchRuns.create({ ...QUERY, desiredBuyerTypes: [], contactPriorities: [] });
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns,
      ingestionRepos,
      isProviderConfigured: () => true,
      createCompanyProvider: () => ({
        async discover() {
          return [
            hit({ companyName: "Bad", domain: "bad.example", providerRecordId: "bad" }),
            hit({ companyName: "Good", domain: "good.example", providerRecordId: "good" }),
          ];
        },
      }),
    });
    expect(result.outcome).toBe("partial");
    expect(result.run?.createdCount).toBe(1);
    expect(result.run?.failureCount).toBeGreaterThan(0);
    expect(result.run?.status).toBe("partial");
  });

  it("caps processing at 20 even when the provider returns more rows", async () => {
    const hits = Array.from({ length: 25 }, (_, i) =>
      hit({
        providerRecordId: `h${i}`,
        companyName: `Co ${i}`,
        domain: `co-${i}.example`,
      }),
    );
    let discoveredQuery: unknown;
    const ctx = setup({
      async discover(q) {
        discoveredQuery = q;
        return hits;
      },
    });
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("completed");
    expect(discoveredQuery).not.toHaveProperty("limit");
    expect(result.run?.discoveredCount).toBe(25);
    expect(result.run?.usableCount).toBe(20);
    expect(result.run?.processedCount).toBe(20);
    expect(result.run?.createdCount).toBe(20);
    expect((await ctx.ingestionRepos.candidates.list()).length).toBe(20);
    expect(result.run?.creditsUsed).toBe(0);
  });

  it("marks validation-only zero-usable as no_result", async () => {
    const ctx = setup({
      async discover() {
        return [hit({ companyName: "", domain: "empty.example" })];
      },
    });
    const run = await ctx.seed();
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
    });
    expect(result.outcome).toBe("completed");
    expect(result.run?.providerStatus).toBe("no_result");
    expect(result.run?.discoveredCount).toBe(1);
    expect(result.run?.usableCount).toBe(0);
    expect(result.run?.createdCount).toBe(0);
  });

  it("retries a failed terminal finalize and then succeeds", async () => {
    const ctx = setup({ async discover() { return [hit()]; } });
    const run = await ctx.seed();
    let terminalAttempts = 0;
    const innerUpdate = ctx.searchRuns.update.bind(ctx.searchRuns);
    ctx.searchRuns.update = async (id, patch) => {
      if (patch.stage === "complete") {
        terminalAttempts += 1;
        if (terminalAttempts <= 2) throw new Error("transient finalize");
      }
      return innerUpdate(id, patch);
    };
    const result = await executeSearchRun({
      runId: run.id,
      searchRuns: ctx.searchRuns,
      ingestionRepos: ctx.ingestionRepos,
      createCompanyProvider: ctx.createCompanyProvider,
      isProviderConfigured: ctx.isProviderConfigured,
      sleep: async () => {},
    });
    expect(result.outcome).toBe("completed");
    expect(terminalAttempts).toBe(3);
    expect(result.run?.status).toBe("completed");
  });

  it("stops retrying terminal finalize after bounded attempts", async () => {
    const ctx = setup({ async discover() { return [hit()]; } });
    const run = await ctx.seed();
    let terminalAttempts = 0;
    const innerUpdate = ctx.searchRuns.update.bind(ctx.searchRuns);
    ctx.searchRuns.update = async (id, patch) => {
      if (patch.stage === "complete") {
        terminalAttempts += 1;
        throw new Error("finalize down");
      }
      return innerUpdate(id, patch);
    };
    await expect(
      executeSearchRun({
        runId: run.id,
        searchRuns: ctx.searchRuns,
        ingestionRepos: ctx.ingestionRepos,
        createCompanyProvider: ctx.createCompanyProvider,
        isProviderConfigured: ctx.isProviderConfigured,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/finalize down/);
    expect(terminalAttempts).toBe(3);
    const stored = await ctx.searchRuns.get(run.id);
    expect(stored?.status).toBe("running");
  });
});

describe("terminalStatusFor", () => {
  it("treats empty discovery as completed/no_result", () => {
    expect(
      terminalStatusFor({
        discovered: 0,
        usable: 0,
        created: 0,
        enrichedExisting: 0,
        skippedExactDuplicates: 0,
        possibleDuplicates: [],
        contactsAdded: 0,
        productMatchesAdded: 0,
        failures: [],
        buyerDuplicateFindings: [],
      }),
    ).toEqual({ status: "completed", providerStatus: "no_result" });
  });

  it("treats provider rows that all fail validation as completed/no_result", () => {
    expect(
      terminalStatusFor({
        discovered: 4,
        usable: 0,
        created: 0,
        enrichedExisting: 0,
        skippedExactDuplicates: 0,
        possibleDuplicates: [],
        contactsAdded: 0,
        productMatchesAdded: 0,
        failures: [{ stage: "validation", message: "company name is required" }],
        buyerDuplicateFindings: [],
      }),
    ).toEqual({ status: "completed", providerStatus: "no_result" });
  });
});

describe("finalizeStaleSearchRun", () => {
  it("does not mark a healthy run stale", async () => {
    const searchRuns = createMemorySearchRunRepository("ws-a");
    const run = await searchRuns.create({ ...QUERY, desiredBuyerTypes: [], contactPriorities: [] });
    const result = await finalizeStaleSearchRun({
      runId: run.id,
      searchRuns,
      now: () => new Date(),
    });
    expect(result.outcome).toBe("not_stale");
    expect(result.run?.status).toBe("queued");
  });

  it("marks a genuinely stale run failed with interrupted", async () => {
    const t0 = new Date("2026-08-28T00:00:00.000Z");
    const searchRuns = createMemorySearchRunRepository("ws-a", undefined, () => t0.toISOString());
    const run = await searchRuns.create({ ...QUERY, desiredBuyerTypes: [], contactPriorities: [] });
    const later = new Date(t0.getTime() + STALE_THRESHOLD_MS + 1);
    const result = await finalizeStaleSearchRun({
      runId: run.id,
      searchRuns,
      now: () => later,
    });
    expect(result.outcome).toBe("finalized");
    expect(result.run?.status).toBe("failed");
    expect(result.run?.errorCode).toBe("interrupted");
    expect(result.run?.errorMessage).toMatch(/stopped updating/i);
  });
});
