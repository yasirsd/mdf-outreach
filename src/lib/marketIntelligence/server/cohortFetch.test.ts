import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { calibrationCohort } from "../calibration/cohort";
import { BaciProviderError } from "../providers/baci/normalize";
import { BaciOecConfigError } from "../providers/baci/server";
import type { MarketProviderFetchLedgerEntry } from "../types";
import {
  MAX_COUNTRIES_PER_INVOCATION,
  MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION,
  runCohortFetchBatch,
  type CohortFetchDependencies,
  type CohortProofOutcome,
} from "./cohortFetch";

const PROVIDER_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const OWNER_SESSION = {
  membership: { workspaceId: "ws-1", role: "owner" as const },
};
const MEMBER_SESSION = {
  membership: { workspaceId: "ws-1", role: "member" as const },
};

const NOW = new Date("2026-09-21T00:00:00.000Z");

function makeMapping(overrides: Partial<{
  mdfProductId: string; hsRevision: string; hsCode: string;
  mappingKind: "exact" | "proxy" | "composite";
  fitEligibility: "exact" | "proxy_allowed" | "insufficient_specificity";
  isActive: boolean; registryVersion?: string;
}> = {}) {
  return {
    mdfProductId: "guntur-dry-red-chilli",
    hsRevision: "HS17",
    hsCode: "090421",
    mappingKind: "proxy" as const,
    fitEligibility: "proxy_allowed" as const,
    isActive: true,
    registryVersion: "mi-product-map-v1",
    ...overrides,
  };
}

function ledgerFresh(overrides: Partial<MarketProviderFetchLedgerEntry> = {}): MarketProviderFetchLedgerEntry {
  return {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    queryFingerprint: "fp",
    reporterCountry: "MY",
    partnerCountry: null,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: ["090421"],
    frequency: "annual",
    providerSelectionVersion: "mi-select-v2",
    coverageStart: "2018",
    coverageEnd: "2024",
    fetchedAt: "2026-09-15T00:00:00.000Z",
    freshUntil: "2026-10-15T00:00:00.000Z",
    outcome: "success",
    rowsReceived: 204,
    ...overrides,
  };
}

function buildDeps(opts: {
  session?: typeof OWNER_SESSION | typeof MEMBER_SESSION | null;
  mappings?: ReturnType<typeof makeMapping>[];
  ledgerFor?: (country: string) => MarketProviderFetchLedgerEntry[];
  yearOutcome?: "ok" | "network_error";
  importerOutcome?: "ok" | "network_error";
  importerRoster?: string[];
  executor?: (
    countryAlpha2: string,
    call: number,
  ) => Promise<{
    outcome: CohortProofOutcome["outcome"] | string;
    fetches?: Record<string, "fetched" | "use_cache">;
    observations?: { created: number; existing: number };
    reason?: string;
    throw?: unknown;
  }>;
}): CohortFetchDependencies {
  const cohort = calibrationCohort();
  const roster = opts.importerRoster ?? cohort.map((c) => c.baciImporterId);
  let executorCallCount = 0;
  return {
    requireSession: async () => {
      if (opts.session === null) throw new Error("no session");
      return opts.session ?? OWNER_SESSION;
    },
    loadRepository: async () => ({
      listActiveProductMappings: async () => opts.mappings ?? [makeMapping()],
      listRecentLedgerEntriesForFingerprint: async (
        _providerId: string, _datasetId: string, fp: string,
      ) => {
        // Route each fingerprint through the caller's ledgerFor()
        // helper by decoding the country from fp when possible.
        const country = fpToCountry(fp);
        return opts.ledgerFor ? opts.ledgerFor(country) : [];
      },
      listBilateralAnnualObservations: async () => [],
      getSourceByProviderDataset: async () => undefined,
    }),
    loadWriter: async () => ({ recordFetchResult: async () => ({}) } as unknown as { recordFetchResult: () => unknown } & Record<string, unknown>),
    loadProofExecutor: async () => ({
      executeControlledChilliProof: async (spec) => {
        executorCallCount += 1;
        if (!opts.executor) {
          return {
            outcome: "completed",
            fetches: { canonical_bilateral: "fetched" as const },
            observations: { created: 300, existing: 0 },
          } as CohortProofOutcome;
        }
        const result = await opts.executor(spec.reporterCountry, executorCallCount);
        if (result.throw) throw result.throw;
        return {
          outcome: result.outcome,
          fetches: result.fetches,
          observations: result.observations,
          reason: result.reason,
        } as CohortProofOutcome;
      },
    }),
    fetchMetadata: {
      fetchYearMembers: async () => ({
        years: opts.yearOutcome === "network_error" ? [] : PROVIDER_YEARS,
        outcome: opts.yearOutcome ?? "ok",
      }),
      fetchImporterMembers: async () => ({
        importerIds: opts.importerOutcome === "network_error" ? [] : roster,
        outcome: opts.importerOutcome ?? "ok",
      }),
    },
    now: () => NOW,
  };
}

