import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACI_OEC_PROVIDER } from "../../providers";
import {
  BACI_LATEST_VERIFIED_YEAR,
  BACI_NATIVE_HS17_START_YEAR,
  EXCLUDED_GROUND_CHILLI_HS17_CODE,
  MALAYSIA_CHILLI_HS17_CODE,
  baciQueryFingerprint,
  baciQueryUrl,
  buildMalaysiaChilliProofQuery,
} from "./contract";
import { BaciCountryCodeError, fromBaciCountryId, toBaciCountryId } from "./country";
import {
  BaciProviderError,
  normalizeBaciBilateralRows,
  parseBaciQueryPage,
  parseBaciWireRow,
  type BaciRawRow,
} from "./normalize";
import { buildBaciDevelopmentReport } from "./report";
import {
  buildBaciSourceRegistration,
  buildBaciSourceVerification,
  toMarketTradeObservationBody,
} from "./source";

function row(overrides: Partial<BaciRawRow> = {}): BaciRawRow {
  return {
    year: 2024,
    exporter_id: "ind",
    exporter_name: "India",
    importer_id: "mys",
    importer_name: "Malaysia",
    hs_code: "090421",
    product_name: "Dried Capsicum/Pimenta, neither crushed nor ground",
    hs_revision: 5,
    value: 10,
    quantity: 2,
    unit_abbrevation: "mt",
    unit_name: "Metric Tonne",
    ...overrides,
  };
}

describe("MI1D.1 BACI provider and canonical query", () => {
  it("remains free-only, key-required, annual HS17, with no tariff capability", () => {
    expect(BACI_OEC_PROVIDER).toMatchObject({
      providerId: "baci_oec",
      costClass: "free",
      requiresKey: true,
      requiresCard: false,
      queryResultLimit: 1000,
      frequency: ["annual"],
    });
    expect(BACI_OEC_PROVIDER.capabilities).not.toContain("tariff_data");
  });

  it("maps only at the provider boundary", () => {
    expect(toBaciCountryId("MY")).toBe("mys");
    expect(fromBaciCountryId("MYS")).toBe("MY");
    expect(() => fromBaciCountryId("zzz")).toThrow(BaciCountryCodeError);
  });

  it("defines exactly one all-exporter scope for MY × HS17 090421 × 2017–2024", () => {
    const query = buildMalaysiaChilliProofQuery();
    expect(query).toMatchObject({
      kind: "canonical_bilateral",
      importerId: "mys",
      partnerCountry: null,
      hsCode: MALAYSIA_CHILLI_HS17_CODE,
      limit: 1000,
    });
    expect(query.exporterId).toBeUndefined();
    expect(query.years[0]).toBe(BACI_NATIVE_HS17_START_YEAR);
    expect(query.years.at(-1)).toBe(BACI_LATEST_VERIFIED_YEAR);
    expect(JSON.stringify(query)).not.toContain(EXCLUDED_GROUND_CHILLI_HS17_CODE);
  });

  it("uses offsets only in transport URLs, never in the logical fingerprint", () => {
    const query = buildMalaysiaChilliProofQuery();
    const page1 = new URL(baciQueryUrl(query, 0));
    const page2 = new URL(baciQueryUrl(query, 1000));
    expect(page1.searchParams.get("offset")).toBe("0");
    expect(page2.searchParams.get("offset")).toBe("1000");
    expect(page2.searchParams.get("exporter_id")).toBeNull();
    expect(page2.toString()).not.toMatch(/key|token|authorization|bearer/i);
    expect(baciQueryFingerprint(query)).toBe(baciQueryFingerprint(buildMalaysiaChilliProofQuery()));
  });
});

