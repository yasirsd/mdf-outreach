import { describe, expect, it } from "vitest";
import { marketQueryFingerprint, shouldFetchMarketData } from "./fetchLedger";
import type { MarketProviderFetchLedgerEntry } from "./types";

const query = {
  providerId: "baci_oec", datasetId: "baci-hs17", reporterCountry: "MY",
  partnerCountry: null, tradeFlow: "import" as const, hsRevision: "HS17" as const,
  hsCodes: ["090421", "090422"], frequency: "annual" as const,
  coverageStart: "2020", coverageEnd: "2024", providerSelectionVersion: "mi-select-v2",
};
const fingerprint = marketQueryFingerprint(query);
const now = new Date("2026-09-06T00:00:00.000Z");

function entry(overrides: Partial<MarketProviderFetchLedgerEntry> = {}): MarketProviderFetchLedgerEntry {
  return {
    ...query, queryFingerprint: fingerprint,
    fetchedAt: "2026-09-01T00:00:00.000Z", freshUntil: "2026-10-01T00:00:00.000Z",
    outcome: "success", rowsReceived: 20, ...overrides,
  };
}

function decide(row: MarketProviderFetchLedgerEntry) {
  return shouldFetchMarketData({
    providerId: query.providerId, datasetId: query.datasetId, queryFingerprint: fingerprint,
    coverageStart: query.coverageStart, coverageEnd: query.coverageEnd, now, entries: [row],
  });
}

describe("MI1A market query fingerprint", () => {
  it("is order-independent for the HS-code set", () => {
    expect(marketQueryFingerprint({ ...query, hsCodes: ["090422", "090421", "090421"] }))
      .toBe(fingerprint);
  });

  it("changes for every material query dimension", () => {
    for (const changed of [
      { providerId: "other_provider" }, { datasetId: "other" },
      { reporterCountry: "AE" }, { partnerCountry: "IN" },
      { tradeFlow: "export" as const }, { hsRevision: "HS22" as const },
      { hsCodes: ["090421"] }, { frequency: "monthly" as const },
      { coverageStart: "2021" }, { coverageEnd: "2023" },
      { providerSelectionVersion: "mi-select-v3" },
    ]) expect(marketQueryFingerprint({ ...query, ...changed })).not.toBe(fingerprint);
  });

  it("ignores extra secret-bearing properties", () => {
    const withSecret = { ...query, apiKey: "must-never-appear", cookie: "secret" };
    const value = marketQueryFingerprint(withSecret);
    expect(value).toBe(fingerprint);
    expect(value).not.toContain("must-never-appear");
    expect(value).not.toContain("secret");
  });
});

describe("MI1A fetch-ledger decision contract", () => {
  it("uses fresh success and fresh empty entries as cache", () => {
    expect(decide(entry()).decision).toBe("use_cache");
    expect(decide(entry({ outcome: "empty", rowsReceived: 0 }))).toMatchObject({
      decision: "use_cache", reason: "fresh_empty",
    });
  });

  it("fetches for partial, timeout, and provider-error outcomes", () => {
    for (const outcome of ["partial", "timeout", "provider_error"] as const) {
      expect(decide(entry({ outcome })).decision).toBe("fetch");
    }
  });

  it("blocks exhausted quota until its known recovery time", () => {
    expect(decide(entry({ outcome: "quota_exhausted" }))).toMatchObject({
      decision: "blocked", reason: "quota_exhausted",
    });
    expect(decide(entry({ outcome: "quota_exhausted", retryAfter: "2026-09-05T00:00:00.000Z" }))).toMatchObject({
      decision: "fetch", reason: "quota_recovery_reached",
    });
  });

  it("blocks invalid requests until the query fingerprint changes", () => {
    expect(decide(entry({ outcome: "invalid_request" }))).toMatchObject({
      decision: "blocked", reason: "invalid_request",
    });
  });

  it("honours unavailable cooldown and rejects incomplete coverage as cache", () => {
    expect(decide(entry({ outcome: "unavailable", retryAfter: "2026-09-07T00:00:00.000Z" })).decision)
      .toBe("blocked");
    expect(decide(entry({ coverageStart: "2022" }))).toMatchObject({
      decision: "fetch", reason: "incomplete_coverage",
    });
  });
});
