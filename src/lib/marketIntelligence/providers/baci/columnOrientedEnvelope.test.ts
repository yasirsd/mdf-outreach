import { describe, expect, it } from "vitest";
import { buildMalaysiaChilliProofQuery, baciQueryUrl } from "./contract";
import {
  BaciProviderError,
  expandColumnOrientedRows,
  parseBaciQueryPage,
  sanitizeUpstreamExcerpt,
} from "./normalize";

/**
 * MI1D.3 — the production 502 root cause: BotMarket returns
 *   { columns: [...], rows: [[...],[...]], count: N }
 * (rows are positional arrays aligned to columns), not
 *   { rows: [{...},{...}] }.
 * The pre-fix parser rejected every array-row with
 * "non-object row" → provider_error → 502. These tests lock the
 * live envelope shape.
 */

const columns = [
  "year",
  "exporter_id",
  "exporter_name",
  "importer_id",
  "importer_name",
  "hs_code",
  "product_name",
  "hs_revision",
  "value",
  "quantity",
  "unit_abbrevation",
  "unit_name",
];

function tupleRow(year: number, exporter: string, exporterName: string): unknown[] {
  return [
    year,
    exporter,
    exporterName,
    "mys",
    "Malaysia",
    "090421",
    "Dried Capsicum/Pimenta, neither crushed nor ground",
    5,
    1234.5,
    12.0,
    "mt",
    "Metric Tonne",
  ];
}

describe("MI1D.3 column-oriented envelope", () => {
  it("expandColumnOrientedRows zips positional rows to column-keyed objects", () => {
    const rows = expandColumnOrientedRows(columns, [
      tupleRow(2024, "ind", "India"),
      tupleRow(2023, "chn", "China"),
    ]);
    expect(rows[0]).toEqual({
      year: 2024,
      exporter_id: "ind",
      exporter_name: "India",
      importer_id: "mys",
      importer_name: "Malaysia",
      hs_code: "090421",
      product_name: "Dried Capsicum/Pimenta, neither crushed nor ground",
      hs_revision: 5,
      value: 1234.5,
      quantity: 12.0,
      unit_abbrevation: "mt",
      unit_name: "Metric Tonne",
    });
    expect(rows[1]?.exporter_id).toBe("chn");
  });

  it("parseBaciQueryPage accepts the LIVE {columns, rows: [[...]], count} envelope", () => {
    const spec = buildMalaysiaChilliProofQuery();
    const page = parseBaciQueryPage(
      { columns, rows: [tupleRow(2024, "ind", "India")], count: 1 },
      spec,
      0,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      year: 2024,
      exporter_id: "ind",
      importer_id: "mys",
      hs_code: "090421",
      hs_revision: 5,
      value: 1234.5,
      quantity: 12.0,
      unit_abbrevation: "mt",
    });
    expect(page.totalRows).toBe(1);
  });

  it("keeps hs_code = \"090421\" as a six-digit string through the zip", () => {
    const spec = buildMalaysiaChilliProofQuery();
    const page = parseBaciQueryPage(
      { columns, rows: [tupleRow(2024, "ind", "India")], count: 1 },
      spec,
      0,
    );
    expect(page.rows[0]?.hs_code).toBe("090421");
    expect(page.rows[0]?.hs_code).not.toBe("90421" as unknown);
    expect(typeof page.rows[0]?.hs_code).toBe("string");
  });

  it("rejects a row whose length disagrees with the column header (schema_error)", () => {
    const spec = buildMalaysiaChilliProofQuery();
    const badRow = tupleRow(2024, "ind", "India").slice(0, -2);
    let caught: unknown;
    try {
      parseBaciQueryPage({ columns, rows: [badRow], count: 1 }, spec, 0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BaciProviderError);
    const err = caught as BaciProviderError;
    expect(err.diagnostic?.stage).toBe("provider_schema");
    expect(err.diagnostic?.category).toBe("schema_error");
  });

  it("still accepts the legacy object-row shape (fixture-backed backward compat)", () => {
    const spec = buildMalaysiaChilliProofQuery();
    const page = parseBaciQueryPage(
      {
        rows: [
          {
            year: 2024,
            exporter_id: "ind",
            exporter_name: "India",
            importer_id: "mys",
            importer_name: "Malaysia",
            hs_code: "090421",
            product_name: "Dried",
            hs_revision: 5,
            value: 100,
            quantity: 1,
            unit_abbrevation: "mt",
            unit_name: "Metric Tonne",
          },
        ],
        total: 1,
      },
      spec,
      0,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.hs_code).toBe("090421");
  });

  it("baciQueryUrl serializes every year via a REPEATED param (?year=2017&year=2018…)", () => {
    // Documented BotMarket contract for multi-value filter columns.
    // See openapi.json operation description for /api/datasets/{slug}/query.
    const spec = buildMalaysiaChilliProofQuery();
    const url = new URL(baciQueryUrl(spec, 0));
    const yearParams = url.searchParams.getAll("year");
    expect(yearParams).toEqual([
      "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024",
    ]);
    expect(url.searchParams.get("importer_id")).toBe("mys");
    expect(url.searchParams.get("hs_code")).toBe("090421");
    expect(url.searchParams.get("limit")).toBe("1000");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("year")).toBe("2017");
    expect(url.toString()).toContain("year=2017&year=2018&year=2019&year=2020");
  });

  it("sanitizeUpstreamExcerpt hard-scrubs the BotMarket / MDF credential shapes", () => {
    const excerpt = sanitizeUpstreamExcerpt(
      'Authorization Bearer bot_market_ak_ABCDEFghij12345 rejected — service_role sb_secret_XYZ token eyJhbGciOiJI.abc.def',
    );
    expect(excerpt).not.toMatch(/bot_market_ak_/);
    expect(excerpt).not.toMatch(/sb_secret_/);
    expect(excerpt).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
    expect(excerpt).toMatch(/\[REDACTED\]/);
  });

  it("sanitizeUpstreamExcerpt truncates arbitrarily large bodies to a safe bound", () => {
    const body = "x".repeat(50_000);
    const excerpt = sanitizeUpstreamExcerpt(body, 500);
    expect(excerpt.length).toBeLessThanOrEqual(500 + 1); // + ellipsis
  });
});
