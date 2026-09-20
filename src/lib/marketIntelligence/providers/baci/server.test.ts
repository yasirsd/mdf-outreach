import { iso31661 } from "iso-3166";
import { describe, expect, it, vi } from "vitest";
import type { MarketProviderFetchLedgerEntry } from "../../types";
import { baciQueryFingerprint, buildMalaysiaChilliProofQuery } from "./contract";
import { BaciProviderError } from "./normalize";
import {
  BaciOecConfigError,
  fetchBaciQuery,
  fetchBaciQueryWithLedger,
} from "./server";

const spec = buildMalaysiaChilliProofQuery();
const env = { ...process.env, BACI_OEC_API_KEY: "bot_market_ak_test-only" };
const exporters = iso31661.map((country) => country.alpha3.toLowerCase());

function rows(count: number, start = 0) {
  return Array.from({ length: count }, (_, index) => {
    const identity = start + index;
    return {
      year: 2017 + Math.floor(identity / exporters.length),
      exporter_id: exporters[identity % exporters.length],
      exporter_name: `Exporter ${identity % exporters.length}`,
      importer_id: "mys",
      importer_name: "Malaysia",
      hs_code: "090421",
      product_name: "Dried Capsicum/Pimenta, neither crushed nor ground",
      hs_revision: 5,
      value: identity + 1,
      quantity: 1,
      unit_abbrevation: "mt",
      unit_name: "Metric Tonne",
    };
  });
}

