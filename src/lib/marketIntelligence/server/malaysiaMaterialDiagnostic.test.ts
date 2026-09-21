import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  MarketReadRepositoryMaterialObservation,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import { BACI_OEC_QUERY_ENDPOINT } from "../providers/baci/contract";
import { BaciProviderError, normalizeBaciBilateralRows, type BaciWireRow } from "../providers/baci/normalize";
import {
  runMalaysiaMaterialDiagnostic,
  type MalaysiaMaterialDiagnosticDependencies,
} from "./malaysiaMaterialDiagnostic";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-09-21T00:00:00.000Z");

function raw(): BaciWireRow {
  return {
    year: 2024,
    exporter_id: "ind",
    exporter_name: "India",
    importer_id: "mys",
    importer_name: "Malaysia",
    hs_code: "090421",
    product_name: "Dried chillies",
    hs_revision: 2017,
    value: 100,
    quantity: 2,
    unit_abbrevation: "mt",
    unit_name: "Metric tons",
  };
}

function persisted(row = normalizeBaciBilateralRows([raw()], NOW.toISOString())[0]!): MarketReadRepositoryMaterialObservation {
  return {
    id: "observation-1",
    sourceId: "source-1",
    providerId: row.providerId,
    datasetId: row.datasetId,
    reporterCountry: row.reporterCountry,
    partnerCountry: row.partnerCountry,
    tradeFlow: row.tradeFlow,
    hsRevision: row.hsRevision,
    hsCode: row.hsCode,
    frequency: row.frequency,
    period: row.period,
    tradeValueUsd: row.tradeValueUsd ?? null,
    quantity: row.quantity ?? null,
    quantityUnit: row.quantityUnit ?? null,
    netWeightKg: row.netWeightKg ?? null,
    sourcePeriod: row.sourcePeriod ?? null,
    sourceUrl: row.sourceUrl ?? null,
    safeSourceRef: row.safeReference ?? null,
    retrievedAt: NOW.toISOString(),
  };
}

function source(): MarketReadRepositorySource {
  return {
    id: "source-1",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    sourceTier: "B",
    datasetSource: "CEPII BACI",
    distributionService: "OEC BotMarket",
    serviceTermsVerified: true,
    storageAllowed: true,
    redistributionAllowed: false,
    licenceVerifiedAt: "2026-01-01T00:00:00.000Z",
    sourceUrl: "https://botmarket.oec.world/dataset/baci-hs17",
    retrievedAt: NOW.toISOString(),
  };
}

