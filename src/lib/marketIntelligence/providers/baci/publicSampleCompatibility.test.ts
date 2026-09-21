import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BACI_OEC_METADATA_ENDPOINT,
  BACI_OEC_QUERY_ENDPOINT,
  BACI_OEC_SAMPLE_ENDPOINT,
} from "./contract";
import {
  BaciProviderError,
  normalizeBaciBilateralRows,
  parseBaciWireRow,
} from "./normalize";

const fixturePath = path.resolve(
  process.cwd(),
  "src/lib/marketIntelligence/providers/baci/fixtures/baci-hs17-public-sample-row.json",
);

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

describe("MI1D.2 BACI public sample compatibility", () => {
  it("locks the public metadata, sample, and authenticated query endpoint roles", () => {
    expect(BACI_OEC_METADATA_ENDPOINT).toBe("https://botmarket.oec.world/api/datasets/baci-hs17");
    expect(BACI_OEC_SAMPLE_ENDPOINT).toBe("https://botmarket.oec.world/api/datasets/baci-hs17/sample");
    expect(BACI_OEC_QUERY_ENDPOINT).toBe("https://botmarket.oec.world/api/datasets/baci-hs17/query");
  });

  it("accepts the exact verified wire shape before normalization", () => {
    const raw = fixture();
    const parsed = parseBaciWireRow(raw);
    expect(parsed).toEqual(raw);
    expect(parsed).toMatchObject({
      exporter_id: "vnm",
      importer_id: "svn",
      hs_code: "040110",
      hs_revision: 5,
      quantity: 0.015,
      unit_abbrevation: "mt",
      unit_name: "Metric Tonne",
    });
    expect(raw).toHaveProperty("unit_abbrevation");
    expect(raw).not.toHaveProperty("unit_abbreviation");
  });

  it("uses dataset identity for HS17 and converts both wire countries to alpha-2", () => {
    const observation = normalizeBaciBilateralRows(
      [parseBaciWireRow(fixture())],
      "2026-09-20T12:00:00.000Z",
    )[0]!;
    expect(observation).toMatchObject({
      reporterCountry: "SI",
      partnerCountry: "VN",
      hsRevision: "HS17",
      hsCode: "040110",
      tradeValueUsd: 64,
      quantity: 0.015,
      quantityUnit: "tonne",
      netWeightKg: null,
      metadata: {
        provider_hs_revision: 5,
        provider_quantity_unit: "Metric Tonne",
      },
    });
    expect(observation.hsRevision).not.toBe("5");
  });

  it("preserves raw evidence, then canonicalizes only representation noise", () => {
    const precise = parseBaciWireRow({ ...fixture(), quantity: 0.013999999999999999 });
    const small = parseBaciWireRow({ ...fixture(), quantity: 0.003 });
    const missing = parseBaciWireRow({
      ...fixture(),
      quantity: null,
      unit_abbrevation: null,
      unit_name: null,
    });
    const zero = parseBaciWireRow({ ...fixture(), quantity: 0 });
    expect(precise.quantity).toBe(0.013999999999999999);
    expect(small.quantity).toBe(0.003);
    expect(missing.quantity).toBeNull();
    expect(zero.quantity).toBe(0);
    expect(normalizeBaciBilateralRows([precise], "2026-09-20T12:00:00.000Z")[0])
      .toMatchObject({ quantity: 0.014, quantityUnit: "tonne" });
    expect(normalizeBaciBilateralRows([small], "2026-09-20T12:00:00.000Z")[0])
      .toMatchObject({ quantity: 0.003, quantityUnit: "tonne" });
    expect(normalizeBaciBilateralRows([missing], "2026-09-20T12:00:00.000Z")[0])
      .toMatchObject({ quantity: null, quantityUnit: null });
    expect(normalizeBaciBilateralRows([zero], "2026-09-20T12:00:00.000Z")[0])
      .toMatchObject({ quantity: 0, quantityUnit: "tonne" });
  });

  it.each([
    ["missing year", { year: undefined }],
    ["invalid exporter", { exporter_id: "ZZZ" }],
    ["unknown exporter", { exporter_id: "zzz" }],
    ["invalid importer", { importer_id: "MY" }],
    ["non-six-digit HS", { hs_code: "40110" }],
    ["non-numeric value", { value: "64" }],
    ["negative value", { value: -1 }],
    ["malformed quantity", { quantity: "0.015" }],
    ["unsupported quantity unit", { unit_abbrevation: "kg", unit_name: "Kilogram" }],
    ["missing provider revision", { hs_revision: undefined }],
  ])("fails closed for %s", (_label, override) => {
    expect(() => parseBaciWireRow({ ...fixture(), ...override })).toThrow(BaciProviderError);
  });

  it("rejects unexpected shapes and performs no network or persistence operation", () => {
    expect(() => parseBaciWireRow([])).toThrow(/non-object row/);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const parsed = parseBaciWireRow(fixture());
    normalizeBaciBilateralRows([parsed], "2026-09-20T12:00:00.000Z");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const source = readFileSync(path.resolve(
      process.cwd(),
      "src/lib/marketIntelligence/providers/baci/normalize.ts",
    ), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(|createClient|supabase|ingestSource|recordFetchResult|published_fit_score|composeMarketFit/);
  });
});
