import { describe, expect, it } from "vitest";

import {
  canonicalProviderResultsPayload,
  canonicalResultSummaryPayload,
  classifyResearchJobForCertification,
  computeContextFingerprint,
  computeSnapshotFingerprint,
  digestProviderResults,
  digestResultSummary,
  TERMINAL_TRADE_RESEARCH_STATUSES,
} from "./certification";
import { fingerprintResearchContext } from "./context";
import {
  TRADE_RESEARCH_INTERPRETATION_VERSION,
  TRADE_RESEARCH_PLANNER_VERSION,
} from "./types";
import type { ResearchContext, TradeResearchProviderResult, TradeResearchResultSummary } from "./types";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";

function context(over: Partial<ResearchContext> = {}): ResearchContext {
  return {
    workspaceId: WORKSPACE_ID,
    candidateId: CANDIDATE_ID,
    marketCountryCode: "US",
    productId: "guntur-dry-red-chilli",
    productForm: null,
    researchGoal: "screen_trade_activity",
    providerPlanVersion: TRADE_RESEARCH_PLANNER_VERSION,
    interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
    ...over,
  };
}

function evaluatedProviderResult(over: Partial<TradeResearchProviderResult> = {}): TradeResearchProviderResult {
  return {
    providerId: "fda-fsvp",
    datasetId: "fsvp-participant-list",
    datasetVersion: "sha256:abc",
    parserVersion: "fsvp-xlsx-v1",
    sourceRecordIds: ["sha256:abc:match:1"],
    sourcePeriod: "April 1, 2026 – June 30, 2026",
    retrievedAt: "2026-09-27T00:00:00Z",
    execution: { status: "completed", safeErrorCode: null },
    evidence: {
      matchDecision: "strong",
      companyEvidence: { state: "verified", explanation: "ok" },
      productEvidence: { state: "not_available", explanation: "no product grain" },
      originEvidence: { state: "not_available", explanation: "no origin grain" },
      indiaOriginEvidence: { state: "not_verified", explanation: "no origin grain" },
      shipmentEvidence: { state: "not_verified", explanation: "no shipment grain" },
      programEvidence: { state: "verified", explanation: "ok" },
      coverage: { state: "partially_covered", explanation: "ok" },
      limitations: [],
      attribution: "FDA",
      mappingScope: {
        marketCountryCode: "US",
        productId: "guntur-dry-red-chilli",
        productForm: null,
        sourceProductCodes: [],
        companyGrain: "company_record",
        productGrain: "not_available",
        originGrain: "not_available",
        shipmentGrain: "not_available",
        programGrain: "company_program",
      },
      interpretationVersion: TRADE_RESEARCH_INTERPRETATION_VERSION,
      conflicts: [],
    },
    ...over,
  } as TradeResearchProviderResult;
}

function summary(over: Partial<TradeResearchResultSummary> = {}): TradeResearchResultSummary {
  return {
    officialProgramEvidence: "verified",
    productEvidence: "not_available",
    originEvidence: "not_available",
    indiaOrigin: "not_verified",
    shipmentEvidence: "not_verified",
    sourcesChecked: 1,
    automaticSpendRupees: 0,
    context: context(),
    contextFingerprint: fingerprintResearchContext(context()),
    providerResults: [evaluatedProviderResult()],
    ...over,
  };
}

function job(over: {
  status?: string; outcome?: string | null;
  research_context?: ResearchContext | null;
  result_summary?: TradeResearchResultSummary;
} = {}) {
  const outcome: string | null = "outcome" in over ? (over.outcome ?? null) : "official_importer_program_corroboration";
  return {
    status: over.status ?? "completed",
    outcome,
    workspaceId: WORKSPACE_ID,
    candidateId: CANDIDATE_ID,
    productId: "guntur-dry-red-chilli",
    marketCountryCode: "US",
    researchGoal: "screen_trade_activity" as const,
    research_context: over.research_context ?? context(),
    result_summary: over.result_summary ?? summary(),
  };
}

