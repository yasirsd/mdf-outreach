import { describe, expect, it } from "vitest";
import { toSyncRpcPayload } from "./writer";
import { serializeProductTradeMappingsSnapshot } from "../product";

/**
 * MI1C production 503 root-cause guard. Migration 0023's
 * `mdf.__validate_product_trade_mapping_row` reads `p_row->>'mdf_product_id'`,
 * `hs_revision`, `hs_code`, `mapping_kind`, `mapping_confidence`,
 * `fit_eligibility`, `scope_description`, `included_products_note`,
 * `hs_level`, `trade_label`, `weight` — every one snake_case. The
 * TypeScript registry is camelCase. If the writer ever ships the raw
 * camelCase snapshot again, every SQL lookup returns NULL and the RPC
 * raises "mapping row missing mdf_product_id".
 */
describe("MI1C sync-RPC payload adapter", () => {
  it("wraps each mapping in snake_case exactly matching migration 0023's SQL validator", () => {
    const snapshot = serializeProductTradeMappingsSnapshot({
      now: () => new Date("2026-09-20T00:00:00.000Z"),
    });
    const payload = toSyncRpcPayload(snapshot);
    expect(payload.registryVersion).toBe(snapshot.registryVersion);
    expect(payload.generatedAt).toBe(snapshot.generatedAt);
    expect(payload.mappings.length).toBe(snapshot.mappings.length);
    for (const row of payload.mappings) {
      for (const key of [
        "mdf_product_id",
        "hs_revision",
        "hs_level",
        "hs_code",
        "trade_label",
        "mapping_kind",
        "mapping_confidence",
        "fit_eligibility",
        "scope_description",
      ]) {
        expect(row).toHaveProperty(key);
        expect(row[key]).not.toBeUndefined();
      }
      // Positively no camelCase key ever leaks onto the wire — SQL would
      // read null for it and the whole snapshot would abort.
      for (const forbidden of [
        "mdfProductId",
        "hsRevision",
        "hsLevel",
        "hsCode",
        "tradeLabel",
        "mappingKind",
        "mappingConfidence",
        "fitEligibility",
        "scopeDescription",
        "includedProductsNote",
      ]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    }
  });

  it("hs_code stays digits-only and length matches hs_level (mirrors SQL CHECKs)", () => {
    const payload = toSyncRpcPayload(
      serializeProductTradeMappingsSnapshot({ now: () => new Date("2026-09-20T00:00:00.000Z") }),
    );
    for (const row of payload.mappings) {
      expect(row.hs_code).toMatch(/^[0-9]+$/);
      expect(String(row.hs_code).length).toBe(row.hs_level);
    }
  });

  it("emits an identity-sorted mapping order so replay is byte-for-byte stable", () => {
    const a = toSyncRpcPayload(
      serializeProductTradeMappingsSnapshot({ now: () => new Date("2026-09-20T00:00:00.000Z") }),
    );
    const b = toSyncRpcPayload(
      serializeProductTradeMappingsSnapshot({ now: () => new Date("2026-09-20T00:00:00.000Z") }),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