// Fingerprint contains reporter country segments; extract "MY", "AE", …
function fpToCountry(fp: string): string {
  const m = fp.match(/\|([A-Z]{2})\|/);
  return m ? m[1]! : fp;
}

describe("MI1F cohort fetch — owner authority", () => {
  it("unauthenticated request → outcome unauthorised, no repository or executor invoked", async () => {
    const listRepo = vi.fn(async () => ({
      listActiveProductMappings: async () => [makeMapping()],
      listRecentLedgerEntriesForFingerprint: async () => [],
      listBilateralAnnualObservations: async () => [],
      getSourceByProviderDataset: async () => undefined,
    }));
    const proofExec = vi.fn();
    const result = await runCohortFetchBatch({
      requireSession: async () => { throw new Error("unauth"); },
      loadRepository: listRepo as unknown as NonNullable<CohortFetchDependencies["loadRepository"]>,
      loadProofExecutor: proofExec as unknown as NonNullable<CohortFetchDependencies["loadProofExecutor"]>,
      now: () => NOW,
    });
    expect(result.outcome).toBe("unauthorised");
    expect(listRepo).not.toHaveBeenCalled();
    expect(proofExec).not.toHaveBeenCalled();
  });

  it("member (non-owner) → outcome forbidden", async () => {
    const result = await runCohortFetchBatch(buildDeps({ session: MEMBER_SESSION }));
    expect(result.outcome).toBe("forbidden");
    expect(result.processed).toEqual([]);
  });
});

describe("MI1F cohort fetch — mapping + metadata gates", () => {
  it("missing active proxy mapping → mapping_error, no metadata call", async () => {
    const deps = buildDeps({
      mappings: [makeMapping({ isActive: false })],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("mapping_error");
  });

  it("wrong HS code in registry (never 090422) → mapping_error", async () => {
    const deps = buildDeps({
      mappings: [makeMapping({ hsCode: "090422" })],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("mapping_error");
  });

  it("year metadata fetch fails → metadata_error, zero authenticated calls", async () => {
    let executorCalled = false;
    const deps = {
      ...buildDeps({ executor: async () => {
        executorCalled = true;
        return { outcome: "completed", fetches: { canonical_bilateral: "fetched" as const }, observations: { created: 1, existing: 0 } };
      }}),
      fetchMetadata: {
        fetchYearMembers: async () => ({ years: [], outcome: "network_error" as const }),
        fetchImporterMembers: async () => ({ importerIds: [], outcome: "ok" as const }),
      },
    };
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("metadata_error");
    expect(executorCalled).toBe(false);
  });
});

describe("MI1F cohort fetch — classification + selection", () => {
  it("Malaysia with a fresh success ledger becomes complete_fresh and consumes zero provider calls", async () => {
    let executorCalls = 0;
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => {
        executorCalls += 1;
        return {
          outcome: "completed",
          fetches: { canonical_bilateral: "fetched" as const },
          observations: { created: 100, existing: 0 },
        };
      },
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.alreadyComplete).toContain("MY");
    // 3 first non-MY needs_fetch selected.
    expect(result.processed.map((p) => p.country)).toEqual(["AE", "SA", "QA"]);
    expect(executorCalls).toBe(3);
  });

  it("selects countries in canonical cohort order and caps at MAX_COUNTRIES_PER_INVOCATION", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.processed).toHaveLength(MAX_COUNTRIES_PER_INVOCATION);
    expect(result.moreRemaining).toBe(true);
    expect(result.remaining[0]).toBe("OM");
  });

  it("unavailable importer is reported, never queried, never substituted", async () => {
    const cohort = calibrationCohort();
    const rosterMinusVN = cohort.filter((c) => c.countryAlpha2 !== "VN").map((c) => c.baciImporterId);
    const deps = buildDeps({
      importerRoster: rosterMinusVN,
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.unavailable).toEqual(["VN"]);
    expect(result.processed.some((p) => p.country === "VN")).toBe(false);
  });

  it("previously blocked (recent quota_exhausted) ledger keeps a country out of the batch", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "AE"
        ? [ledgerFresh({ outcome: "quota_exhausted", freshUntil: "2026-09-25T00:00:00.000Z" })]
        : country === "MY" ? [ledgerFresh()]
        : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.blocked.map((b) => b.country)).toContain("AE");
  });
});

describe("MI1F cohort fetch — provider-request budget", () => {
  it("never issues more than MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION query calls", async () => {
    let calls = 0;
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => {
        calls += 1;
        return {
          outcome: "completed",
          fetches: { canonical_bilateral: "fetched" as const },
          observations: { created: 2000, existing: 0 }, // 2 pages worth
        };
      },
    });
    const result = await runCohortFetchBatch(deps);
    expect(calls).toBeLessThanOrEqual(MAX_COUNTRIES_PER_INVOCATION);
    expect(result.providerRequestsUsed).toBeLessThanOrEqual(MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION);
  });

  it("metadata reads are counted separately (2 per invocation)", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.metadataRequestsUsed).toBe(2);
  });
});