function response(pageRows: unknown[], total: number, offset?: number): Response {
  return new Response(JSON.stringify({ rows: pageRows, total, ...(offset === undefined ? {} : { offset }) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function ledgerEntry(overrides: Partial<MarketProviderFetchLedgerEntry> = {}): MarketProviderFetchLedgerEntry {
  return {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    queryFingerprint: baciQueryFingerprint(spec),
    reporterCountry: "MY",
    partnerCountry: null,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCodes: ["090421"],
    frequency: "annual",
    providerSelectionVersion: "mi-select-v2",
    coverageStart: "2017",
    coverageEnd: "2024",
    fetchedAt: "2026-09-19T00:00:00.000Z",
    freshUntil: "2026-10-19T00:00:00.000Z",
    outcome: "success",
    rowsReceived: 1001,
    ...overrides,
  };
}

describe("MI1D.1 bounded BACI pagination", () => {
  it("fails closed before fetch when the server credential is missing", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchBaciQuery(spec, {
      fetchImpl: fetchImpl as typeof fetch,
      env: {} as NodeJS.ProcessEnv,
    })).rejects.toBeInstanceOf(BaciOecConfigError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("completes totals below 1000 in one request", async () => {
    const fetchImpl = vi.fn(async () => response(rows(2), 2));
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .resolves.toMatchObject({ totalRows: 2, pagesFetched: 1, latestAvailablePeriod: "2017" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats total=1000 as complete in one request", async () => {
    const fetchImpl = vi.fn(async () => response(rows(1000), 1000));
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .resolves.toMatchObject({ totalRows: 1000, pagesFetched: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches total=1001 in exactly two requests with page 2 offset=1000", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return offset === 0 ? response(rows(1000), 1001, 0) : response(rows(1, 1000), 1001, 1000);
    });
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .resolves.toMatchObject({ totalRows: 1001, pagesFetched: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get("offset")).toBe("1000");
  });

  it("never exceeds two pages for a complete result within the proof budget", async () => {
    const total = exporters.length * 8;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return offset === 0
        ? response(rows(1000), total)
        : response(rows(total - 1000, 1000), total);
    });
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .resolves.toMatchObject({ totalRows: total, pagesFetched: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops after page 1 with partial/proof_budget_exceeded when total exceeds 2000", async () => {
    const fetchImpl = vi.fn(async () => response(rows(1000), 2001));
    await expect(fetchBaciQuery(spec, { fetchImpl: fetchImpl as typeof fetch, env }))
      .rejects.toMatchObject({ outcome: "partial", reason: "proof_budget_exceeded", rowsReceived: 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects row-count gaps, total changes, and cross-page duplicates", async () => {
    const gapFetch = vi.fn(async () => response(rows(999), 1001));
    await expect(fetchBaciQuery(spec, { fetchImpl: gapFetch as typeof fetch, env }))
      .rejects.toMatchObject({ outcome: "partial", reason: "pagination_gap" });
    expect(gapFetch).toHaveBeenCalledTimes(1);

    const changedTotal = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return offset === 0 ? response(rows(1000), 1001) : response(rows(1, 1000), 1002);
    });
    await expect(fetchBaciQuery(spec, { fetchImpl: changedTotal as typeof fetch, env }))
      .rejects.toMatchObject({ reason: "total_count_changed" });

    const duplicate = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return offset === 0 ? response(rows(1000), 1001) : response(rows(1), 1001);
    });
    await expect(fetchBaciQuery(spec, { fetchImpl: duplicate as typeof fetch, env }))
      .rejects.toMatchObject({ outcome: "partial", reason: "duplicate_rows" });
  });

  it("keeps credentials in the bearer header and preserves typed HTTP failures", async () => {
    const secureFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).not.toContain("bot_market_ak_test-only");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer bot_market_ak_test-only");
      return response(rows(1), 1);
    });
    await fetchBaciQuery(spec, { fetchImpl: secureFetch as typeof fetch, env });

    for (const [status, outcome] of [[500, "provider_error"], [422, "invalid_request"], [429, "quota_exhausted"]] as const) {
      await expect(fetchBaciQuery(spec, {
        fetchImpl: vi.fn(async () => new Response("failure", { status })) as typeof fetch,
        env,
      })).rejects.toMatchObject({ outcome });
    }
  });

  it("turns aborts into timeout rather than empty observations", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
    await expect(fetchBaciQuery(spec, {
      fetchImpl: fetchImpl as typeof fetch,
      env,
      timeoutMs: 1,
    })).rejects.toMatchObject({ outcome: "timeout" });
  });
});

describe("MI1D.1 single-identity fetch ledger", () => {
  it("uses one fresh logical cache entry and exposes its expected row count", async () => {
    const fetchImpl = vi.fn();
    const recordFetchResult = vi.fn();
    await expect(fetchBaciQueryWithLedger(spec, {
      env,
      fetchImpl: fetchImpl as typeof fetch,
      loadLedger: async () => [ledgerEntry()],
      recordFetchResult,
      now: () => new Date("2026-09-20T00:00:00.000Z"),
    })).resolves.toMatchObject({ outcome: "use_cache", expectedRows: 1001 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(recordFetchResult).not.toHaveBeenCalled();
  });

  it("returns one combined success record for a two-page retrieval", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return offset === 0 ? response(rows(1000), 1001) : response(rows(1, 1000), 1001);
    });
    const recordFetchResult = vi.fn();
    const result = await fetchBaciQueryWithLedger(spec, {
      env,
      fetchImpl: fetchImpl as typeof fetch,
      loadLedger: async () => [],
      recordFetchResult,
      now: () => new Date("2026-09-20T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      outcome: "fetched",
      result: { totalRows: 1001, pagesFetched: 2 },
      completionLedgerRecord: {
        outcome: "success",
        rows_received: 1001,
        reporter_country: "MY",
        partner_country: null,
        safe_metadata: { query_kind: "canonical_bilateral", pages_fetched: 2 },
      },
    });
    expect(recordFetchResult).not.toHaveBeenCalled();
  });

  it("records one partial failure with received rows and no success identity", async () => {
    const recordFetchResult = vi.fn(async () => ({ outcome: "recorded" as const, id: "partial" }));
    await expect(fetchBaciQueryWithLedger(spec, {
      env,
      fetchImpl: vi.fn(async () => response(rows(1000), 2001)) as typeof fetch,
      loadLedger: async () => [],
      recordFetchResult,
      now: () => new Date("2026-09-20T00:00:00.000Z"),
    })).rejects.toBeInstanceOf(BaciProviderError);
    expect(recordFetchResult).toHaveBeenCalledTimes(1);
    expect(recordFetchResult).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "partial",
      rows_received: 1000,
      safe_metadata: expect.objectContaining({ failure_reason: "proof_budget_exceeded" }),
    }));
  });

  it("blocks an exhausted ledger before provider execution", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchBaciQueryWithLedger(spec, {
      env,
      fetchImpl: fetchImpl as typeof fetch,
      loadLedger: async () => [ledgerEntry({
        outcome: "quota_exhausted",
        freshUntil: "2026-09-19T00:00:00.000Z",
        retryAfter: "2026-09-21T00:00:00.000Z",
      })],
      recordFetchResult: vi.fn(),
      now: () => new Date("2026-09-20T00:00:00.000Z"),
    })).resolves.toMatchObject({ outcome: "blocked", reason: "quota_exhausted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