describe("MI1D.1 BACI page parsing and raw normalization", () => {
  const spec = buildMalaysiaChilliProofQuery();

  it("requires provider total and rejects malformed, off-scope, or offset-mismatched pages", () => {
    expect(() => parseBaciQueryPage({ rows: [row()] }, spec)).toThrow(BaciProviderError);
    expect(() => parseBaciQueryPage({ rows: [row({ hs_code: "090422" })], total: 1 }, spec))
      .toThrow(/classification/);
    expect(() => parseBaciQueryPage({ rows: [row({ importer_id: "sgp" })], total: 1 }, spec))
      .toThrow(/country/);
    expect(() => parseBaciQueryPage({ rows: [row()], total: 1, offset: 999 }, spec, 1000))
      .toThrow(/offset/);
    expect(() => parseBaciQueryPage({ nope: [] }, spec)).toThrow(/did not contain rows/);
  });

  it("accepts rows/data envelopes while preserving total and requested offset", () => {
    expect(parseBaciQueryPage({ rows: [row()], total: 1 }, spec)).toMatchObject({
      totalRows: 1,
      offset: 0,
    });
    expect(parseBaciQueryPage({ data: [row()], total_count: 1001 }, spec, 1000)).toMatchObject({
      totalRows: 1001,
      offset: 1000,
    });
  });

  it("persists only raw bilateral rows with canonical alpha-2 partners", () => {
    const observations = normalizeBaciBilateralRows([
      row({ year: 2023, exporter_id: "ind", quantity: null }),
      row({ year: 2024, exporter_id: "chn", quantity: 0 }),
    ], "2026-09-20T12:00:00.000Z");
    expect(observations).toHaveLength(2);
    expect(observations.every((item) => item.partnerCountry !== null)).toBe(true);
    expect(observations[0]).toMatchObject({ partnerCountry: "IN", quantity: null, quantityUnit: null });
    expect(observations[1]).toMatchObject({ partnerCountry: "CN", quantity: 0, quantityUnit: "tonne" });
    expect(observations[0]?.metadata).toMatchObject({ source_row_kind: "bilateral_raw" });
  });

  it("canonicalizes observed BACI numeric noise while preserving null", () => {
    const observations = normalizeBaciBilateralRows([
      row({ year: 2023, value: 675.9999999999999, quantity: 0.052000000000000005 }),
      row({ year: 2024, value: 240914.00000000003, quantity: null }),
    ], "2026-09-20T12:00:00.000Z");
    expect(observations[0]).toMatchObject({ tradeValueUsd: 676, quantity: 0.052 });
    expect(observations[1]).toMatchObject({ tradeValueUsd: 240914, quantity: null });
  });

  it("retains the existing rejection of negative provider values", () => {
    expect(() => parseBaciWireRow(row({ value: -1 }))).toThrow(BaciProviderError);
    expect(() => parseBaciWireRow(row({ quantity: -0.001 }))).toThrow(BaciProviderError);
  });

  it("rejects duplicate provider rows before persistence", () => {
    expect(() => normalizeBaciBilateralRows([row(), row()], "2026-09-20T12:00:00.000Z"))
      .toThrow(/duplicate bilateral/);
  });
});

