import { describe, expect, it } from "vitest";

import { aggregateTradeResearchEvidence } from "./aggregation";
import type {
  TradeResearchEvidenceLevel,
  TradeResearchProviderExecutionState,
  TradeResearchProviderResult,
} from "./types";

type EvidenceOverrides = {
  decision?: "exact" | "strong" | "ambiguous" | "rejected" | "none";
  company?: TradeResearchEvidenceLevel;
  product?: TradeResearchEvidenceLevel;
  origin?: TradeResearchEvidenceLevel;
  india?: TradeResearchEvidenceLevel;
  shipment?: TradeResearchEvidenceLevel;
  program?: TradeResearchEvidenceLevel;
  productGrain?: "company_product" | "market_product" | "not_available";
  originGrain?: "company_product_origin" | "market_product_origin" | "not_available";
  shipmentGrain?: "shipment_record" | "not_available";
  programGrain?: "company_program" | "not_available";
  conflict?: { dimension: "identity" | "product" | "origin" | "india_origin" | "shipment" | "program" | "coverage"; description: string };
};

function provider(
  providerId: string,
  status: TradeResearchProviderExecutionState = "completed",
  over: EvidenceOverrides = {},
): TradeResearchProviderResult {
  const evaluated = status === "completed" || status === "no_match" || status === "cached";
  if (!evaluated) {
    return {
      providerId, datasetId: `${providerId}-dataset`, datasetVersion: null, parserVersion: null,
      sourceRecordIds: [], sourcePeriod: null, retrievedAt: null,
      execution: { status, safeErrorCode: status.startsWith("failed") ? "SOURCE_UNAVAILABLE" : null }, evidence: null,
    };
  }
  const decision = over.decision ?? (status === "no_match" ? "none" : "strong");
  const company = over.company ?? (decision === "exact" || decision === "strong" ? "verified" : decision === "ambiguous" ? "supporting" : "no_verified_match");
  const assessment = (state: TradeResearchEvidenceLevel) => ({ state, explanation: `${providerId}:${state}` });
  return {
    providerId, datasetId: `${providerId}-dataset`, datasetVersion: "version", parserVersion: "parser",
    sourceRecordIds: [`${providerId}-record`], sourcePeriod: "2026", retrievedAt: "2026-09-28T00:00:00.000Z",
    execution: { status, safeErrorCode: null },
    evidence: {
      matchDecision: decision,
      companyEvidence: assessment(company),
      productEvidence: assessment(over.product ?? "not_available"),
      originEvidence: assessment(over.origin ?? "not_available"),
      indiaOriginEvidence: assessment(over.india ?? "not_verified"),
      shipmentEvidence: assessment(over.shipment ?? "not_verified"),
      programEvidence: assessment(over.program ?? "not_available"),
      coverage: { state: "partially_covered", explanation: "fixture" },
      limitations: [], attribution: providerId,
      mappingScope: {
        marketCountryCode: "US", productId: "guntur-chilli", productForm: null, sourceProductCodes: [],
        companyGrain: "company_record",
        productGrain: over.productGrain ?? "not_available",
        originGrain: over.originGrain ?? "not_available",
        shipmentGrain: over.shipmentGrain ?? "not_available",
        programGrain: over.programGrain ?? "not_available",
      },
      interpretationVersion: "t09-v1",
      conflicts: over.conflict ? [{ ...over.conflict, sourceRecordIds: [`${providerId}-record`] }] : [],
    },
  };
}

describe("T09 conservative identity aggregation", () => {
  it("exact + exact verifies the same candidate identity", () => {
    const result = aggregateTradeResearchEvidence([
      provider("fda-fsvp", "completed", { decision: "exact", program: "verified", programGrain: "company_program" }),
      provider("fda-vqip", "completed", { decision: "exact", program: "verified", programGrain: "company_program" }),
    ]);
    expect(result.identitySummary.state).toBe("verified");
    expect(result.identity).toBe("verified_identity");
  });

  it("exact + ambiguous stays needs_review", () => {
    const result = aggregateTradeResearchEvidence([
      provider("source-a", "completed", { decision: "exact" }),
      provider("source-b", "completed", { decision: "ambiguous" }),
    ]);
    expect(result.identitySummary.state).toBe("needs_review");
  });

  it("exact + rejected emits a deterministic identity conflict", () => {
    const result = aggregateTradeResearchEvidence([
      provider("source-b", "completed", { decision: "rejected" }),
      provider("source-a", "completed", { decision: "exact" }),
    ]);
    expect(result.identitySummary.state).toBe("conflicting");
    expect(result.conflicts).toEqual([expect.objectContaining({
      dimension: "identity", providerIds: ["source-a", "source-b"],
    })]);
  });

  it("ambiguous + none needs review while none + none is no verified match", () => {
    expect(aggregateTradeResearchEvidence([
      provider("a", "completed", { decision: "ambiguous" }), provider("b", "no_match"),
    ]).identitySummary.state).toBe("needs_review");
    expect(aggregateTradeResearchEvidence([
      provider("a", "no_match"), provider("b", "no_match"),
    ]).identitySummary.state).toBe("no_verified_match");
  });

  it("source absence beside a positive source is not a conflict", () => {
    const result = aggregateTradeResearchEvidence([
      provider("positive", "completed", { decision: "exact" }), provider("absent", "no_match"),
    ]);
    expect(result.identitySummary.state).toBe("verified");
    expect(result.conflicts).toEqual([]);
  });
});

