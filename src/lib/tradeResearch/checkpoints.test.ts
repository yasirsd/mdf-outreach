import { describe, expect, it } from "vitest";

import type { TradeResearchProviderResult } from "./types";
import { assertProviderResultCheckpoint, readProviderResultCheckpoint } from "./checkpoints";

function result(status: "completed" | "no_match" | "cached" = "completed"): TradeResearchProviderResult {
  return {
    providerId: "fda-fsvp",
    datasetId: "fsvp-participant-list",
    datasetVersion: "material-hash",
    parserVersion: "fsvp-xlsx-v1",
    sourceRecordIds: ["row-1"],
    sourcePeriod: "2026 Q2",
    retrievedAt: "2026-09-28T12:00:00.000Z",
    execution: { status, safeErrorCode: null },
    evidence: {
      matchDecision: status === "no_match" ? "none" : "strong",
      companyEvidence: { state: status === "no_match" ? "no_verified_match" : "verified", explanation: "provider-local" },
      productEvidence: { state: "not_available", explanation: "not covered" },
      originEvidence: { state: "not_available", explanation: "not covered" },
      shipmentEvidence: { state: "not_verified", explanation: "not shipment data" },
      programEvidence: { state: status === "no_match" ? "no_verified_match" : "verified", explanation: "program list" },
      coverage: { state: "covered", explanation: "published list" },
      limitations: ["program list only"],
      attribution: "FDA",
      mappingScope: {
        marketCountryCode: "US", productId: "guntur-dry-red-chilli", productForm: null,
        sourceProductCodes: [], companyGrain: "company_record", productGrain: "not_available",
        originGrain: "not_available", shipmentGrain: "not_available", programGrain: "company_program",
      },
      interpretationVersion: "trade-interpretation-v1",
      conflicts: [],
    },
  };
}

describe("T10 provider-result checkpoint contract", () => {
  it.each([
    ["completed", "completed"],
    ["completed_no_match", "no_match"],
    ["skipped_cached", "cached"],
  ] as const)("accepts %s only with a matching %s typed result", (attemptState, executionStatus) => {
    const checkpoint = result(executionStatus);
    expect(readProviderResultCheckpoint({ state: attemptState, provider_result: checkpoint }, "fda-fsvp"))
      .toEqual(checkpoint);
    expect(() => assertProviderResultCheckpoint(attemptState, "fda-fsvp", checkpoint)).not.toThrow();
  });

  it("rejects missing evidence, provider mismatch, execution mismatch, and unsafe context fields", () => {
    expect(readProviderResultCheckpoint({ state: "completed", provider_result: null }, "fda-fsvp")).toBeUndefined();
    expect(readProviderResultCheckpoint({ state: "completed", provider_result: result() }, "fda-vqip")).toBeUndefined();
    expect(readProviderResultCheckpoint({ state: "completed", provider_result: result("no_match") }, "fda-fsvp")).toBeUndefined();
    expect(readProviderResultCheckpoint({
      state: "completed",
      provider_result: { ...result(), evidence: null },
    }, "fda-fsvp")).toBeUndefined();
    expect(readProviderResultCheckpoint({
      state: "completed",
      provider_result: { ...result(), context: { productId: "wrong" } },
    }, "fda-fsvp")).toBeUndefined();
    expect(readProviderResultCheckpoint({
      state: "completed",
      provider_result: { ...result(), datasetVersion: null },
    }, "fda-fsvp")).toBeUndefined();
  });

  it("retains the exact material, parser, source-period, retrieval, and record provenance", () => {
    const checkpoint = result("cached");
    const restored = readProviderResultCheckpoint({ state: "skipped_cached", provider_result: checkpoint }, "fda-fsvp");
    expect(restored).toMatchObject({
      datasetVersion: "material-hash",
      parserVersion: "fsvp-xlsx-v1",
      sourceRecordIds: ["row-1"],
      sourcePeriod: "2026 Q2",
      retrievedAt: "2026-09-28T12:00:00.000Z",
    });
  });
});
