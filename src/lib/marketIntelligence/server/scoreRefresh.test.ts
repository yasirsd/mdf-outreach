import { describe, expect, it, vi } from "vitest";
import type { MdfMembership } from "@/lib/auth/membership";
import type {
  MarketReadRepositoryObservation,
  MarketReadRepositoryScore,
} from "../marketReadRepository";
import type { MarketProviderFetchLedgerEntry } from "../types";
import type { MarketIntelligenceWriter } from "./writer";
import { refreshPersistedMarketScore } from "./scoreRefresh";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-09-23T00:00:00.000Z");

function observations(suffix = ""): MarketReadRepositoryObservation[] {
  return Array.from({ length: 7 }, (_, index) => 2018 + index).flatMap((year, index) => [
    {
      id: `MY-${year}-CN${suffix}`,
      sourceId: "source-1",
      providerId: "baci_oec",
      datasetId: "baci-hs17",
      reporterCountry: "MY",
      partnerCountry: "CN",
      tradeFlow: "import" as const,
      hsRevision: "HS17" as const,
      hsCode: "090421",
      frequency: "annual" as const,
      period: String(year),
      tradeValueUsd: 12_000_000 + index * 500_000,
      quantity: 1_200,
      quantityUnit: "tonne",
      netWeightKg: null,
      retrievedAt: "2026-09-20T00:00:00.000Z",
    },
    {
      id: `MY-${year}-IN${suffix}`,
      sourceId: "source-1",
      providerId: "baci_oec",
      datasetId: "baci-hs17",
      reporterCountry: "MY",
      partnerCountry: "IN",
      tradeFlow: "import" as const,
      hsRevision: "HS17" as const,
      hsCode: "090421",
      frequency: "annual" as const,
      period: String(year),
      tradeValueUsd: 4_000_000 + index * 200_000,
      quantity: 400,
      quantityUnit: "tonne",
      netWeightKg: null,
      retrievedAt: "2026-09-20T00:00:00.000Z",
    },
  ]);
}

function ledger(fingerprint: string, rowCount = 14): MarketProviderFetchLedgerEntry {
  return {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    queryFingerprint: fingerprint,
    reporterCountry: "MY",
    partnerCountry: null,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: ["090421"],
    frequency: "annual",
    coverageStart: "2018",
    coverageEnd: "2024",
    providerSelectionVersion: "mi-select-v2",
    fetchedAt: "2026-09-20T00:00:00.000Z",
    freshUntil: "2026-10-20T00:00:00.000Z",
    outcome: "success",
    rowsReceived: rowCount,
    safeMetadata: {},
  };
}

function owner() {
  return Promise.resolve({ membership: { role: "owner" } as MdfMembership });
}

function fakeCurrent(id: string, score: Record<string, unknown>): MarketReadRepositoryScore {
  const components = score.components as Array<Record<string, unknown>>;
  return {
    id,
    countryAlpha2: "MY",
    mdfProductId: "guntur-dry-red-chilli",
    diagnosticFitScore: score.diagnostic_fit_score as number | null,
    publishedFitScore: score.published_fit_score as number | null,
    dataConfidenceScore: score.data_confidence_score as number | null,
    recommendationStatus: score.recommendation_status as MarketReadRepositoryScore["recommendationStatus"],
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    fitEligibility: "proxy_allowed",
    isTradeProxy: true,
    marketFitVersion: score.market_fit_version as string,
    confidenceVersion: score.confidence_version as string,
    providerSelectionVersion: score.provider_selection_version as string,
    recommendationReason: score.recommendation_reason as string,
    positiveReasons: [],
    negativeReasons: score.negative_reasons as string[],
    sourceCoverage: score.source_coverage as Record<string, unknown>,
    calculatedAt: NOW.toISOString(),
    supersededAt: null,
    components: components.map((component, index) => ({
      id: `component-${index}`,
      componentKey: component.component_key as string,
      rawMetricValue: component.raw_metric_value as number | null,
      normalizedScore: component.normalized_score as number | null,
      weight: component.weight as number,
      supported: component.supported as boolean,
      reason: component.reason as string,
      metadata: component.metadata as Record<string, unknown>,
    })),
  };
}