describe("T09 independent dimensions and source grains", () => {
  it("verified identity creates no product evidence", () => {
    const result = aggregateTradeResearchEvidence([provider("identity", "completed", { decision: "exact" })]);
    expect(result.productSummary.state).toBe("not_available");
  });

  it("verified product creates no origin evidence", () => {
    const result = aggregateTradeResearchEvidence([provider("product", "completed", {
      product: "verified", productGrain: "company_product",
    })]);
    expect(result.productSummary.state).toBe("verified");
    expect(result.originSummary.state).toBe("not_available");
  });

  it("India origin creates no shipment evidence", () => {
    const result = aggregateTradeResearchEvidence([provider("origin", "completed", {
      origin: "verified", india: "verified", originGrain: "company_product_origin",
    })]);
    expect(result.indiaOriginSummary.state).toBe("verified");
    expect(result.shipmentSummary.state).toBe("not_verified");
  });

  it.each(["fda-fsvp", "fda-vqip"])("%s program participation cannot promote shipment evidence", (providerId) => {
    const result = aggregateTradeResearchEvidence([provider(providerId, "completed", {
      program: "verified", programGrain: "company_program",
    })]);
    expect(result.programSummary.state).toBe("verified");
    expect(result.shipmentSummary.state).toBe("not_verified");
  });

  it("rejects positive evidence whose declared source grain cannot support it", () => {
    const result = aggregateTradeResearchEvidence([provider("bad-grain", "completed", {
      product: "verified", origin: "verified", india: "verified", shipment: "verified", program: "verified",
    })]);
    expect(result.productSummary.state).toBe("not_available");
    expect(result.originSummary.state).toBe("not_available");
    expect(result.indiaOriginSummary.state).toBe("not_verified");
    expect(result.shipmentSummary.state).toBe("not_verified");
    expect(result.programSummary.state).toBe("not_available");
  });

  it("CID rejected identity cannot surface an India row", () => {
    const result = aggregateTradeResearchEvidence([provider("canada-cid", "no_match", {
      decision: "rejected", india: "not_verified", originGrain: "company_product_origin",
    })]);
    expect(result.identitySummary.state).toBe("no_verified_match");
    expect(result.indiaOriginSummary.state).toBe("not_verified");
  });

  it("does not join identity from source A to origin from source B with an unsupported grain", () => {
    const result = aggregateTradeResearchEvidence([
      provider("identity-source", "completed", { decision: "exact" }),
      provider("market-origin-source", "completed", { decision: "none", origin: "verified", originGrain: "market_product_origin" }),
    ]);
    expect(result.identitySummary.state).toBe("verified");
    expect(result.originSummary.state).toBe("not_available");
  });

  it("preserves true origin contradictions while absence remains non-conflicting", () => {
    const description = "One source reports India and another explicitly reports a different origin.";
    const conflicting = aggregateTradeResearchEvidence([
      provider("a", "completed", { origin: "verified", originGrain: "company_product_origin", conflict: { dimension: "origin", description } }),
      provider("b", "completed", { origin: "verified", originGrain: "company_product_origin", conflict: { dimension: "origin", description } }),
    ]);
    expect(conflicting.originSummary.state).toBe("conflicting");
    expect(conflicting.conflicts[0]).toMatchObject({ dimension: "origin", providerIds: ["a", "b"] });

    const absence = aggregateTradeResearchEvidence([
      provider("a", "completed", { origin: "verified", originGrain: "company_product_origin" }),
      provider("b", "completed", { origin: "no_verified_match", originGrain: "company_product_origin" }),
    ]);
    expect(absence.originSummary.state).toBe("verified");
    expect(absence.conflicts).toEqual([]);
  });
});