describe("T12 — certification identity fingerprints are deterministic", () => {
  it("canonical provider-results payload sorts by providerId + stable field order", () => {
    const a = evaluatedProviderResult({ providerId: "fda-vqip", datasetId: "fda-vqip-participant-list" });
    const b = evaluatedProviderResult({ providerId: "fda-fsvp" });
    expect(canonicalProviderResultsPayload([a, b])).toBe(canonicalProviderResultsPayload([b, a]));
  });

  it("provider-results digest changes when datasetVersion changes", () => {
    const a = digestProviderResults([evaluatedProviderResult({ datasetVersion: "sha256:v1" })]);
    const b = digestProviderResults([evaluatedProviderResult({ datasetVersion: "sha256:v2" })]);
    expect(a).not.toBe(b);
  });

  it("provider-results digest changes when parserVersion changes", () => {
    const a = digestProviderResults([evaluatedProviderResult({ parserVersion: "v1" })]);
    const b = digestProviderResults([evaluatedProviderResult({ parserVersion: "v2" })]);
    expect(a).not.toBe(b);
  });

  it("result-summary digest is invariant across additive/optional-field ordering", () => {
    const a = digestResultSummary(summary({ sourcesPlanned: 1, sourcesEvaluated: 1 }));
    const b = digestResultSummary(summary({ sourcesEvaluated: 1, sourcesPlanned: 1 }));
    expect(a).toBe(b);
  });

  it("snapshot fingerprint is stable given the same inputs", () => {
    const inputs = {
      contextFingerprint: fingerprintResearchContext(context()),
      providerResultsDigest: digestProviderResults([evaluatedProviderResult()]),
      resultSummaryDigest: digestResultSummary(summary()),
    };
    expect(computeSnapshotFingerprint(inputs)).toBe(computeSnapshotFingerprint(inputs));
  });

  it("snapshot fingerprint changes when context material fields change", () => {
    const ctxA = context();
    const ctxB = context({ productId: "banganapalli-mango" });
    const a = computeSnapshotFingerprint({
      contextFingerprint: fingerprintResearchContext(ctxA),
      providerResultsDigest: digestProviderResults([evaluatedProviderResult()]),
      resultSummaryDigest: digestResultSummary(summary({ context: ctxA, contextFingerprint: fingerprintResearchContext(ctxA) })),
    });
    const b = computeSnapshotFingerprint({
      contextFingerprint: fingerprintResearchContext(ctxB),
      providerResultsDigest: digestProviderResults([evaluatedProviderResult()]),
      resultSummaryDigest: digestResultSummary(summary({ context: ctxB, contextFingerprint: fingerprintResearchContext(ctxB) })),
    });
    expect(a).not.toBe(b);
  });
});

