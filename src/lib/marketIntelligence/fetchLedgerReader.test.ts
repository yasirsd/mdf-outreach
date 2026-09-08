import { describe, expect, it } from "vitest";
import { decideMarketFetchWithLedger } from "./fetchLedgerReader";
import type { MarketProviderFetchLedgerEntry } from "./types";

function entry(over: Partial<MarketProviderFetchLedgerEntry>): MarketProviderFetchLedgerEntry {
  return {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    queryFingerprint: "fp-abc",
    reporterCountry: "MY",
    partnerCountry: null,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: ["090421"],
    frequency: "annual",
    coverageStart: "2020",
    coverageEnd: "2024",
    fetchedAt: "2026-09-06T00:00:00.000Z",
    freshUntil: "2026-10-06T00:00:00.000Z",
    outcome: "success",
    rowsReceived: 100,
    providerSelectionVersion: "mi-select-v2",
    ...over,
  };
}

const NOW = new Date("2026-09-06T12:00:00.000Z");

describe("MI1C decideMarketFetchWithLedger", () => {
  it("fresh success → use_cache / fresh_success", async () => {
    const decision = await decideMarketFetchWithLedger(
      {
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        queryFingerprint: "fp-abc",
        coverageStart: "2020",
        coverageEnd: "2024",
        now: NOW,
      },
      async () => [entry({ outcome: "success" })],
    );
    expect(decision.decision).toBe("use_cache");
    if (decision.decision === "use_cache") expect(decision.reason).toBe("fresh_success");
  });

  it("fresh empty → use_cache / fresh_empty", async () => {
    const decision = await decideMarketFetchWithLedger(
      {
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        queryFingerprint: "fp-abc",
        coverageStart: "2020",
        coverageEnd: "2024",
        now: NOW,
      },
      async () => [entry({ outcome: "empty" })],
    );
    expect(decision.decision).toBe("use_cache");
  });

  it("partial → fetch / partial_result", async () => {
    const decision = await decideMarketFetchWithLedger(
      {
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        queryFingerprint: "fp-abc",
        coverageStart: "2020",
        coverageEnd: "2024",
        now: NOW,
      },
      async () => [entry({ outcome: "partial" })],
    );
    expect(decision.decision).toBe("fetch");
    if (decision.decision === "fetch") expect(decision.reason).toBe("partial_result");
  });

  it("timeout → fetch / retry_timeout", async () => {
    const decision = await decideMarketFetchWithLedger(
      {
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        queryFingerprint: "fp-abc",
        coverageStart: "2020",
        coverageEnd: "2024",
        now: NOW,
      },
      async () => [entry({ outcome: "timeout" })],
    );
    expect(decision.decision).toBe("fetch");
  });

  it("quota_exhausted with future retryAfter → blocked / quota_exhausted", async () => {
    const decision = await decideMarketFetchWithLedger(
      {
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        queryFingerprint: "fp-abc",
        coverageStart: "2020",
        coverageEnd: "2024",
        now: NOW,
      },
      async () => [
        entry({
          outcome: "quota_exhausted",
          retryAfter: "2027-01-01T00:00:00.000Z",
        } as MarketProviderFetchLedgerEntry & { retryAfter: string }),
      ],
    );
    expect(decision.decision).toBe("blocked");
  });

  it("no ledger entry at all → fetch / no_cache_entry", async () => {
    const decision = await decideMarketFetchWithLedger(
      {
        providerId: "baci_oec",
        datasetId: "baci-hs17",
        queryFingerprint: "fp-abc",
        coverageStart: "2020",
        coverageEnd: "2024",
        now: NOW,
      },
      async () => [],
    );
    expect(decision.decision).toBe("fetch");
    if (decision.decision === "fetch") expect(decision.reason).toBe("no_cache_entry");
  });
});
