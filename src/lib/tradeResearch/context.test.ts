import { describe, expect, it } from "vitest";
import {
  canReuseTradeResearchResultForContext,
  canonicalizeResearchContext,
  compareTradeResearchResultContext,
  fingerprintResearchContext,
  readStoredResearchContext,
  selectTradeResearchEvidenceForRead,
} from "./context";
import type {
  ResearchContext,
  TradeResearchEvaluatedProviderResult,
  TradeResearchProviderEvidence,
  TradeResearchProviderResult,
  TradeResearchUnevaluatedProviderResult,
  TradeResearchResultSummary,
} from "./types";

const context: ResearchContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  candidateId: "00000000-0000-4000-8000-000000000002",
  marketCountryCode: "US",
  productId: "guntur-dry-red-chilli",
  productForm: "Whole Dried",
  researchGoal: "screen_trade_activity",
  providerPlanVersion: "trade-planner-v1",
  interpretationVersion: "trade-interpretation-v1",
};

const providerEvidence: TradeResearchProviderEvidence = {
  matchDecision: "strong",
  companyEvidence: { state: "verified", explanation: "Matched the company record." },
  productEvidence: { state: "not_checked", explanation: "This source has no product grain." },
  originEvidence: { state: "not_available", explanation: "Origin is not published." },
  shipmentEvidence: { state: "not_verified", explanation: "Directory rows are not shipments." },
  programEvidence: { state: "verified", explanation: "The company appears in the program list." },
  coverage: { state: "partially_covered", explanation: "Identity and program only." },
  limitations: ["No product, origin or shipment fields."],
  attribution: "Official public provider list.",
  mappingScope: {
    marketCountryCode: "US",
    productId: "guntur-dry-red-chilli",
    productForm: "whole dried",
    sourceProductCodes: [],
    companyGrain: "company_record",
    productGrain: "not_available",
    originGrain: "not_available",
    shipmentGrain: "not_available",
    programGrain: "company_program",
  },
  interpretationVersion: "trade-interpretation-v1",
  conflicts: [],
};

function evaluatedResult(
  status: "completed" | "no_match" | "cached" = "completed",
  providerId = "fda-fsvp",
): TradeResearchEvaluatedProviderResult {
  return {
    providerId,
    datasetId: "fsvp-participant-list",
    datasetVersion: "2026-q2",
    parserVersion: "fsvp-parser-v1",
    sourceRecordIds: ["record-1"],
    sourcePeriod: "2026 Q2",
    retrievedAt: "2026-09-28T00:00:00.000Z",
    execution: { status, safeErrorCode: null },
    evidence: providerEvidence,
  };
}

function unevaluatedResult(
  status: "not_started" | "failed_retryable" | "failed_terminal" | "unsupported" | "blocked" | "cancelled",
): TradeResearchUnevaluatedProviderResult {
  return {
    providerId: "fda-fsvp",
    datasetId: "fsvp-participant-list",
    datasetVersion: null,
    parserVersion: "fsvp-parser-v1",
    sourceRecordIds: [],
    sourcePeriod: null,
    retrievedAt: null,
    execution: { status, safeErrorCode: status.startsWith("failed") ? "PROVIDER_TIMEOUT" : null },
    evidence: null,
  };
}

function emptySummary(overrides: Partial<TradeResearchResultSummary> = {}): TradeResearchResultSummary {
  return {
    officialProgramEvidence: "not_checked",
    productEvidence: "not_available",
    indiaOrigin: "not_verified",
    originEvidence: "not_available",
    shipmentEvidence: "not_verified",
    sourcesChecked: 0,
    automaticSpendRupees: 0,
    ...overrides,
  };
}

