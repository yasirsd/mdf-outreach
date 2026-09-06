import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LABELS,
  EVIDENCE_TYPE_BY_LEVEL,
  EVIDENCE_TYPES,
  TRADE_METRIC_KEYS,
  TRADE_OBSERVATION_GRANULARITIES,
} from "./types";

describe("BI1 controlled domain vocabulary", () => {
  it("maps every evidence level to exactly one stable type and visible label", () => {
    expect(EVIDENCE_TYPE_BY_LEVEL).toEqual({
      1: "verified_trade_evidence",
      2: "business_evidence",
      3: "discovery_signal",
    });
    expect(EVIDENCE_TYPES).toHaveLength(3);
    expect(EVIDENCE_LABELS[1]).toBe("Verified trade");
  });

  it("keeps shipment distinct from weaker/non-event granularities", () => {
    expect(TRADE_OBSERVATION_GRANULARITIES).toEqual([
      "shipment",
      "transaction",
      "aggregate_period",
      "buyer_supplier_relation",
      "company_claim",
      "directory_signal",
    ]);
  });

  it("controls normalized metric keys in the TypeScript domain", () => {
    expect(TRADE_METRIC_KEYS).toContain("shipment_count");
    expect(TRADE_METRIC_KEYS).toContain("india_observation_share");
    expect(TRADE_METRIC_KEYS).toContain("supplier_ranking");
    expect(new Set(TRADE_METRIC_KEYS).size).toBe(TRADE_METRIC_KEYS.length);
  });
});
