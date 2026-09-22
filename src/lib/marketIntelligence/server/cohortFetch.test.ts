import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { calibrationCohort } from "../calibration/cohort";
import type {
  MarketReadRepositoryObservation,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import { BACI_OEC_QUERY_ENDPOINT } from "../providers/baci/contract";
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

function verifiedSource(overrides: Partial<MarketReadRepositorySource> = {}): MarketReadRepositorySource {
  return {
    id: "source-1",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    sourceTier: "A",
    datasetSource: "CEPII BACI",
    distributionService: "OEC BotMarket",
    serviceTermsVerified: true,
    storageAllowed: true,
    redistributionAllowed: false,
    licenceVerifiedAt: "2026-09-01T00:00:00.000Z",
    sourceUrl: "https://botmarket.oec.world/dataset/baci-hs17",
    retrievedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

function persistedRows(
  count = 204,
  overrides: Partial<MarketReadRepositoryObservation> = {},
): MarketReadRepositoryObservation[] {
  return Array.from({ length: count }, (_, index) => {
    const period = String(2018 + Math.floor(index / 30));
    const partnerIndex = index % 30;
    const partner = `${String.fromCharCode(65 + Math.floor(partnerIndex / 26))}${String.fromCharCode(65 + (partnerIndex % 26))}`;
    return {
      id: `observation-${index}`,
      sourceId: "source-1",
      providerId: "baci_oec",
      datasetId: "baci-hs17",
      reporterCountry: "MY",
      partnerCountry: partner,
      tradeFlow: "import",
      hsRevision: "HS17",
      hsCode: "090421",
      frequency: "annual",
      period,
      tradeValueUsd: index + 1,
      quantity: index + 1,
      quantityUnit: "tonne",
      netWeightKg: null,
      retrievedAt: "2026-09-15T00:00:00.000Z",
      ...overrides,
    } as MarketReadRepositoryObservation;
  });
}

function buildDeps(opts: {
  session?: typeof OWNER_SESSION | typeof MEMBER_SESSION | null;
  mappings?: ReturnType<typeof makeMapping>[];
  ledgerFor?: (country: string) => MarketProviderFetchLedgerEntry[];
  compatibleLedgerFor?: (country: string) => MarketProviderFetchLedgerEntry[];
  observationsFor?: (country: string) => MarketReadRepositoryObservation[];
  source?: MarketReadRepositorySource;
  providerYears?: number[];
  writer?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  yearOutcome?: "ok" | "network_error";
  importerOutcome?: "ok" | "network_error";
  importerRoster?: string[];
  executor?: (
    countryAlpha2: string,
    call: number,
    dependencies: { fetchImpl?: typeof fetch },
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
      listRecentLedgerEntriesForReporter: async (
        _providerId: string, _datasetId: string, country: string,
      ) => opts.compatibleLedgerFor ? opts.compatibleLedgerFor(country) : [],
      listBilateralAnnualObservations: async (country: string) =>
        opts.observationsFor ? opts.observationsFor(country) : [],
      getSourceByProviderDataset: async () => opts.source,
    }),
    loadWriter: async () => opts.writer ?? ({ recordFetchResult: async () => ({}) } as unknown as { recordFetchResult: () => unknown } & Record<string, unknown>),
    loadProofExecutor: async () => ({
      executeControlledChilliProof: async (spec, dependencies) => {
        executorCallCount += 1;
        if (!opts.executor) {
          return {
            outcome: "completed",
            fetches: { canonical_bilateral: "fetched" as const },
            observations: { created: 300, existing: 0 },
          } as CohortProofOutcome;
        }
        const result = await opts.executor(spec.reporterCountry, executorCallCount, dependencies);
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
        years: opts.yearOutcome === "network_error" ? [] : (opts.providerYears ?? PROVIDER_YEARS),
        outcome: opts.yearOutcome ?? "ok",
      }),
      fetchImporterMembers: async () => ({
        importerIds: opts.importerOutcome === "network_error" ? [] : roster,
        outcome: opts.importerOutcome ?? "ok",
      }),
    },
    now: () => NOW,
    fetchImpl: opts.fetchImpl,
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
      listRecentLedgerEntriesForReporter: async () => [],
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
  it("one fresh-complete country consumes zero provider requests", async () => {
    const executor = vi.fn();
    const deps = buildDeps({
      importerRoster: ["mys"],
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor,
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.alreadyComplete).toEqual(["MY"]);
    expect(result.processed).toEqual([]);
    expect(result.providerRequestsUsed).toBe(0);
    expect(executor).not.toHaveBeenCalled();
  });

  it("selects countries in canonical cohort order and caps at MAX_COUNTRIES_PER_INVOCATION", async () => {
    const deps = buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.processed).toHaveLength(MAX_COUNTRIES_PER_INVOCATION);
    expect(result.processed.map((p) => p.country)).toEqual(["AE"]);
    expect(result.outcome).toBe("batch_completed");
    expect(result.moreRemaining).toBe(true);
    expect(result.remaining[0]).toBe("SA");
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

  it("does not classify an otherwise-finished cohort as complete while a country is blocked", async () => {
    const result = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => country === "AE"
        ? [ledgerFresh({ reporterCountry: "AE", outcome: "quota_exhausted" })]
        : [ledgerFresh({
            reporterCountry: country as MarketProviderFetchLedgerEntry["reporterCountry"],
          })],
    }));
    expect(result.outcome).toBe("batch_completed");
    expect(result.blocked).toEqual([{ country: "AE", reason: "quota_exhausted" }]);
    expect(result.processed).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(result.moreRemaining).toBe(true);
  });

  it("preserves provider-unavailable reporters as terminally resolved", async () => {
    const result = await runCohortFetchBatch(buildDeps({ importerRoster: [] }));
    expect(result.outcome).toBe("cohort_fetch_complete");
    expect(result.unavailable).toEqual(calibrationCohort().map((entry) => entry.countryAlpha2));
    expect(result.blocked).toEqual([]);
    expect(result.remaining).toEqual([]);
    expect(result.moreRemaining).toBe(false);
  });
});

describe("MI1F.1 strict analytical cache compatibility", () => {
  function compatibilityDeps(overrides: Parameters<typeof buildDeps>[0] = {}) {
    return buildDeps({
      importerRoster: ["mys"],
      compatibleLedgerFor: (country) => country === "MY"
        ? [ledgerFresh({
            queryFingerprint: "legacy-my-2017-2024",
            coverageStart: "2017",
            coverageEnd: "2024",
          })]
        : [],
      observationsFor: (country) => country === "MY" ? persistedRows() : [],
      source: verifiedSource(),
      ...overrides,
    });
  }

  it("reuses the verified MY 2017–2024 proof for supported 2018–2024 without executing or writing", async () => {
    const executor = vi.fn(async (_country: string) => ({
      outcome: "completed" as const,
      fetches: { canonical_bilateral: "fetched" as const },
      observations: { created: 1, existing: 0 },
    }));
    const observationWrite = vi.fn();
    const result = await runCohortFetchBatch(compatibilityDeps({
      importerRoster: calibrationCohort().map((entry) => entry.baciImporterId),
      executor,
      writer: { ingestTradeObservation: observationWrite },
    }));

    expect(result.alreadyComplete).toEqual(["MY"]);
    expect(result.processed.map((entry) => entry.country)).toEqual(["AE"]);
    expect(executor.mock.calls.map((call) => call[0])).toEqual(["AE"]);
    expect(result.providerRequestsUsed).toBe(0);
    expect(observationWrite).not.toHaveBeenCalled();
  });

  it("keeps an exact-fingerprint hit exact and does not consult compatibility for MY", async () => {
    const compatibilityLookup = vi.fn(() => [] as MarketProviderFetchLedgerEntry[]);
    const result = await runCohortFetchBatch(buildDeps({
      importerRoster: ["mys"],
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      compatibleLedgerFor: compatibilityLookup,
    }));
    expect(result.alreadyComplete).toEqual(["MY"]);
    expect(compatibilityLookup).not.toHaveBeenCalled();
  });

  it("does not reuse 2018–2024 when metadata adds supported year 2025", async () => {
    const executor = vi.fn(async () => ({ outcome: "completed" as const }));
    const result = await runCohortFetchBatch(compatibilityDeps({
      providerYears: [...PROVIDER_YEARS, 2025],
      compatibleLedgerFor: () => [ledgerFresh({ coverageStart: "2018", coverageEnd: "2024" })],
      executor,
    }));
    expect(result.alreadyComplete).toEqual([]);
    expect(executor).toHaveBeenCalledOnce();
    expect(result.processed[0]?.country).toBe("MY");
  });

  it("reuses an old extra year only when that year is absent from current metadata", async () => {
    const compatible = await runCohortFetchBatch(compatibilityDeps());
    expect(compatible.alreadyComplete).toEqual(["MY"]);
  });

  it("reuses 2018–2024 for current 2019–2024 when 2018 is unsupported", async () => {
    const rows = persistedRows().filter((row) => row.period !== "2018");
    const result = await runCohortFetchBatch(compatibilityDeps({
      providerYears: PROVIDER_YEARS.slice(1),
      compatibleLedgerFor: () => [ledgerFresh({
        coverageStart: "2018", coverageEnd: "2024", rowsReceived: rows.length,
      })],
      observationsFor: () => rows,
    }));
    expect(result.alreadyComplete).toEqual(["MY"]);
  });

  it.each([
    ["stale success", { freshUntil: "2026-09-20T00:00:00.000Z" }],
    ["partial", { outcome: "partial" as const }],
    ["provider error", { outcome: "provider_error" as const }],
    ["quota", { outcome: "quota_exhausted" as const }],
  ])("never promotes %s evidence", async (_label, ledgerOverride) => {
    const result = await runCohortFetchBatch(compatibilityDeps({
      compatibleLedgerFor: () => [ledgerFresh({
        coverageStart: "2017",
        coverageEnd: "2024",
        ...ledgerOverride,
      })],
    }));
    expect(result.alreadyComplete).toEqual([]);
    expect(result.processed[0]?.country).toBe("MY");
  });

  it("supports complete-empty compatibility without synthesizing observations", async () => {
    const result = await runCohortFetchBatch(compatibilityDeps({
      compatibleLedgerFor: () => [ledgerFresh({
        coverageStart: "2017", coverageEnd: "2024", outcome: "empty", rowsReceived: 0,
      })],
      observationsFor: () => [],
    }));
    expect(result.alreadyComplete).toEqual(["MY"]);
    expect(result.processed).toEqual([]);
    expect(result.providerRequestsUsed).toBe(0);
  });

  it.each([
    ["HS", { hsCodes: ["090422"] }],
    ["reporter", { reporterCountry: "AE" }],
    ["provider", { providerId: "other" }],
    ["partner scope", { partnerCountry: "IN" }],
  ])("rejects a different %s identity", async (_label, ledgerOverride) => {
    const result = await runCohortFetchBatch(compatibilityDeps({
      compatibleLedgerFor: () => [ledgerFresh({
        coverageStart: "2017",
        coverageEnd: "2024",
        ...ledgerOverride,
      })],
    }));
    expect(result.alreadyComplete).toEqual([]);
    expect(result.processed[0]?.country).toBe("MY");
  });

  it("rejects incomplete, duplicate, unexpected-period, or unlicensed persisted read-back", async () => {
    const incomplete = await runCohortFetchBatch(compatibilityDeps({
      observationsFor: () => persistedRows(203),
    }));
    const duplicateRows = persistedRows();
    duplicateRows[1] = { ...duplicateRows[0]!, id: "duplicate" };
    const duplicate = await runCohortFetchBatch(compatibilityDeps({
      observationsFor: () => duplicateRows,
    }));
    const unexpected = await runCohortFetchBatch(compatibilityDeps({
      observationsFor: () => persistedRows(204, { period: "2017" }),
    }));
    const unlicensed = await runCohortFetchBatch(compatibilityDeps({
      source: verifiedSource({ storageAllowed: false }),
    }));

    for (const result of [incomplete, duplicate, unexpected, unlicensed]) {
      expect(result.alreadyComplete).toEqual([]);
      expect(result.processed[0]?.country).toBe("MY");
    }
  });
});

describe("MI1F cohort fetch — provider-request budget", () => {
  it("locks the production batch and authenticated-query budgets to one country / two pages", () => {
    expect(MAX_COUNTRIES_PER_INVOCATION).toBe(1);
    expect(MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION).toBe(2);
  });

  it("a one-page country fetch uses one authenticated request", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      fetchImpl: transport as typeof fetch,
      executor: async (_country, _call, dependencies) => {
        await dependencies.fetchImpl!(BACI_OEC_QUERY_ENDPOINT);
        return {
          outcome: "completed",
          fetches: { canonical_bilateral: "fetched" as const },
          observations: { created: 1, existing: 0 },
        };
      },
    }));
    expect(result.processed.map((entry) => entry.country)).toEqual(["AE"]);
    expect(result.providerRequestsUsed).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("a two-page country fetch fits the authenticated request budget exactly", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      fetchImpl: transport as typeof fetch,
      executor: async (_country, _call, dependencies) => {
        await dependencies.fetchImpl!(BACI_OEC_QUERY_ENDPOINT);
        await dependencies.fetchImpl!(`${BACI_OEC_QUERY_ENDPOINT}?offset=1000`);
        return {
          outcome: "completed",
          fetches: { canonical_bilateral: "fetched" as const },
          observations: { created: 1001, existing: 0 },
        };
      },
    }));
    expect(result.processed.map((entry) => entry.country)).toEqual(["AE"]);
    expect(result.providerRequestsUsed).toBe(MAX_PROVIDER_HTTP_REQUESTS_PER_INVOCATION);
    expect(transport).toHaveBeenCalledTimes(2);
  });

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

  it("counts an actual /query attempt even when observation ingest returns material_mismatch", async () => {
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      fetchImpl: transport as typeof fetch,
      executor: async (country, _call, dependencies) => {
        if (country === "AE") {
          await dependencies.fetchImpl!(BACI_OEC_QUERY_ENDPOINT, {
            headers: { authorization: "Bearer redacted" },
          });
          return { outcome: "observation_conflict", reason: "material_mismatch" };
        }
        return { outcome: "completed", observations: { created: 1, existing: 0 } };
      },
    }));
    expect(transport).toHaveBeenCalledOnce();
    expect(result.providerRequestsUsed).toBe(1);
    expect(result.processed[0]).toMatchObject({ country: "AE", result: "material_mismatch" });
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
    expect(result.remaining.slice(0, 3)).toEqual(["AE", "SA", "QA"]);
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