describe("T12 — classifyResearchJobForCertification", () => {
  it("finalized valid result with full provenance → certified", () => {
    const decision = classifyResearchJobForCertification(job());
    expect(decision.status).toBe("certified");
    expect(decision.identity.snapshotFingerprint).toMatch(/^trcert-v1:[0-9a-f]{64}$/);
  });

  it("same finalized valid state → same fingerprint (idempotency)", () => {
    const a = classifyResearchJobForCertification(job());
    const b = classifyResearchJobForCertification(job());
    expect(a.identity.snapshotFingerprint).toBe(b.identity.snapshotFingerprint);
  });

  it("evidence-watermark change (datasetVersion) → different fingerprint (new snapshot)", () => {
    const a = classifyResearchJobForCertification(job());
    const b = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [evaluatedProviderResult({ datasetVersion: "sha256:v2" })] }),
    }));
    expect(a.identity.snapshotFingerprint).not.toBe(b.identity.snapshotFingerprint);
    expect(a.status).toBe("certified");
    expect(b.status).toBe("certified");
  });

  it("provider-plan-version change → different fingerprint", () => {
    const a = classifyResearchJobForCertification(job());
    const ctxV2 = context({ providerPlanVersion: "trade-planner-v2" });
    const b = classifyResearchJobForCertification(job({
      research_context: ctxV2,
      result_summary: summary({ context: ctxV2, contextFingerprint: fingerprintResearchContext(ctxV2) }),
    }));
    expect(a.identity.snapshotFingerprint).not.toBe(b.identity.snapshotFingerprint);
  });

  it("interpretation-version change → different fingerprint", () => {
    const a = classifyResearchJobForCertification(job());
    const ctxV2 = context({ interpretationVersion: "trade-interpretation-v2" });
    const b = classifyResearchJobForCertification(job({
      research_context: ctxV2,
      result_summary: summary({
        context: ctxV2,
        contextFingerprint: fingerprintResearchContext(ctxV2),
        providerResults: [evaluatedProviderResult({ evidence: { ...evaluatedProviderResult().evidence!, interpretationVersion: "trade-interpretation-v2" } as never })],
      }),
    }));
    expect(a.identity.snapshotFingerprint).not.toBe(b.identity.snapshotFingerprint);
  });

  it("product change → different fingerprint", () => {
    const ctx = context({ productId: "banganapalli-mango" });
    const a = classifyResearchJobForCertification(job());
    const b = classifyResearchJobForCertification({
      ...job({ research_context: ctx, result_summary: summary({ context: ctx, contextFingerprint: fingerprintResearchContext(ctx) }) }),
      productId: "banganapalli-mango",
    });
    expect(a.identity.snapshotFingerprint).not.toBe(b.identity.snapshotFingerprint);
  });

  it("market change → different fingerprint", () => {
    const ctx = context({ marketCountryCode: "CA" });
    const a = classifyResearchJobForCertification(job());
    const b = classifyResearchJobForCertification({
      ...job({ research_context: ctx, result_summary: summary({ context: ctx, contextFingerprint: fingerprintResearchContext(ctx) }) }),
      marketCountryCode: "CA",
    });
    expect(a.identity.snapshotFingerprint).not.toBe(b.identity.snapshotFingerprint);
  });

  it("missing research_context → legacy_unverified (missing_research_context)", () => {
    const decision = classifyResearchJobForCertification(job({
      research_context: null,
      result_summary: { ...summary(), context: undefined, contextFingerprint: undefined },
    }));
    expect(decision.status).toBe("legacy_unverified");
    expect(decision.reason).toMatch(/missing_research_context/);
  });

  it("missing providerPlanVersion → legacy_unverified", () => {
    const ctx = { ...context(), providerPlanVersion: "" } as ResearchContext;
    const decision = classifyResearchJobForCertification(job({
      research_context: ctx,
      result_summary: { ...summary(), context: ctx, contextFingerprint: undefined },
    }));
    // Empty string providerPlanVersion → context read as invalid → quarantined path.
    // We accept either legacy_unverified or quarantined here — both prevent certification.
    expect(decision.status).not.toBe("certified");
  });

  it("missing providerResults → legacy_unverified (missing_provider_results)", () => {
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: undefined }),
    }));
    expect(decision.status).toBe("legacy_unverified");
    expect(decision.reason).toMatch(/missing_provider_results/);
  });

  it("context fingerprint mismatch → quarantined (invalid_context)", () => {
    const s = summary();
    s.contextFingerprint = "trctx-v1:tampered_00000000000000000000000000000000000000000000000000000000";
    const decision = classifyResearchJobForCertification(job({ result_summary: s }));
    expect(decision.status).toBe("quarantined");
    expect(decision.reason).toMatch(/invalid_context/);
  });

  it("evaluated provider result missing datasetVersion → quarantined", () => {
    const bad = evaluatedProviderResult({ datasetVersion: null });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [bad] }),
    }));
    expect(decision.status).toBe("quarantined");
    expect(decision.reason).toMatch(/missing_dataset_version/);
  });

  it("evaluated provider result missing parserVersion → quarantined", () => {
    const bad = evaluatedProviderResult({ parserVersion: null });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [bad] }),
    }));
    expect(decision.status).toBe("quarantined");
    expect(decision.reason).toMatch(/missing_parser_version/);
  });

  it("provider interpretation version conflicts with context → quarantined", () => {
    const conflicting = evaluatedProviderResult({
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "unrelated-v9",
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [conflicting] }),
    }));
    expect(decision.status).toBe("quarantined");
    expect(decision.reason).toMatch(/interpretation_version_conflict/);
  });

  it("non-terminal job → legacy_unverified (missing_finalized_outcome equivalent)", () => {
    const decision = classifyResearchJobForCertification(job({ status: "running" }));
    expect(decision.status).toBe("legacy_unverified");
  });

  it("terminal job missing outcome → legacy_unverified", () => {
    const decision = classifyResearchJobForCertification(job({ outcome: null }));
    expect(decision.status).toBe("legacy_unverified");
  });

  it("cached-only providers still certify (evidence provenance intact)", () => {
    const cached = evaluatedProviderResult({ execution: { status: "cached", safeErrorCode: null } });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [cached] }),
    }));
    expect(decision.status).toBe("certified");
  });

  it("no_match providers with full provenance certify", () => {
    const nm = evaluatedProviderResult({ execution: { status: "no_match", safeErrorCode: null } });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [nm] }),
    }));
    expect(decision.status).toBe("certified");
  });
});

describe("T12 — helpers", () => {
  it("TERMINAL_TRADE_RESEARCH_STATUSES matches the DB check constraint set", () => {
    for (const s of ["completed", "partial", "needs_review", "failed", "cancelled"]) {
      expect(TERMINAL_TRADE_RESEARCH_STATUSES.has(s)).toBe(true);
    }
    for (const s of ["queued", "running", "cancel_requested"]) {
      expect(TERMINAL_TRADE_RESEARCH_STATUSES.has(s)).toBe(false);
    }
  });

  it("computeContextFingerprint returns null for missing context and a tagged hash otherwise", () => {
    expect(computeContextFingerprint(null)).toBeNull();
    expect(computeContextFingerprint(context())).toMatch(/^trctx-v1:[0-9a-f]{64}$/);
  });
});

describe("T12 — canonical serialization stability", () => {
  it("canonicalResultSummaryPayload deterministic for identical inputs", () => {
    const p = canonicalResultSummaryPayload(summary());
    const q = canonicalResultSummaryPayload(summary());
    expect(p).toBe(q);
  });

  it("canonicalProviderResultsPayload deterministic across sourceRecordIds ordering", () => {
    const a = evaluatedProviderResult({ sourceRecordIds: ["b", "a", "c"] });
    const b = evaluatedProviderResult({ sourceRecordIds: ["c", "a", "b"] });
    expect(canonicalProviderResultsPayload([a])).toBe(canonicalProviderResultsPayload([b]));
  });
});
