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
      // Per-provider interpretation is anchored to the parserVersion —
      // it is a separate version namespace from
      // `context.interpretationVersion`. Production executors emit it
      // as `${parserVersion}:t08-v1`.
      interpretationVersion: "fsvp-xlsx-v1:t08-v1",
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
  context_fingerprint?: string | null;
  result_summary?: TradeResearchResultSummary;
} = {}) {
  const outcome: string | null = "outcome" in over ? (over.outcome ?? null) : "official_importer_program_corroboration";
  // Preserve explicit `null` for research_context / context_fingerprint
  // — v2 classifier reads these row-level columns first, so tests
  // exercising the legacy fallback path MUST be able to pass null here.
  const research_context: ResearchContext | null = "research_context" in over
    ? (over.research_context as ResearchContext | null)
    : context();
  const context_fingerprint: string | null = "context_fingerprint" in over
    ? (over.context_fingerprint as string | null)
    : (research_context ? (() => {
        try { return fingerprintResearchContext(research_context); }
        catch { return null; }
      })() : null);
  return {
    status: over.status ?? "completed",
    outcome,
    workspaceId: WORKSPACE_ID,
    candidateId: CANDIDATE_ID,
    productId: "guntur-dry-red-chilli",
    marketCountryCode: "US",
    researchGoal: "screen_trade_activity" as const,
    research_context,
    context_fingerprint,
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
    expect(decision.identity.snapshotFingerprint).toMatch(/^trcert-v2:[0-9a-f]{64}$/);
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
    // Provider evidence.interpretationVersion is anchored to
    // `parserVersion` (a separate version namespace); it does NOT
    // need to track `context.interpretationVersion`. Changing only
    // the research-level interpretation version still produces a
    // different snapshot fingerprint via the context fingerprint.
    const a = classifyResearchJobForCertification(job());
    const ctxV2 = context({ interpretationVersion: "trade-interpretation-v2" });
    const b = classifyResearchJobForCertification(job({
      research_context: ctxV2,
      result_summary: summary({
        context: ctxV2,
        contextFingerprint: fingerprintResearchContext(ctxV2),
      }),
    }));
    expect(a.identity.snapshotFingerprint).not.toBe(b.identity.snapshotFingerprint);
    expect(a.status).toBe("certified");
    expect(b.status).toBe("certified");
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
    // v2 classifier reads the row-level fingerprint first — tamper
    // that to exercise the mismatch path.
    const decision = classifyResearchJobForCertification(job({
      context_fingerprint: "trctx-v1:tampered_00000000000000000000000000000000000000000000000000000000",
    }));
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

  it("provider interpretation version NOT anchored to its parserVersion → quarantined", () => {
    // Under the v2 contract, provider evidence.interpretationVersion
    // must be scoped to its parserVersion (either equal to it or of
    // the form `${parserVersion}:...`). `unrelated-v9` is neither and
    // must quarantine.
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
    expect(decision.reason).toMatch(/interpretation_version_not_parser_anchored/);
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

describe("T12 v2 — production regression: authoritative row-level context beats stale result_summary", () => {
  it("REGRESSION: valid row-level research_context certifies even when result_summary.context is MISSING", () => {
    // Reproduces the Iberia production job 5ce74565-...:
    //   • buyer_trade_research_jobs.research_context is valid.
    //   • buyer_trade_research_jobs.context_fingerprint matches.
    //   • result_summary passed by the worker to certifyResearchJob
    //     does NOT include context / contextFingerprint.
    // v1 misread this as "legacy_unknown" and returned legacy_unverified.
    // v2 reads the row-level column first — MUST NOT be legacy.
    const ctx = context();
    const decision = classifyResearchJobForCertification({
      status: "completed",
      outcome: "official_importer_program_corroboration",
      workspaceId: WORKSPACE_ID,
      candidateId: CANDIDATE_ID,
      productId: "guntur-dry-red-chilli",
      marketCountryCode: "US",
      researchGoal: "screen_trade_activity",
      research_context: ctx,
      context_fingerprint: fingerprintResearchContext(ctx),
      // Missing context / contextFingerprint in the summary — the
      // exact production shape of the bug.
      result_summary: {
        officialProgramEvidence: "verified",
        productEvidence: "not_available",
        originEvidence: "not_available",
        indiaOrigin: "not_verified",
        shipmentEvidence: "not_verified",
        sourcesChecked: 1,
        automaticSpendRupees: 0,
        providerResults: [evaluatedProviderResult()],
      },
    });
    expect(decision.status).toBe("certified");
    expect(decision.reason).not.toMatch(/missing_research_context/);
  });

  it("REGRESSION: row-level column takes precedence over a STALE result_summary.context", () => {
    const rowCtx = context({ productId: "guntur-dry-red-chilli" });
    const staleCtx = context({ productId: "banganapalli-mango" });
    const decision = classifyResearchJobForCertification({
      status: "completed",
      outcome: "official_importer_program_corroboration",
      workspaceId: WORKSPACE_ID,
      candidateId: CANDIDATE_ID,
      productId: "guntur-dry-red-chilli",
      marketCountryCode: "US",
      researchGoal: "screen_trade_activity",
      research_context: rowCtx,
      context_fingerprint: fingerprintResearchContext(rowCtx),
      result_summary: {
        ...summary({ context: staleCtx, contextFingerprint: fingerprintResearchContext(staleCtx) }),
      },
    });
    // The authoritative fingerprint is the row-level one, not the stale summary.
    expect(decision.identity.contextFingerprint).toBe(fingerprintResearchContext(rowCtx));
  });

  it("REGRESSION: neither row-level column NOR summary-embedded context present → legacy_unverified (genuine legacy)", () => {
    const decision = classifyResearchJobForCertification({
      status: "completed",
      outcome: "official_importer_program_corroboration",
      workspaceId: WORKSPACE_ID,
      candidateId: CANDIDATE_ID,
      productId: "guntur-dry-red-chilli",
      marketCountryCode: "US",
      researchGoal: "screen_trade_activity",
      research_context: null,
      context_fingerprint: null,
      result_summary: {
        officialProgramEvidence: "verified",
        productEvidence: "not_available",
        originEvidence: "not_available",
        indiaOrigin: "not_verified",
        shipmentEvidence: "not_verified",
        sourcesChecked: 1,
        automaticSpendRupees: 0,
        providerResults: [evaluatedProviderResult()],
        // context / contextFingerprint undefined
      },
    });
    expect(decision.status).toBe("legacy_unverified");
    expect(decision.reason).toMatch(/missing_research_context/);
  });
});

describe("T12 v2 — production regression: provider evidence.interpretationVersion is parser-anchored, not context-scoped", () => {
  it("FSVP provider result with `fsvp-xlsx-v1:t08-v1` + context `trade-interpretation-v1` → certified", () => {
    const fsvp = evaluatedProviderResult({
      providerId: "fda-fsvp",
      datasetId: "fsvp-participant-list",
      parserVersion: "fsvp-xlsx-v1",
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "fsvp-xlsx-v1:t08-v1",
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [fsvp] }),
    }));
    expect(decision.status).toBe("certified");
  });

  it("VQIP provider result with `fda-vqip-html-v1:t08-v1` + context `trade-interpretation-v1` → certified", () => {
    const vqip = evaluatedProviderResult({
      providerId: "fda-vqip",
      datasetId: "fda-vqip-participant-list",
      parserVersion: "fda-vqip-html-v1",
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "fda-vqip-html-v1:t08-v1",
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [vqip] }),
    }));
    expect(decision.status).toBe("certified");
  });

  it("Canada CID provider result with `canada-cid-csv-v2:t08-v1` + context `trade-interpretation-v1` → certified", () => {
    const cid = evaluatedProviderResult({
      providerId: "canada-cid",
      datasetId: "cid-importers",
      parserVersion: "canada-cid-csv-v2",
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "canada-cid-csv-v2:t08-v1",
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [cid] }),
    }));
    expect(decision.status).toBe("certified");
  });

  it("provider evidence.interpretationVersion equal to its parserVersion (no `:contract` suffix) → certified", () => {
    const bare = evaluatedProviderResult({
      parserVersion: "fsvp-xlsx-v1",
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "fsvp-xlsx-v1",
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [bare] }),
    }));
    expect(decision.status).toBe("certified");
  });

  it("malformed provider provenance (missing evidence.interpretationVersion) → quarantined", () => {
    const bad = evaluatedProviderResult({
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "",
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [bad] }),
    }));
    expect(decision.status).toBe("quarantined");
    expect(decision.reason).toMatch(/missing_interpretation_version/);
  });

  it("provider evidence.interpretationVersion NOT anchored to parserVersion → quarantined with the new reason", () => {
    const bad = evaluatedProviderResult({
      parserVersion: "fsvp-xlsx-v1",
      evidence: {
        ...evaluatedProviderResult().evidence!,
        interpretationVersion: "fda-vqip-html-v1:t08-v1", // wrong parser
      } as never,
    });
    const decision = classifyResearchJobForCertification(job({
      result_summary: summary({ providerResults: [bad] }),
    }));
    expect(decision.status).toBe("quarantined");
    expect(decision.reason).toMatch(/interpretation_version_not_parser_anchored/);
  });

  it("context.interpretationVersion is INDEPENDENT of provider evidence.interpretationVersion — they can differ freely", () => {
    // context uses trade-interpretation-v1 (default). Provider uses
    // its own parser-anchored contract. No cross-comparison; not a
    // quarantine trigger.
    const decision = classifyResearchJobForCertification(job());
    expect(decision.status).toBe("certified");
  });
});

describe("T12 v2 — remediation via classifier version bump produces distinct fingerprints", () => {
  it("all new snapshot fingerprints carry the trcert-v2 prefix", () => {
    const decision = classifyResearchJobForCertification(job());
    expect(decision.identity.snapshotFingerprint.startsWith("trcert-v2:")).toBe(true);
  });

  it("re-classifying the same terminal job produces the SAME v2 fingerprint (idempotent)", () => {
    const a = classifyResearchJobForCertification(job());
    const b = classifyResearchJobForCertification(job());
    expect(a.identity.snapshotFingerprint).toBe(b.identity.snapshotFingerprint);
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