describe("T06 research-context fingerprint", () => {
  it("1. same exact context has the same fingerprint", () => {
    expect(fingerprintResearchContext({ ...context })).toBe(fingerprintResearchContext(context));
  });

  it("2. a different product has a different fingerprint", () => {
    expect(fingerprintResearchContext({ ...context, productId: "indian-pomegranate" }))
      .not.toBe(fingerprintResearchContext(context));
  });

  it("3. a different market has a different fingerprint", () => {
    expect(fingerprintResearchContext({ ...context, marketCountryCode: "CA" }))
      .not.toBe(fingerprintResearchContext(context));
  });

  it("4. a different product form has a different fingerprint", () => {
    expect(fingerprintResearchContext({ ...context, productForm: "ground" }))
      .not.toBe(fingerprintResearchContext(context));
  });

  it("5. a different research goal has a different fingerprint", () => {
    expect(fingerprintResearchContext({ ...context, researchGoal: "find_target_product" }))
      .not.toBe(fingerprintResearchContext(context));
  });

  it("6. a different provider-plan version has a different fingerprint", () => {
    expect(fingerprintResearchContext({ ...context, providerPlanVersion: "trade-planner-v2" }))
      .not.toBe(fingerprintResearchContext(context));
  });

  it("7. a different interpretation version has a different fingerprint", () => {
    expect(fingerprintResearchContext({ ...context, interpretationVersion: "trade-interpretation-v2" }))
      .not.toBe(fingerprintResearchContext(context));
  });

  it("8. display-name changes do not alter the fingerprint", () => {
    const first = { ...context, productDisplayName: "Guntur Chilli" } as ResearchContext;
    const second = { ...context, productDisplayName: "Guntur Red Chilli" } as ResearchContext;
    expect(fingerprintResearchContext(first)).toBe(fingerprintResearchContext(second));
  });

  it("9. timestamps do not alter the fingerprint", () => {
    const first = { ...context, requestedAt: "2026-01-01T00:00:00Z" } as ResearchContext;
    const second = { ...context, requestedAt: "2027-01-01T00:00:00Z" } as ResearchContext;
    expect(fingerprintResearchContext(first)).toBe(fingerprintResearchContext(second));
  });

  it("canonicalizes country, product, form, goal and versions", () => {
    expect(canonicalizeResearchContext({
      ...context,
      marketCountryCode: " us ",
      productId: " GUNTUR-DRY-RED-CHILLI ",
      productForm: " Whole   Dried ",
      providerPlanVersion: " TRADE-PLANNER-V1 ",
      interpretationVersion: " TRADE-INTERPRETATION-V1 ",
    })).toEqual({ ...context, productForm: "whole dried" });
  });
});

describe("T06 provider outcome contract", () => {
  it("10. provider failure remains failure rather than no_match", () => {
    const result = unevaluatedResult("failed_retryable");
    expect(result.execution.status).toBe("failed_retryable");
    expect(result.evidence).toBeNull();
  });

  it("11. unsupported remains unsupported", () => {
    expect(unevaluatedResult("unsupported").execution.status).toBe("unsupported");
  });

  it("12. a cached completed result preserves its evidence", () => {
    const result = evaluatedResult("cached");
    expect(result.execution.status).toBe("cached");
    expect(result.evidence.companyEvidence.state).toBe("verified");
    expect(result.sourceRecordIds).toEqual(["record-1"]);
  });

  it("13. company evidence does not promote product evidence", () => {
    const result = evaluatedResult();
    expect(result.evidence.companyEvidence.state).toBe("verified");
    expect(result.evidence.productEvidence.state).toBe("not_checked");
  });

  it("14. product evidence does not promote shipment evidence", () => {
    const result = evaluatedResult();
    result.evidence.productEvidence = { state: "verified", explanation: "Company-product row." };
    expect(result.evidence.shipmentEvidence.state).toBe("not_verified");
  });

  it("15. a source-local conflict is preserved", () => {
    const result = evaluatedResult();
    result.evidence.conflicts.push({
      dimension: "origin",
      description: "Two source rows report different origins.",
      sourceRecordIds: ["record-1", "record-2"],
    });
    expect(result.evidence.conflicts).toEqual([expect.objectContaining({ dimension: "origin" })]);
  });

  it.each([1, 2, 3, 5])("supports %i durable provider results without flattening", (count) => {
    const providerResults = Array.from({ length: count }, (_, index) => evaluatedResult("completed", `provider-${index + 1}`));
    const selected = selectTradeResearchEvidenceForRead(emptySummary({ providerResults }));
    expect(selected.kind).toBe("typed_provider_results");
    if (selected.kind === "typed_provider_results") expect(selected.providerResults).toHaveLength(count);
  });
});