function dependencies(
  overrides: Partial<MalaysiaMaterialDiagnosticDependencies> = {},
  rows: BaciWireRow[] = [raw()],
  persistedRows: MarketReadRepositoryMaterialObservation[] = normalizeBaciBilateralRows(
    rows,
    NOW.toISOString(),
  ).map((row) => persisted(row)),
) {
  const forbiddenWrites = {
    ingestTradeObservation: vi.fn(),
    recordFetchResult: vi.fn(),
    upsertMarketProductScore: vi.fn(),
    ingestBuyerIntelligence: vi.fn(),
  };
  const deps: MalaysiaMaterialDiagnosticDependencies = {
    requireSession: async () => ({
      membership: { workspaceId: "ws-1", role: "owner" as const },
    }),
    loadRepository: async () => ({
      listActiveProductMappings: async () => [{
        id: "mapping-1",
        mdfProductId: "guntur-dry-red-chilli",
        hsRevision: "HS17" as const,
        hsLevel: 6 as const,
        hsCode: "090421",
        tradeLabel: "Dried Capsicum/Pimenta",
        mappingKind: "proxy" as const,
        mappingConfidence: 0.7,
        fitEligibility: "proxy_allowed" as const,
        scopeDescription: "Trade proxy",
        isActive: true,
        registryVersion: "mi-product-map-v1",
      }],
      getSourceByProviderDataset: async () => source(),
      listBilateralAnnualMaterialObservations: async () => persistedRows,
      ...forbiddenWrites,
    }),
    fetchYears: async () => ({ years: [2024], outcome: "ok" as const }),
    fetchImpl: vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch,
    fetchQuery: async (_spec, options) => {
      await options.fetchImpl!(BACI_OEC_QUERY_ENDPOINT, {
        headers: { authorization: "Bearer redacted" },
      });
      return {
        rows,
        totalRows: rows.length,
        pagesFetched: 1,
        latestAvailablePeriod: "2024",
      };
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, forbiddenWrites };
}

describe("MI1F.2 Malaysia material diagnostic service", () => {
  it("runs an exact-match dry comparison and counts the actual provider request", async () => {
    const { deps, forbiddenWrites } = dependencies();
    const result = await runMalaysiaMaterialDiagnostic(deps);
    expect(result).toMatchObject({
      outcome: "comparison_complete",
      providerRequestsUsed: 1,
      analyticalYears: [2024],
      providerRows: 1,
      persistedRows: 1,
      exactMatches: 1,
      mismatches: 0,
    });
    for (const write of Object.values(forbiddenWrites)) expect(write).not.toHaveBeenCalled();
  });

  it("reports raw floating noise informationally without a material mismatch", async () => {
    const noisy = {
      ...raw(),
      value: 675.9999999999999,
      quantity: 0.052000000000000005,
    };
    const { deps } = dependencies({}, [noisy]);
    const result = await runMalaysiaMaterialDiagnostic(deps);
    expect(result).toMatchObject({
      outcome: "comparison_complete",
      exactMatches: 1,
      mismatches: 0,
      representationNoiseRows: 1,
      representationNoiseFieldCounts: { trade_value_usd: 1, quantity: 1 },
      mismatchFieldCounts: { trade_value_usd: 0, quantity: 0 },
    });
  });

  it("reports two transport requests for a two-page diagnostic", async () => {
    const { deps } = dependencies({
      fetchQuery: async (_spec, options) => {
        await options.fetchImpl!(BACI_OEC_QUERY_ENDPOINT);
        await options.fetchImpl!(`${BACI_OEC_QUERY_ENDPOINT}?offset=1000`);
        return {
          rows: [raw()], totalRows: 1, pagesFetched: 2, latestAvailablePeriod: "2024",
        };
      },
    });
    const result = await runMalaysiaMaterialDiagnostic(deps);
    expect(result.outcome).toBe("comparison_complete");
    expect(result.providerRequestsUsed).toBe(2);
  });

  it("never spends provider requests before the owner gate", async () => {
    const { deps } = dependencies({
      requireSession: async () => ({
        membership: { workspaceId: "ws-1", role: "member" as const },
      }),
    });
    const result = await runMalaysiaMaterialDiagnostic(deps);
    expect(result).toMatchObject({ outcome: "forbidden", providerRequestsUsed: 0 });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose provider credentials or upstream diagnostics", async () => {
    const secret = "bot_market_ak_DO_NOT_LEAK";
    const { deps } = dependencies({
      fetchQuery: async (_spec, options) => {
        await options.fetchImpl!(BACI_OEC_QUERY_ENDPOINT);
        throw new BaciProviderError(
          "invalid_request",
          `credential ${secret}`,
          undefined,
          secret,
          0,
          { stage: "provider_http", category: "auth_error", sanitizedBody: secret },
        );
      },
    });
    const result = await runMalaysiaMaterialDiagnostic(deps);
    expect(result).toMatchObject({ outcome: "invalid_request", providerRequestsUsed: 1 });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toMatch(/authorization|cookie|jwt|supabase.*secret/i);
  });

  it("passes persistentIngestion=false and never receives a ledger recorder", async () => {
    const fetchQuery = vi.fn(async (_spec, options) => ({
      rows: [raw()], totalRows: 1, pagesFetched: 1 as const, latestAvailablePeriod: "2024",
      diagnosticOptions: options,
    }));
    const { deps } = dependencies({ fetchQuery });
    await runMalaysiaMaterialDiagnostic(deps);
    expect(fetchQuery.mock.calls[0]?.[1]).toMatchObject({ persistentIngestion: false });
    expect(fetchQuery.mock.calls[0]?.[1]).not.toHaveProperty("recordFetchResult");
    expect(fetchQuery.mock.calls[0]?.[1]).not.toHaveProperty("loadLedger");
  });

  it("has no writer, ledger, score, publication, or Buyer Intelligence imports", () => {
    const body = readFileSync(path.resolve(
      process.cwd(), "src/lib/marketIntelligence/server/malaysiaMaterialDiagnostic.ts",
    ), "utf8");
    expect(body).not.toMatch(/getMarketIntelligenceWriter|ingestTradeObservation|recordFetchResult/);
    expect(body).not.toMatch(/market_product_scores|publish|buyer[_-]?intelligence/i);
    expect(body).not.toMatch(/serviceRoleClient|SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/);
  });
});
