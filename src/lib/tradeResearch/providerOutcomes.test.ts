import { describe, expect, it } from "vitest";

import {
  ProviderOutcomeProjectionError,
  projectProviderOutcomes,
  validateProviderResultSnapshots,
  withProviderOutcomeProjection,
  type ProviderOutcomeAttempt,
  type ProviderOutcomePlan,
} from "./providerOutcomes";
import type { ResearchContext, TradeResearchProviderResult, TradeResearchResultSummary } from "./types";

const plan = (provider: string, sequence: number, overrides: Partial<ProviderOutcomePlan> = {}): ProviderOutcomePlan => ({
  id: `plan-${sequence}`,
  provider_id: provider,
  sequence,
  eligibility: "eligible",
  decision_reason: "eligible",
  ...overrides,
});

const attempt = (providerPlanId: string, state: string, attemptNumber = 1, safeErrorCode: string | null = null): ProviderOutcomeAttempt => ({
  provider_plan_id: providerPlanId,
  attempt_number: attemptNumber,
  state,
  safe_error_code: safeErrorCode,
});

function evaluated(providerId: string, status: "completed" | "no_match" | "cached", marker = providerId): TradeResearchProviderResult {
  return {
    providerId,
    datasetId: `${providerId}-dataset`,
    datasetVersion: `${marker}-version`,
    parserVersion: `${providerId}-parser-v1`,
    sourceRecordIds: [`${marker}-record`],
    sourcePeriod: "2026",
    retrievedAt: "2026-09-28T00:00:00.000Z",
    execution: { status, safeErrorCode: null },
    evidence: {
      matchDecision: status === "no_match" ? "none" : "strong",
      companyEvidence: { state: status === "no_match" ? "no_verified_match" : "verified", explanation: marker },
      productEvidence: { state: "not_available", explanation: marker },
      originEvidence: { state: "not_available", explanation: marker },
      shipmentEvidence: { state: "not_verified", explanation: marker },
      programEvidence: { state: "verified", explanation: marker },
      coverage: { state: "partially_covered", explanation: marker },
      limitations: [`${marker}-limitation`],
      attribution: `${marker}-attribution`,
      mappingScope: {
        marketCountryCode: "US", productId: "product", productForm: null, sourceProductCodes: [],
        companyGrain: "company_record", productGrain: "not_available", originGrain: "not_available",
        shipmentGrain: "not_available", programGrain: "company_program",
      },
      interpretationVersion: "t08-v1",
      conflicts: [],
    },
  };
}

const baseSummary = (): TradeResearchResultSummary => ({
  officialProgramEvidence: "not_checked",
  productEvidence: "not_available",
  indiaOrigin: "not_verified",
  originEvidence: "not_available",
  shipmentEvidence: "not_verified",
  sourcesChecked: 0,
  automaticSpendRupees: 0,
});