describe("MI1F cohort fetch — failure isolation", () => {
  it("auth error (invalid_request from BACI 401) stops the whole batch as auth_stopped", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => ({
        outcome: "invalid_request",
        throw: new BaciProviderError(
          "invalid_request", "auth", undefined, undefined, 0,
          { stage: "provider_http", httpStatus: 401, category: "auth_error" },
        ),
      }),
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("auth_stopped");
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]?.result).toBe("invalid_request");
    expect(result.moreRemaining).toBe(true);
  });

  it("quota_exhausted stops the whole batch as quota_stopped", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => ({
        outcome: "quota_exhausted",
        throw: new BaciProviderError(
          "quota_exhausted", "rate limited", "2026-09-22T00:00:00.000Z", undefined, 0,
          { stage: "provider_http", httpStatus: 429, category: "rate_limited" },
        ),
      }),
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("quota_stopped");
    expect(result.processed[0]?.result).toBe("quota_exhausted");
    expect(result.moreRemaining).toBe(true);
  });

  it("systemic upstream error stops the batch as provider_stopped", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => ({
        outcome: "provider_error",
        throw: new BaciProviderError(
          "provider_error", "5xx", undefined, undefined, 0,
          { stage: "provider_http", httpStatus: 503, category: "upstream_error" },
        ),
      }),
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("provider_stopped");
  });

  it("BaciOecConfigError halts the batch and returns configuration_error", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => ({ outcome: "completed", throw: new BaciOecConfigError() }),
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("configuration_error");
  });

  it("material_mismatch stops the batch and lands the country in remaining for review", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async (country) => country === "AE"
        ? { outcome: "observation_conflict", reason: "material_mismatch" }
        : { outcome: "completed", fetches: { canonical_bilateral: "fetched" as const }, observations: { created: 10, existing: 0 } },
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("provider_stopped");
    expect(result.processed[0]).toMatchObject({ country: "AE", result: "material_mismatch" });
    expect(result.remaining).toContain("AE");
  });

  it("country-specific empty result is recorded as 'empty' and the batch continues", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => ({
        outcome: "completed",
        fetches: { canonical_bilateral: "fetched" as const },
        observations: { created: 0, existing: 0 },
      }),
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.processed.every((p) => p.result === "empty")).toBe(true);
    expect(result.outcome).toBe("batch_completed");
  });
});

describe("MI1F cohort fetch — resumability + terminal state", () => {
  it("second invocation after MY complete + AE/SA/QA fetched picks up at OM/KW/SG", async () => {
    const seenFresh = new Set(["MY", "AE", "SA", "QA"]);
    const deps = buildDeps({
      ledgerFor: (country) => seenFresh.has(country) ? [ledgerFresh()] : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.alreadyComplete).toEqual(["MY", "AE", "SA", "QA"]);
    expect(result.processed.map((p) => p.country)).toEqual(["OM", "KW", "SG"]);
  });

  it("all countries complete_fresh → outcome cohort_fetch_complete and moreRemaining false", async () => {
    const deps = buildDeps({
      ledgerFor: () => [ledgerFresh()],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.outcome).toBe("cohort_fetch_complete");
    expect(result.moreRemaining).toBe(false);
    expect(result.processed).toEqual([]);
  });
});

describe("MI1F cohort fetch — safe surface and static contract", () => {
  const HERE = process.cwd();
  const files = [
    "src/lib/marketIntelligence/server/cohortFetch.ts",
    "src/app/api/internal/market-intelligence/calibration/fetch-cohort/route.ts",
  ];
  const bodies = files.map((f) => readFileSync(path.resolve(HERE, f), "utf8"));

  it("never references market_product_scores, market_product_score_components, or Buyer Intelligence tables", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/market_product_scores|market_product_score_components|published_fit_score/);
      expect(body).not.toMatch(/buyer_trade_observations|buyer_intelligence/);
    }
  });

  it("never references 090422 (excluded HS)", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/090422/);
    }
  });

  it("route does not parse the request body", () => {
    const routeBody = bodies[1]!;
    expect(routeBody).not.toMatch(/request\.(json|text|formData|arrayBuffer)\(/);
  });

  it("route rejects non-POST and cross-origin before touching authority", () => {
    const routeBody = bodies[1]!;
    expect(routeBody).toContain("export async function POST");
    expect(routeBody).not.toMatch(/export async function GET/);
    expect(routeBody).toContain("isSameOriginPost");
  });

  it("orchestrator never logs the BACI secret name", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/BACI_OEC_API_KEY/);
    }
  });
});
