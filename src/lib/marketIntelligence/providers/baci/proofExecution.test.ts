import { describe, expect, it, vi } from "vitest";
import type { MarketReadRepositoryObservation } from "../../marketReadRepository";
import type { MarketIntelligenceWriter } from "../../server/writer";
import { executeControlledMalaysiaChilliProof } from "./proofExecution";

function providerRow(year: number, exporter: string, value: number, quantity: number | null) {
  return {
    year,
    exporter_id: exporter,
    exporter_name: exporter === "ind" ? "India" : "China",
    importer_id: "mys",
    importer_name: "Malaysia",
    hs_code: "090421",
    product_name: "Dried Capsicum/Pimenta, neither crushed nor ground",
    hs_revision: 5,
    value,
    quantity,
    unit_abbrevation: "mt",
    unit_name: "Metric Tonne",
  };
}

describe("MI1D.1 controlled proof orchestration", () => {
  it("uses one canonical fetch, stores only bilateral rows, derives every report view, then records one success", async () => {
    const stored: MarketReadRepositoryObservation[] = [];
    let sourceId: string | undefined;
    const ledgerRecords: unknown[] = [];
    const eventOrder: string[] = [];
    const repository = {
      getSourceByProviderDataset: vi.fn(async () => sourceId ? {
        id: sourceId,
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        sourceTier: "B" as const,
        datasetSource: "CEPII BACI",
        distributionService: "OEC BotMarket",
        serviceTermsVerified: true,
        storageAllowed: true,
        redistributionAllowed: false,
        licenceVerifiedAt: "2026-09-20T00:00:00.000Z",
        sourceUrl: null,
        retrievedAt: "2026-09-20T12:00:00.000Z",
      } : undefined),
      listRecentLedgerEntriesForFingerprint: vi.fn(async () => []),
      listBilateralAnnualObservations: vi.fn(async () => stored),
    };
    const writer = {
      ingestSource: vi.fn(async () => {
        eventOrder.push("source");
        sourceId = "source-id";
        return { outcome: "created" as const, id: sourceId };
      }),
      verifySourceRights: vi.fn(async () => {
        eventOrder.push("rights");
        return { outcome: "verified" as const, id: "source-id" };
      }),
      ingestTradeObservation: vi.fn(async ({ observation }) => {
        eventOrder.push("observation");
        stored.push({
          id: `obs-${stored.length}`,
          sourceId: "source-id",
          providerId: "baci_oec",
          datasetId: "baci-hs17",
          reporterCountry: observation.reporter_country,
          partnerCountry: observation.partner_country ?? null,
          tradeFlow: observation.trade_flow,
          hsRevision: "HS17",
          hsCode: observation.hs_code,
          frequency: "annual",
          period: observation.period,
          tradeValueUsd: observation.trade_value_usd ?? null,
          quantity: observation.quantity ?? null,
          quantityUnit: observation.quantity_unit ?? null,
          netWeightKg: observation.net_weight_kg ?? null,
          retrievedAt: observation.retrieved_at,
        });
        return { outcome: "created" as const, id: `obs-${stored.length - 1}` };
      }),
      recordFetchResult: vi.fn(async (input) => {
        eventOrder.push("ledger-success");
        ledgerRecords.push(input);
        return { outcome: "recorded" as const, id: `ledger-${ledgerRecords.length}` };
      }),
    } satisfies Pick<MarketIntelligenceWriter,
      "ingestSource" | "verifySourceRights" | "ingestTradeObservation" | "recordFetchResult">;

    const rows = [
      providerRow(2023, "ind", 7, 1),
      providerRow(2023, "chn", 3, 1),
      providerRow(2024, "ind", 8, 2),
      providerRow(2024, "chn", 12, 2),
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ rows, total: rows.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const result = await executeControlledMalaysiaChilliProof({
      repository,
      writer,
      fetchImpl: fetchImpl as typeof fetch,
      env: { ...process.env, BACI_OEC_API_KEY: "bot_market_ak_test-only" },
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    });
    expect(result).toMatchObject({
      outcome: "completed",
      fetches: { canonical_bilateral: "fetched" },
      observations: { created: 4, existing: 0 },
      report: {
        latestAvailableYear: "2024",
        totalImportValueUsd: 20,
        totalImportQuantityTonnes: 4,
        indiaImportValueUsd: 8,
        indiaShare: 0.4,
        indiaRank: 2,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(writer.ingestTradeObservation).toHaveBeenCalledTimes(4);
    expect(stored.every((item) => item.partnerCountry !== null)).toBe(true);
    expect(ledgerRecords).toHaveLength(1);
    expect(ledgerRecords[0]).toMatchObject({ outcome: "success", rows_received: 4 });
    expect(eventOrder.indexOf("source")).toBeLessThan(eventOrder.indexOf("observation"));
    expect(eventOrder.indexOf("rights")).toBeLessThan(eventOrder.indexOf("observation"));
    expect(eventOrder.lastIndexOf("observation")).toBeLessThan(eventOrder.indexOf("ledger-success"));
    expect(JSON.stringify(stored)).not.toContain("090422");
  });

  it("does not mark fetched data complete when SQL reports a material mismatch", async () => {
    const recordFetchResult = vi.fn(async () => ({ outcome: "recorded" as const, id: "ledger" }));
    const result = await executeControlledMalaysiaChilliProof({
      repository: {
        getSourceByProviderDataset: async () => ({
          id: "source-id", providerId: "baci_oec", datasetId: "baci-hs17", sourceTier: "B",
          datasetSource: "CEPII BACI", distributionService: "OEC BotMarket",
          serviceTermsVerified: true, storageAllowed: true, redistributionAllowed: false,
          licenceVerifiedAt: "2026-09-20T00:00:00.000Z", sourceUrl: null,
          retrievedAt: "2026-09-20T00:00:00.000Z",
        }),
        listRecentLedgerEntriesForFingerprint: async () => [],
        listBilateralAnnualObservations: async () => [],
      },
      writer: {
        ingestSource: vi.fn(),
        verifySourceRights: async () => ({ outcome: "verified", id: "source-id" }),
        ingestTradeObservation: async () => ({
          outcome: "conflict", id: "existing", reason: "material_mismatch",
        }),
        recordFetchResult,
      },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        rows: [providerRow(2024, "ind", 10, 2)],
        total: 1,
      }), { status: 200 })) as typeof fetch,
      env: { ...process.env, BACI_OEC_API_KEY: "bot_market_ak_test-only" },
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    });
    expect(result).toEqual({ outcome: "observation_conflict", reason: "material_mismatch" });
    expect(recordFetchResult).not.toHaveBeenCalled();
  });

  it("records partial and performs no source or observation persistence when the proof budget is exceeded", async () => {
    const ingestSource = vi.fn();
    const ingestTradeObservation = vi.fn();
    const recordFetchResult = vi.fn(async () => ({ outcome: "recorded" as const, id: "partial" }));
    await expect(executeControlledMalaysiaChilliProof({
      repository: {
        getSourceByProviderDataset: vi.fn(),
        listRecentLedgerEntriesForFingerprint: async () => [],
        listBilateralAnnualObservations: async () => [],
      },
      writer: {
        ingestSource,
        verifySourceRights: vi.fn(),
        ingestTradeObservation,
        recordFetchResult,
      },
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        rows: Array.from({ length: 1000 }, () => providerRow(2024, "ind", 1, 1)),
        total: 2001,
      }), { status: 200 })) as typeof fetch,
      env: { ...process.env, BACI_OEC_API_KEY: "bot_market_ak_test-only" },
      now: () => new Date("2026-09-20T12:00:00.000Z"),
    })).rejects.toMatchObject({ outcome: "partial", reason: "proof_budget_exceeded" });
    expect(ingestSource).not.toHaveBeenCalled();
    expect(ingestTradeObservation).not.toHaveBeenCalled();
    expect(recordFetchResult).toHaveBeenCalledTimes(1);
  });
});