describe("MI1F.1 canonical response projection", () => {
  it("projects complete, unavailable, blocked, and remaining arrays from cohort order", async () => {
    const roster = calibrationCohort()
      .filter((entry) => entry.countryAlpha2 !== "SA" && entry.countryAlpha2 !== "KW")
      .map((entry) => entry.baciImporterId);
    const result = await runCohortFetchBatch(buildDeps({
      importerRoster: roster,
      ledgerFor: (country) => {
        if (country === "MY" || country === "OM") {
          return [ledgerFresh({ reporterCountry: country })];
        }
        if (country === "AE") {
          return [ledgerFresh({
            reporterCountry: "AE",
            outcome: "quota_exhausted",
            freshUntil: "2026-09-25T00:00:00.000Z",
          })];
        }
        return [];
      },
      executor: async (country) => country === "QA"
        ? { outcome: "observation_conflict", reason: "material_mismatch" }
        : { outcome: "completed", observations: { created: 1, existing: 0 } },
    }));

    expect(result.alreadyComplete).toEqual(["MY", "OM"]);
    expect(result.unavailable).toEqual(["SA", "KW"]);
    expect(result.blocked).toEqual([{ country: "AE", reason: "quota_exhausted" }]);
    expect(result.remaining.slice(0, 4)).toEqual(["QA", "SG", "TH", "VN"]);
  });
});

