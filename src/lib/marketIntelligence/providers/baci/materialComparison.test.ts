import { describe, expect, it } from "vitest";
import type { MarketReadRepositoryMaterialObservation } from "../../marketReadRepository";
import { compareBaciObservationMaterial } from "./materialComparison";
import { normalizeBaciBilateralRows, type BaciWireRow } from "./normalize";

const RETRIEVED_AT = "2026-09-21T00:00:00.000Z";

function raw(overrides: Partial<BaciWireRow> = {}): BaciWireRow {
  return {
    year: 2024,
    exporter_id: "ind",
    exporter_name: "India",
    importer_id: "mys",
    importer_name: "Malaysia",
    hs_code: "090421",
    product_name: "Dried chillies",
    hs_revision: 2017,
    value: 1234.5,
    quantity: 7.25,
    unit_abbrevation: "mt",
    unit_name: "Metric tons",
    ...overrides,
  };
}

function persistedFrom(
  row: ReturnType<typeof normalizeBaciBilateralRows>[number],
  overrides: Partial<MarketReadRepositoryMaterialObservation> = {},
): MarketReadRepositoryMaterialObservation {
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
    retrievedAt: RETRIEVED_AT,
    ...overrides,
  };
}

function comparison(
  rawRows: BaciWireRow[],
  persistedOverrides: Partial<MarketReadRepositoryMaterialObservation> = {},
) {
  const normalized = normalizeBaciBilateralRows(rawRows, RETRIEVED_AT);
  const persisted = normalized.map((row) => persistedFrom(row, persistedOverrides));
  return compareBaciObservationMaterial(normalized, persisted, rawRows);
}

describe("MI1F.2 BACI observation material comparator", () => {
  it("reports all exact matches", () => {
    const result = comparison([raw()]);
    expect(result).toMatchObject({
      providerRows: 1,
      persistedRows: 1,
      exactMatches: 1,
      mismatches: 0,
      providerOnly: 0,
      persistedOnly: 0,
    });
    expect(result.examples).toEqual([]);
  });

  it("attributes a trade-value mismatch to the raw provider value", () => {
    const result = comparison([raw()], { tradeValueUsd: 1200 });
    expect(result.mismatchFieldCounts.trade_value_usd).toBe(1);
    expect(result.examples[0]).toMatchObject({
      differingFields: ["trade_value_usd"],
      differenceOrigins: { trade_value_usd: "raw_provider_value_differs" },
      persisted: { trade_value_usd: 1200 },
      provider: { trade_value_usd: 1234.5 },
      rawProvider: { trade_value_usd: 1234.5 },
    });
    expect(result.mismatchOriginCounts).toEqual({
      raw_provider_value_differs: 1,
      normalization_or_derived_value_differs: 0,
    });
  });

  it("attributes a quantity mismatch to the raw provider value", () => {
    const result = comparison([raw()], { quantity: 6 });
    expect(result.mismatchFieldCounts.quantity).toBe(1);
    expect(result.examples[0]?.differenceOrigins?.quantity).toBe("raw_provider_value_differs");
  });

  it("keeps null distinct from numeric zero", () => {
    const rawRow = raw({ quantity: null, unit_abbrevation: null, unit_name: null });
    const result = comparison([rawRow], { quantity: 0 });
    expect(result.mismatchFieldCounts.quantity).toBe(1);
    expect(result.examples[0]).toMatchObject({
      persisted: { quantity: 0 },
      provider: { quantity: null },
    });
  });

  it("flags net weight as normalization-derived because BACI has no raw field", () => {
    const result = comparison([raw()], { netWeightKg: 7250 });
    expect(result.mismatchFieldCounts.net_weight_kg).toBe(1);
    expect(result.examples[0]).toMatchObject({
      differenceOrigins: { net_weight_kg: "normalization_or_derived_value_differs" },
      provider: { net_weight_kg: null },
      rawProvider: { net_weight_kg: "not_provided" },
    });
    expect(result.mismatchOriginCounts.normalization_or_derived_value_differs).toBe(1);
  });

  it("flags a source URL mismatch as normalization/provenance-derived", () => {
    const result = comparison([raw()], { sourceUrl: "https://example.test/old" });
    expect(result.mismatchFieldCounts.source_url).toBe(1);
    expect(result.examples[0]?.differenceOrigins?.source_url)
      .toBe("normalization_or_derived_value_differs");
  });

  it("reports provider-only and persisted-only identities", () => {
    const providerRaw = raw({ exporter_id: "chn", exporter_name: "China" });
    const persistedRaw = raw({ exporter_id: "ind", exporter_name: "India" });
    const normalized = normalizeBaciBilateralRows([providerRaw], RETRIEVED_AT);
    const oldNormalized = normalizeBaciBilateralRows([persistedRaw], RETRIEVED_AT);
    const result = compareBaciObservationMaterial(
      normalized,
      [persistedFrom(oldNormalized[0]!)],
      [providerRaw],
    );
    expect(result).toMatchObject({ providerOnly: 1, persistedOnly: 1, exactMatches: 0 });
    expect(result.examples.map((example) => example.kind).sort())
      .toEqual(["persisted_only", "provider_only"]);
  });

  it("counts multiple differing fields on one identity", () => {
    const result = comparison([raw()], {
      tradeValueUsd: 1,
      quantity: 2,
      quantityUnit: "kg",
      safeSourceRef: "old reference",
    });
    expect(result.mismatches).toBe(1);
    expect(result.examples[0]?.differingFields).toEqual([
      "trade_value_usd", "quantity", "quantity_unit", "safe_source_ref",
    ]);
  });

  it("treats numerically equal formatting as equal", () => {
    const result = comparison([raw({ value: 1234.50, quantity: 7.250 })], {
      tradeValueUsd: 1234.5,
      quantity: 7.25,
    });
    expect(result.exactMatches).toBe(1);
    expect(result.mismatches).toBe(0);
  });

  it("limits safe examples to ten", () => {
    const raws = Array.from({ length: 12 }, (_, index) => raw({ year: 2010 + index }));
    const normalized = normalizeBaciBilateralRows(raws, RETRIEVED_AT);
    const persisted = normalized.map((row, index) => persistedFrom(row, {
      id: `observation-${index}`,
      tradeValueUsd: 0,
    }));
    const result = compareBaciObservationMaterial(normalized, persisted, raws);
    expect(result.mismatches).toBe(12);
    expect(result.examples).toHaveLength(10);
  });
});