describe("T06 context matching and legacy reads", () => {
  const typed = emptySummary({
    context,
    contextFingerprint: fingerprintResearchContext(context),
  });

  it("16. a legacy result without context is unknown and not automatically reusable", () => {
    const legacy = emptySummary();
    expect(readStoredResearchContext(legacy).status).toBe("legacy_unknown");
    expect(canReuseTradeResearchResultForContext(legacy, context)).toBe(false);
  });

  it("returns exact only when every material field matches", () => {
    expect(compareTradeResearchResultContext(typed, context).status).toBe("exact");
  });

  it("17. the same candidate with a different product is a context mismatch", () => {
    expect(compareTradeResearchResultContext(typed, { ...context, productId: "indian-pomegranate" }))
      .toMatchObject({ status: "mismatch", differingFields: ["productId"] });
  });

  it("18. the same candidate with a different market is a context mismatch", () => {
    expect(compareTradeResearchResultContext(typed, { ...context, marketCountryCode: "CA" }))
      .toMatchObject({ status: "mismatch", differingFields: ["marketCountryCode"] });
  });

  it("rejects a stored fingerprint that disagrees with its explicit context", () => {
    expect(readStoredResearchContext({ context, contextFingerprint: "trctx-v1:tampered" }).status)
      .toBe("invalid_context");
  });

  it("uses typed provider results before legacy sources or singular evidence", () => {
    const selection = selectTradeResearchEvidenceForRead(emptySummary({
      providerResults: [evaluatedResult()],
      sources: [],
      evidence: {
        source: "FDA FSVP",
        datasetPeriod: "legacy",
        retrievedAt: "2026-09-28T00:00:00Z",
        candidateName: "Legacy",
        identityDecision: "none",
        matchReason: "Legacy",
        coverageExplanation: "Legacy",
      },
    }));
    expect(selection.kind).toBe("typed_provider_results");
  });

  it("19. legacy single-source evidence remains safely selectable for rendering", () => {
    const selection = selectTradeResearchEvidenceForRead(emptySummary({
      evidence: {
        source: "FDA FSVP",
        datasetPeriod: "2026 Q2",
        retrievedAt: "2026-09-28T00:00:00Z",
        candidateName: "Example Foods",
        identityDecision: "none",
        matchReason: "No match.",
        coverageExplanation: "Company and state only.",
      },
    }));
    expect(selection.kind).toBe("legacy_single_source");
  });

  it("20. Phase 2C multi-source evidence remains safely selectable for rendering", () => {
    const legacySource = {
      providerId: "fda-fsvp" as const,
      outcome: "completed" as const,
      source: "FDA FSVP" as const,
      datasetPeriod: "2026 Q2",
      retrievedAt: "2026-09-28T00:00:00Z",
      candidateName: "Example Foods",
      identityDecision: "none" as const,
      matchReason: "No match.",
      coverageExplanation: "Company and state only.",
      companyEvidence: "no_verified_match" as const,
      productEvidence: "not_available" as const,
      originEvidence: "not_available" as const,
      shipmentEvidence: "not_verified" as const,
      attribution: "FDA",
    };
    const selection = selectTradeResearchEvidenceForRead(emptySummary({ sources: [legacySource] }));
    expect(selection.kind).toBe("legacy_multi_source");
  });
});
