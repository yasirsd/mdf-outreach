import { describe, expect, it } from "vitest";
import {
  assessmentEvidenceFromRow,
  intelligenceClaimFromRow,
  tradeMetricFromRow,
  tradeObservationFromRow,
} from "./buyerIntelligenceMappers";

const BASE = {
  workspace_id: "10000000-0000-4000-8000-000000000001",
  candidate_id: "20000000-0000-4000-8000-000000000001",
  created_at: "2026-08-01T00:00:00.000Z",
};

describe("BI1 Supabase row mappers", () => {
  it("keeps raw source values distinct from normalized interpretations", () => {
    const claim = intelligenceClaimFromRow({
      ...BASE,
      id: "40000000-0000-4000-8000-000000000001",
      source_id: "30000000-0000-4000-8000-000000000001",
      source_record_ref: "claim-1",
      claim_type: "company_is_importer",
      evidence_type: "business_evidence",
      evidence_level: 2,
      confidence: "medium",
      raw_value: { text: "Importer & stockist" },
      normalized_value: { isImporter: true },
      retrieved_at: "2026-08-02T00:00:00.000Z",
    });
    expect(claim.rawValue).toEqual({ text: "Importer & stockist" });
    expect(claim.normalizedValue).toEqual({ isImporter: true });
  });

  it("preserves missing trade fields and validates canonical MDF product ids", () => {
    const base = {
      ...BASE,
      id: "50000000-0000-4000-8000-000000000001",
      source_id: "30000000-0000-4000-8000-000000000001",
      source_record_ref: "obs-1",
      granularity: "shipment",
      evidence_type: "verified_trade_evidence",
      evidence_level: 1,
      confidence: "verified",
      retrieved_at: "2026-08-02T00:00:00.000Z",
      updated_at: "2026-08-02T00:00:00.000Z",
    };
    const observation = tradeObservationFromRow(base);
    expect(observation.originCountryCode).toBeUndefined();
    expect(observation.tradeDate).toBeUndefined();
    expect(() => tradeObservationFromRow({ ...base, mdf_product_id: "invented" })).toThrow(
      /Unknown MDF/,
    );
  });

  it("maps exactly one normalized metric value representation", () => {
    const metric = tradeMetricFromRow({
      ...BASE,
      id: "80000000-0000-4000-8000-000000000001",
      metric_key: "shipment_count",
      value_type: "number",
      numeric_value: 12,
      unit: "count",
      calculation_window: "lifetime",
      supporting_observation_count: 12,
      calculated_at: "2026-08-02T00:00:00.000Z",
      calculation_version: "bi1-basic-v1",
      updated_at: "2026-08-02T00:00:00.000Z",
    });
    expect(metric.value).toEqual({ type: "number", value: 12 });
  });

  it("requires candidate identity on assessment-evidence links", () => {
    const link = assessmentEvidenceFromRow({
      ...BASE,
      id: "90000000-0000-4000-8000-000000000001",
      assessment_id: "90000000-0000-4000-8000-000000000002",
      observation_id: "50000000-0000-4000-8000-000000000001",
      component_key: "verified_trade",
    });
    expect(link.candidateId).toBe(BASE.candidate_id);
    expect(link.kind).toBe("observation");
  });
});
