import { describe, expect, it } from "vitest";
import {
  classifyMaterialReplay,
  normalizeClaimIngestion,
  normalizeSourceIngestion,
  normalizeTradeObservationIngestion,
} from "./ingestion";
import { BI_FIXTURE_CANDIDATE_ID, buyerIntelligenceSourceFixtures } from "./testUtils/fixtures";

const retrievedAt = "2026-09-02T10:00:00.000Z";

describe("BI2 ingestion contracts", () => {
  it("scrubs secret-shaped metadata and sensitive URL parameters", () => {
    const result = normalizeSourceIngestion({
      candidateId: BI_FIXTURE_CANDIDATE_ID, providerId: "fixture", sourceType: "manual",
      sourceKey: "record-1", sourceUrl: "https://example.test/path?token=secret&record=1#private",
      accessClass: "manual", costClass: "free", retrievedAt,
      metadata: { public: true, apiKey: "never-store", nested: { password: "never", label: "safe" } },
    });
    expect(result.sourceUrl).toBe("https://example.test/path?record=1");
    expect(result.metadata).toEqual({ public: true, nested: { label: "safe" } });
  });

  it("preserves raw and normalized claim values separately", () => {
    const result = normalizeClaimIngestion({
      candidateId: BI_FIXTURE_CANDIDATE_ID, sourceId: buyerIntelligenceSourceFixtures[0].id,
      sourceRecordRef: "claim-1", claimType: "imports_product",
      evidenceType: "business_evidence", evidenceLevel: 2, confidence: "medium",
      rawValue: { text: "Red chilli importer" }, normalizedValue: { category: "dry red chilli" }, retrievedAt,
    });
    expect(result.rawValue).toEqual({ text: "Red chilli importer" });
    expect(result.normalizedValue).toEqual({ category: "dry red chilli" });
  });

  it("rejects mismatched evidence, fabricated-looking codes, negatives, and unknown MDF products", () => {
    const base = {
      candidateId: BI_FIXTURE_CANDIDATE_ID, sourceId: buyerIntelligenceSourceFixtures[0].id,
      sourceRecordRef: "obs-1", granularity: "shipment" as const,
      evidenceType: "verified_trade_evidence" as const, evidenceLevel: 1 as const,
      confidence: "verified" as const, retrievedAt,
    };
    expect(() => normalizeTradeObservationIngestion({ ...base, originCountryCode: "India" })).toThrow(/originCountryCode/);
    expect(() => normalizeTradeObservationIngestion({ ...base, tradeValue: -1 })).toThrow(/tradeValue/);
    expect(() => normalizeTradeObservationIngestion({ ...base, mdfProductId: "invented" })).toThrow(/Unknown MDF/);
    expect(() => normalizeTradeObservationIngestion({ ...base, evidenceLevel: 2, evidenceType: "business_evidence" })).toThrow(/Granularity/);
  });

  it("does not derive origin, destination, product, or numeric values from Candidate data", () => {
    const result = normalizeTradeObservationIngestion({
      candidateId: BI_FIXTURE_CANDIDATE_ID, sourceId: buyerIntelligenceSourceFixtures[0].id,
      sourceRecordRef: "obs-missing", granularity: "directory_signal",
      evidenceType: "discovery_signal", evidenceLevel: 3, confidence: "low", retrievedAt,
    });
    expect(result.originCountryCode).toBeUndefined();
    expect(result.destinationCountryCode).toBeUndefined();
    expect(result.tradeValue).toBeUndefined();
    expect(result.mdfProductId).toBeUndefined();
  });

  it("returns deterministic no-op semantics for source, claim, and observation replay", () => {
    const cases = [
      { providerId: "fixture", sourceKey: "source-1", retrievedAt: "2026-09-01T00:00:00Z" },
      { sourceId: buyerIntelligenceSourceFixtures[0].id, sourceRecordRef: "claim-1", rawValue: { importer: true }, retrievedAt: "2026-09-01T00:00:00Z" },
      { sourceId: buyerIntelligenceSourceFixtures[0].id, sourceRecordRef: "observation-1", originCountryCode: "IN", retrievedAt: "2026-09-01T00:00:00Z" },
    ];
    for (const existing of cases) {
      expect(classifyMaterialReplay(existing, { ...existing, retrievedAt: "2026-09-03T00:00:00Z" })).toBe("existing");
    }
  });

  it("requires an explicit correction path for a conflicting observation identity", () => {
    const existing = { sourceId: buyerIntelligenceSourceFixtures[0].id, sourceRecordRef: "same", originCountryCode: "IN", tradeValue: 100, retrievedAt };
    expect(classifyMaterialReplay(existing, { ...existing, tradeValue: 101 })).toBe("conflict");
  });
});