describe("MI1F cohort fetch — resumability + terminal state", () => {
  it("next invocation after MY + AE/SA/QA complete advances exactly one country to OM", async () => {
    const seenFresh = new Set(["MY", "AE", "SA", "QA"]);
    const deps = buildDeps({
      ledgerFor: (country) => seenFresh.has(country) ? [ledgerFresh()] : [],
    });
    const result = await runCohortFetchBatch(deps);
    expect(result.alreadyComplete).toEqual(["MY", "AE", "SA", "QA"]);
    expect(result.processed.map((p) => p.country)).toEqual(["OM"]);
    expect(result.remaining.slice(0, 3)).toEqual(["KW", "SG", "TH"]);
  });

  it("skips verified KR/JP/GB completion and resumes DE, then NL, in canonical order", async () => {
    const throughGb = new Set([
      "MY", "AE", "SA", "QA", "OM", "KW", "SG", "TH", "VN", "LK", "KR", "JP", "GB",
    ]);
    const first = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => throughGb.has(country)
        ? [ledgerFresh({ reporterCountry: country as MarketProviderFetchLedgerEntry["reporterCountry"] })]
        : [],
    }));
    expect(first.alreadyComplete).toEqual([...throughGb]);
    expect(first.processed.map((entry) => entry.country)).toEqual(["DE"]);
    expect(first.remaining).toEqual(["NL", "US", "CA", "AU"]);

    const throughDe = new Set([...throughGb, "DE"]);
    const second = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => throughDe.has(country)
        ? [ledgerFresh({ reporterCountry: country as MarketProviderFetchLedgerEntry["reporterCountry"] })]
        : [],
    }));
    expect(second.processed.map((entry) => entry.country)).toEqual(["NL"]);
    expect(second.remaining).toEqual(["US", "CA", "AU"]);
  });

  it("never runs more than one country proof concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => country === "MY" ? [ledgerFresh()] : [],
      executor: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return {
          outcome: "completed",
          fetches: { canonical_bilateral: "fetched" as const },
          observations: { created: 1, existing: 0 },
        };
      },
    }));
    expect(result.processed).toHaveLength(1);
    expect(maxActive).toBe(1);
  });

  it("returns cohort_fetch_complete in the invocation that processes the final country", async () => {
    const beforeAu = new Set(
      calibrationCohort()
        .map((entry) => entry.countryAlpha2)
        .filter((country) => country !== "AU"),
    );
    const result = await runCohortFetchBatch(buildDeps({
      ledgerFor: (country) => beforeAu.has(country as MarketProviderFetchLedgerEntry["reporterCountry"])
        ? [ledgerFresh({
            reporterCountry: country as MarketProviderFetchLedgerEntry["reporterCountry"],
          })]
        : [],
    }));
    expect(result.processed).toEqual([{
      country: "AU",
      result: "fetched",
      observationsCreated: 300,
      observationsExisting: 0,
    }]);
    expect(result.remaining).toEqual([]);
    expect(result.outcome).toBe("cohort_fetch_complete");
    expect(result.moreRemaining).toBe(false);
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