describe("MI1D.1 report derivation from the canonical bilateral set", () => {
  it("derives world totals, India history, latest origins, share, rank, and latest period", () => {
    const observations = normalizeBaciBilateralRows([
      row({ year: 2022, exporter_id: "ind", value: 7, quantity: 1 }),
      row({ year: 2022, exporter_id: "chn", value: 3, quantity: 1 }),
      row({ year: 2023, exporter_id: "ind", value: 8, quantity: 2 }),
      row({ year: 2023, exporter_id: "chn", value: 12, quantity: 2 }),
    ], "2026-09-20T12:00:00.000Z");
    const report = buildBaciDevelopmentReport(observations);
    expect(report).toMatchObject({
      latestAvailableYear: "2023",
      totalImportValueUsd: 20,
      totalImportQuantityTonnes: 4,
      indiaImportValueUsd: 8,
      indiaShare: 0.4,
      indiaRank: 2,
      rawEvidence: "BACI bilateral exporter-to-Malaysia observations",
      worldTotalDerivation: "MDF sum of complete BACI bilateral observations",
    });
    expect(report.annualImports).toEqual([
      { year: "2022", tradeValueUsd: 10, quantityTonnes: 2 },
      { year: "2023", tradeValueUsd: 20, quantityTonnes: 4 },
    ]);
    expect(report.annualImportsFromIndia).toEqual([
      { year: "2022", tradeValueUsd: 7 },
      { year: "2023", tradeValueUsd: 8 },
    ]);
    expect(report.topOrigins.map((item) => item.country)).toEqual(["CN", "IN"]);
  });

  it("keeps missing quantity missing and blocks mixed-unit aggregation independently of value", () => {
    const missing = normalizeBaciBilateralRows([
      row({ exporter_id: "ind", value: 4, quantity: 0 }),
      row({ exporter_id: "chn", value: 6, quantity: null }),
    ], "2026-09-20T12:00:00.000Z");
    expect(buildBaciDevelopmentReport(missing)).toMatchObject({
      totalImportValueUsd: 10,
      totalImportQuantityTonnes: null,
      usdPerKg: null,
    });

    expect(buildBaciDevelopmentReport([
      { period: "2024", partnerCountry: "IN", tradeValueUsd: 4, quantity: 1, quantityUnit: "tonne" },
      { period: "2024", partnerCountry: "CN", tradeValueUsd: 6, quantity: 1000, quantityUnit: "kg" },
    ])).toMatchObject({
      totalImportValueUsd: 10,
      totalImportQuantityTonnes: null,
    });
  });

  it("keeps aggregate outputs free of binary representation tails", () => {
    expect(buildBaciDevelopmentReport([
      {
        period: "2024", partnerCountry: "IN", tradeValueUsd: 0.1,
        quantity: 36346.7, quantityUnit: "tonne",
      },
      {
        period: "2024", partnerCountry: "CN", tradeValueUsd: 0.2,
        quantity: 0.05700000000000001, quantityUnit: "tonne",
      },
    ])).toMatchObject({
      totalImportValueUsd: 0.3,
      totalImportQuantityTonnes: 36346.757,
    });
  });
});

describe("MI1D.1 provenance and scope boundaries", () => {
  it("registers verified internal storage while keeping redistribution disabled", () => {
    expect(buildBaciSourceRegistration("2026-09-20T12:00:00.000Z")).toMatchObject({
      provider_id: "baci_oec",
      dataset_id: "baci-hs17",
      source_tier: "B",
      service_terms_verified: false,
      storage_allowed: false,
      redistribution_allowed: false,
    });
    expect(buildBaciSourceVerification("source-id")).toMatchObject({
      verification: {
        service_terms_verified: true,
        storage_allowed: true,
        redistribution_allowed: false,
      },
    });
  });

  it("serializes a raw bilateral observation without inventing a world row", () => {
    const normalized = normalizeBaciBilateralRows([row()], "2026-09-20T12:00:00.000Z")[0]!;
    expect(toMarketTradeObservationBody(normalized)).toMatchObject({
      reporter_country: "MY",
      partner_country: "IN",
      trade_flow: "import",
      hs_revision: "HS17",
      hs_code: "090421",
    });
  });

  it("canonicalizes numeric fields at the persistence-payload boundary", () => {
    const normalized = normalizeBaciBilateralRows([row()], "2026-09-20T12:00:00.000Z")[0]!;
    expect(toMarketTradeObservationBody({
      ...normalized,
      tradeValueUsd: 675.9999999999999,
      quantity: 0.052000000000000005,
    })).toMatchObject({
      trade_value_usd: 676,
      quantity: 0.052,
    });
  });

  it("contains no Buyer Intelligence write, Market Fit publication, or 090422 aggregation path", () => {
    const root = path.resolve(process.cwd(), "src/lib/marketIntelligence/providers/baci");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(root);
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/buyer_trade_observations|buyer_intelligence_(claims|assessments)|refreshMarketIntelligence|published_fit_score|composeMarketFit/);
    expect(source).not.toContain('hsCode: "090422"');
    expect(source).not.toMatch(/NEXT_PUBLIC_BACI|console\.(log|info|warn|error)\(/);
  });
});