describe("T08 authoritative provider outcome projection", () => {
  it("preserves one and multiple completed providers in plan order", () => {
    for (const count of [1, 2, 3, 5]) {
      const plans = Array.from({ length: count }, (_, i) => plan(`provider-${i + 1}`, i + 1));
      const attempts = plans.map((p) => attempt(p.id, "completed"));
      const submitted = [...plans].reverse().map((p) => evaluated(p.provider_id, "completed"));
      const result = projectProviderOutcomes({ plans, attempts, submitted });
      expect(result.providerResults.map((r) => r.providerId)).toEqual(plans.map((p) => p.provider_id));
      expect(result.providerResults).toHaveLength(count);
    }
  });

  it("preserves completed plus no-match as separate evaluated outcomes", () => {
    const plans = [plan("fda-fsvp", 1), plan("fda-vqip", 2)];
    const result = projectProviderOutcomes({
      plans,
      attempts: [attempt("plan-1", "completed"), attempt("plan-2", "completed_no_match")],
      submitted: [evaluated("fda-fsvp", "completed"), evaluated("fda-vqip", "no_match")],
    });
    expect(result.providerResults.map((r) => r.execution.status)).toEqual(["completed", "no_match"]);
  });

  it.each([
    ["failed_terminal", "SOURCE_UNAVAILABLE"],
    ["failed_retryable", "TIMEOUT"],
    ["retry_wait", "HTTP_ERROR"],
  ])("keeps a %s provider beside a completed provider", (state, code) => {
    const plans = [plan("fda-fsvp", 1), plan("fda-vqip", 2)];
    const result = projectProviderOutcomes({
      plans,
      attempts: [attempt("plan-1", state, 1, code), attempt("plan-2", "completed")],
      submitted: [evaluated("fda-vqip", "completed")],
    });
    expect(result.providerResults[0]).toMatchObject({ execution: { status: state === "failed_terminal" ? "failed_terminal" : "failed_retryable", safeErrorCode: code }, evidence: null });
    expect(result.providerResults[1].execution.status).toBe("completed");
  });

  it("preserves both failures without translating either to no_match", () => {
    const result = projectProviderOutcomes({
      plans: [plan("fda-fsvp", 1), plan("fda-vqip", 2)],
      attempts: [attempt("plan-1", "failed_terminal", 1, "PARSE_ERROR"), attempt("plan-2", "retry_wait", 1, "TIMEOUT")],
      submitted: [],
    });
    expect(result.providerResults.map((r) => r.execution.status)).toEqual(["failed_terminal", "failed_retryable"]);
    expect(JSON.stringify(result.providerResults)).not.toContain("provider response body");
  });

  it("replaces an unsafe error string instead of exposing exception text", () => {
    const result = projectProviderOutcomes({
      plans: [plan("fda-fsvp", 1)],
      attempts: [attempt("plan-1", "failed_terminal", 1, "upstream failed: token=secret")],
      submitted: [],
    });
    expect(result.providerResults[0].execution.safeErrorCode).toBe("PROVIDER_FAILURE");
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  it("maps unsupported and blocked ineligible plans explicitly", () => {
    const result = projectProviderOutcomes({
      plans: [
        plan("unsupported-source", 1, { eligibility: "ineligible", decision_reason: "unsupported" }),
        plan("paid-source", 2, { eligibility: "ineligible", decision_reason: "paid" }),
        plan("wrong-market-source", 3, { eligibility: "ineligible", decision_reason: "wrong_country" }),
      ],
      attempts: [], submitted: [],
    });
    expect(result.providerResults.map((r) => r.execution.status)).toEqual(["unsupported", "blocked", "unsupported"]);
  });

  it("keeps never-started plans explicit for partial, deadline, and cancellation projections", () => {
    const plans = [plan("fda-fsvp", 1), plan("fda-vqip", 2)];
    const result = projectProviderOutcomes({
      plans,
      attempts: [attempt("plan-1", "completed")],
      submitted: [evaluated("fda-fsvp", "completed")],
      jobCancelled: true,
    });
    expect(result.providerResults.map((r) => r.execution.status)).toEqual(["completed", "not_started"]);
  });

  it("maps a running attempt to cancelled only when the job is cancelled", () => {
    const plans = [plan("fda-fsvp", 1)];
    expect(projectProviderOutcomes({ plans, attempts: [attempt("plan-1", "running")], submitted: [], jobCancelled: true }).providerResults[0].execution.status).toBe("cancelled");
    expect(projectProviderOutcomes({ plans, attempts: [attempt("plan-1", "running")], submitted: [] }).providerResults[0].execution.status).toBe("failed_retryable");
  });

  it("preserves cached evidence and counts cache separately from fresh success", () => {
    const plans = [plan("fda-fsvp", 1), plan("fda-vqip", 2)];
    const cached = evaluated("fda-fsvp", "cached", "cache");
    const fresh = evaluated("fda-vqip", "completed", "fresh");
    const result = projectProviderOutcomes({
      plans,
      attempts: [attempt("plan-1", "skipped_cached"), attempt("plan-2", "completed")],
      submitted: [fresh, cached],
    });
    expect(result.providerResults[0]).toMatchObject({ execution: { status: "cached" }, datasetVersion: "cache-version", evidence: { attribution: "cache-attribution" } });
    expect(result.counts).toEqual({ sourcesPlanned: 2, sourcesAttempted: 2, sourcesEvaluated: 2, sourcesSucceeded: 1, sourcesFailed: 0, sourcesCached: 1 });
  });

  it("uses the latest attempt while retaining the supplied attempt history", () => {
    const attempts = [attempt("plan-1", "failed_retryable", 1, "TIMEOUT"), attempt("plan-1", "completed", 2)];
    const result = projectProviderOutcomes({ plans: [plan("fda-fsvp", 1)], attempts, submitted: [evaluated("fda-fsvp", "completed")] });
    expect(result.providerResults[0].execution.status).toBe("completed");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ state: "failed_retryable", safe_error_code: "TIMEOUT" });
  });

  it("rejects duplicate, invented, and missing evaluated results", () => {
    const plans = [plan("fda-fsvp", 1)];
    expect(() => projectProviderOutcomes({ plans, attempts: [attempt("plan-1", "completed")], submitted: [] }))
      .toThrowError(new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_RESULT_REQUIRED"));
    expect(() => projectProviderOutcomes({ plans, attempts: [], submitted: [evaluated("invented", "completed")] }))
      .toThrowError(new ProviderOutcomeProjectionError("UNPLANNED_PROVIDER_RESULT"));
    expect(() => projectProviderOutcomes({ plans, attempts: [attempt("plan-1", "completed")], submitted: [evaluated("fda-fsvp", "completed"), evaluated("fda-fsvp", "completed")] }))
      .toThrowError(new ProviderOutcomeProjectionError("DUPLICATE_PROVIDER_RESULT"));
  });

  it("rejects a worker status that conflicts with the latest durable attempt", () => {
    expect(() => projectProviderOutcomes({
      plans: [plan("fda-fsvp", 1)],
      attempts: [attempt("plan-1", "completed_no_match")],
      submitted: [evaluated("fda-fsvp", "completed")],
    })).toThrowError(new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_RESULT_REQUIRED"));
  });

  it("does not fill one provider with another provider's evidence", () => {
    const result = projectProviderOutcomes({
      plans: [plan("fda-fsvp", 1), plan("fda-vqip", 2)],
      attempts: [attempt("plan-1", "completed"), attempt("plan-2", "completed")],
      submitted: [evaluated("fda-fsvp", "completed", "fsvp"), evaluated("fda-vqip", "completed", "vqip")],
    });
    expect(result.providerResults[0].sourceRecordIds).toEqual(["fsvp-record"]);
    expect(result.providerResults[1].sourceRecordIds).toEqual(["vqip-record"]);
    expect(result.providerResults[0].evidence?.attribution).not.toBe(result.providerResults[1].evidence?.attribution);
  });

  it("accepts only evaluated metadata backed by the matching durable snapshot", () => {
    const result = evaluated("fda-fsvp", "completed", "fsvp");
    expect(() => validateProviderResultSnapshots([result], [{
      provider_id: "fda-fsvp", dataset_id: "fda-fsvp-dataset", material_hash: "fsvp-version",
      published_period: "2026", retrieved_at: "2026-09-28T00:00:00.000Z", parse_version: "fda-fsvp-parser-v1",
    }])).not.toThrow();
    expect(() => validateProviderResultSnapshots([result], [{
      provider_id: "fda-vqip", dataset_id: "fda-fsvp-dataset", material_hash: "fsvp-version",
      published_period: "2026", retrieved_at: "2026-09-28T00:00:00.000Z", parse_version: "fda-fsvp-parser-v1",
    }])).toThrowError(new ProviderOutcomeProjectionError("EVALUATED_PROVIDER_SNAPSHOT_REQUIRED"));
  });

  it("adds counts and provider results without changing T07 context", () => {
    const context: ResearchContext = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      candidateId: "00000000-0000-4000-8000-000000000002",
      productId: "product", productForm: null, marketCountryCode: "US",
      researchGoal: "screen_trade_activity", providerPlanVersion: "planner-v1", interpretationVersion: "interpretation-v1",
    };
    const summary = { ...baseSummary(), context, contextFingerprint: "trctx-v1:fingerprint" };
    const projected = withProviderOutcomeProjection(summary, projectProviderOutcomes({
      plans: [plan("fda-fsvp", 1)], attempts: [attempt("plan-1", "failed_terminal", 1, "SOURCE_UNAVAILABLE")], submitted: [],
    }));
    expect(projected.context).toEqual(context);
    expect(projected.contextFingerprint).toBe("trctx-v1:fingerprint");
    expect(projected).toMatchObject({ sourcesPlanned: 1, sourcesAttempted: 1, sourcesEvaluated: 0, sourcesSucceeded: 0, sourcesFailed: 1, sourcesCached: 0 });
  });
});