describe("T09 coverage, source family, and determinism", () => {
  it("keeps provider failure distinct from no-match and retains completed evidence", () => {
    const result = aggregateTradeResearchEvidence([
      provider("complete", "completed", { decision: "exact" }),
      provider("failed", "failed_retryable"),
      provider("no-match", "no_match"),
    ]);
    expect(result.identitySummary.state).toBe("verified");
    expect(result.coverageCounts).toMatchObject({ planned: 3, evaluated: 2, failed: 1 });
  });

  it("unsupported, blocked, and not_started affect coverage only", () => {
    const baseline = provider("complete", "completed", { decision: "exact" });
    const result = aggregateTradeResearchEvidence([
      baseline, provider("unsupported", "unsupported"), provider("blocked", "blocked"), provider("later", "not_started"),
    ]);
    expect(result.identitySummary.state).toBe("verified");
    expect(result.coverageCounts).toMatchObject({ planned: 4, evaluated: 1, unsupported: 1, blocked: 1, notStarted: 1 });
    expect(result.coverageSummary.state).toBe("needs_review");
  });

  it("counts planned, evaluated, cached, failed, unsupported, blocked, not_started, and cancelled", () => {
    const result = aggregateTradeResearchEvidence([
      provider("completed"), provider("cached", "cached"), provider("retry", "failed_retryable"),
      provider("terminal", "failed_terminal"), provider("unsupported", "unsupported"), provider("blocked", "blocked"),
      provider("not-started", "not_started"), provider("cancelled", "cancelled"),
    ]);
    expect(result.coverageCounts).toEqual({ planned: 8, evaluated: 2, cached: 1, failed: 2, unsupported: 1, blocked: 1, notStarted: 1, cancelled: 1 });
  });

  it("tracks related FDA providers as one family without shipment corroboration", () => {
    const result = aggregateTradeResearchEvidence([
      provider("fda-fsvp", "completed", { program: "verified", programGrain: "company_program" }),
      provider("fda-vqip", "completed", { program: "verified", programGrain: "company_program" }),
    ]);
    expect(result.sourceFamilies).toEqual([{ familyId: "fda-program-lists", providerIds: ["fda-fsvp", "fda-vqip"] }]);
    expect(result.sourcesCorroborating).toBe(1);
    expect(result.shipmentSummary.state).toBe("not_verified");
  });

  it.each([1, 2, 3, 5])("aggregates %i planned providers", (count) => {
    const result = aggregateTradeResearchEvidence(Array.from({ length: count }, (_, index) => provider(`provider-${index + 1}`)));
    expect(result.coverageCounts.planned).toBe(count);
    expect(result.coverageCounts.evaluated).toBe(count);
  });

  it("orders providers, families, and conflicts deterministically without mutating input", () => {
    const description = "Explicit product contradiction.";
    const input = [
      provider("z-provider", "completed", { conflict: { dimension: "product", description } }),
      provider("a-provider", "completed", { conflict: { dimension: "product", description } }),
    ];
    const before = JSON.stringify(input);
    const first = aggregateTradeResearchEvidence(input);
    const second = aggregateTradeResearchEvidence([...input].reverse());
    expect(first).toEqual(second);
    expect(first.conflicts[0].providerIds).toEqual(["a-provider", "z-provider"]);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("T09 Iberia Foods production-equivalent regression", () => {
  it("keeps cached ambiguity, cached absence, and unsupported coverage conservative", () => {
    const result = aggregateTradeResearchEvidence([
      provider("fda-fsvp", "cached", {
        decision: "ambiguous", company: "supporting", product: "not_available", origin: "not_available",
        india: "not_verified", shipment: "not_verified", program: "supporting", programGrain: "company_program",
      }),
      provider("fda-vqip", "cached", {
        decision: "none", company: "no_verified_match", product: "not_available", origin: "not_available",
        india: "not_verified", shipment: "not_verified", program: "no_verified_match", programGrain: "company_program",
      }),
      provider("canada-cid", "unsupported"),
    ]);
    expect(result.identitySummary.state).toBe("needs_review");
    expect(result.productSummary.state).toBe("not_available");
    expect(result.originSummary.state).toBe("not_available");
    expect(result.indiaOriginSummary.state).toBe("not_verified");
    expect(result.shipmentSummary.state).toBe("not_verified");
    expect(result.coverageCounts).toMatchObject({ planned: 3, evaluated: 2, cached: 2, unsupported: 1 });
  });
});