function harness(rows = observations()) {
  let current: MarketReadRepositoryScore | undefined;
  let activeRows = rows;
  let created = 0;
  const refresh = vi.fn(async (input: { payload: { score?: Record<string, unknown> } }) => {
    const score = input.payload.score!;
    const fingerprint = (score.source_coverage as Record<string, unknown>).persistence_fingerprint;
    const existingFingerprint = current?.sourceCoverage.persistence_fingerprint;
    if (
      current &&
      fingerprint === existingFingerprint &&
      current.marketFitVersion === score.market_fit_version
    ) {
      return { outcome: "refreshed" as const, countryAlpha2: "MY", mdfProductId: "guntur-dry-red-chilli", scoreId: current.id };
    }
    created += 1;
    current = fakeCurrent(`score-${created}`, score);
    return { outcome: "refreshed" as const, countryAlpha2: "MY", mdfProductId: "guntur-dry-red-chilli", scoreId: current.id };
  });
  const writer = { refreshMarketIntelligence: refresh } as unknown as MarketIntelligenceWriter;
  const repository = {
    listActiveProductMappings: async () => [{
      id: "mapping-1",
      mdfProductId: "guntur-dry-red-chilli",
      hsRevision: "HS17" as const,
      hsLevel: 6 as const,
      hsCode: "090421",
      tradeLabel: "Dried chillies",
      mappingKind: "proxy" as const,
      mappingConfidence: 0.7,
      fitEligibility: "proxy_allowed" as const,
      scopeDescription: "proxy fixture",
      weight: 1,
      isActive: true,
      registryVersion: "mi-product-map-v1",
    }],
    getSourceByProviderDataset: async () => ({
      id: "source-1",
      providerId: "baci_oec",
      datasetId: "baci-hs17",
      sourceTier: "A" as const,
      datasetSource: "BACI",
      distributionService: "OEC",
      serviceTermsVerified: true,
      storageAllowed: true,
      redistributionAllowed: false,
      licenceVerifiedAt: "2026-09-01T00:00:00.000Z",
      sourceUrl: null,
      retrievedAt: "2026-09-01T00:00:00.000Z",
    }),
    listBilateralAnnualObservations: async () => activeRows,
    listRecentLedgerEntriesForFingerprint: async (
      _provider: string, _dataset: string, fingerprint: string,
    ) => [ledger(fingerprint, activeRows.length)],
    listRecentLedgerEntriesForReporter: async () => [],
    getCurrentMarketScore: async () => current,
  };
  return {
    deps: {
      requireSession: owner,
      loadRepository: async () => repository,
      loadWriter: async () => writer,
      now: () => NOW,
    },
    refresh,
    created: () => created,
    current: () => current,
    changeEvidence: () => { activeRows = observations("-changed"); },
    setCurrent: (value: MarketReadRepositoryScore | undefined) => { current = value; },
  };
}

const REQUEST = { country: "MY", product: "guntur-dry-red-chilli", dryRun: false };

describe("MI1I controlled score refresh", () => {
  it("dry-run computes mi-fit-v2/mi-conf-v1 with six weighted components and performs zero writes", async () => {
    const h = harness();
    const loadWriter = vi.fn(h.deps.loadWriter);
    const result = await refreshPersistedMarketScore(
      { ...REQUEST, dryRun: true },
      { ...h.deps, loadWriter },
    );
    expect(result).toMatchObject({
      outcome: "created",
      dryRun: true,
      country: "MY",
      product: "guntur-dry-red-chilli",
      marketFitVersion: "mi-fit-v2",
      dataConfidenceVersion: "mi-conf-v1",
      recommendationStatus: "indicative",
      componentCount: 6,
      databaseWrites: 0,
      providerCalls: 0,
    });
    expect(result.fit).toEqual(expect.any(Number));
    expect(result.evidenceWatermark).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.components?.map((component) => component.weight)).toEqual([25, 20, 20, 15, 10, 10]);
    expect(loadWriter).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("creates once, reuses the identical score, then supersedes when evidence changes", async () => {
    const h = harness();
    const first = await refreshPersistedMarketScore(REQUEST, h.deps);
    const replay = await refreshPersistedMarketScore(REQUEST, h.deps);
    h.changeEvidence();
    const changed = await refreshPersistedMarketScore(REQUEST, h.deps);
    expect(first.outcome).toBe("created");
    expect(replay.outcome).toBe("unchanged");
    expect(replay.scoreId).toBe(first.scoreId);
    expect(changed.outcome).toBe("superseded_and_created");
    expect(changed.scoreId).not.toBe(first.scoreId);
    expect(h.created()).toBe(2);
  });

  it("supersedes an mi-fit-v1 current row through the explicit refresh", async () => {
    const h = harness();
    await refreshPersistedMarketScore(REQUEST, h.deps);
    const legacy = { ...h.current()!, marketFitVersion: "mi-fit-v1", id: "legacy-score" };
    h.setCurrent(legacy);
    const result = await refreshPersistedMarketScore(REQUEST, h.deps);
    expect(result.outcome).toBe("superseded_and_created");
    expect(result.marketFitVersion).toBe("mi-fit-v2");
  });

  it("keeps Fit null when supported weight is below 55", async () => {
    const h = harness([]);
    const result = await refreshPersistedMarketScore(
      { ...REQUEST, dryRun: true },
      h.deps,
    );
    expect(result.outcome).toBe("insufficient_evidence");
    expect(result.fit).toBeNull();
    expect(result.supportedWeight).toBeLessThan(55);
    expect(result.recommendationStatus).toBe("insufficient_evidence");
  });

  it("rejects a member before reading evidence or loading the writer", async () => {
    const loadRepository = vi.fn();
    const loadWriter = vi.fn();
    const result = await refreshPersistedMarketScore(REQUEST, {
      requireSession: async () => ({ membership: { role: "member" } as MdfMembership }),
      loadRepository,
      loadWriter,
    });
    expect(result.outcome).toBe("forbidden");
    expect(loadRepository).not.toHaveBeenCalled();
    expect(loadWriter).not.toHaveBeenCalled();
  });

  it("concurrent identical requests rely on the writer/RPC identity and create one current score", async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      refreshPersistedMarketScore(REQUEST, h.deps),
      refreshPersistedMarketScore(REQUEST, h.deps),
    ]);
    expect(a.scoreId).toBe(b.scoreId);
    expect(h.created()).toBe(1);
  });
});
