import { describe, expect, it } from "vitest";
import type { FreeEnrichmentJob } from "./freeEnrichmentJob";
import { summarizeFreeEnrichmentJobs } from "./freeEnrichmentSummary";

function job(
  candidateId: string,
  capability: FreeEnrichmentJob["capability"],
  status: FreeEnrichmentJob["status"],
): FreeEnrichmentJob {
  return {
    id: `${candidateId}-${capability}`,
    workspaceId: "ws",
    candidateId,
    capability,
    status,
    attemptCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("summarizeFreeEnrichmentJobs", () => {
  it("counts ready, researching, and needs-attention from durable terminal states", () => {
    const summary = summarizeFreeEnrichmentJobs({
      jobs: [
        job("a", "public_company_contacts", "succeeded"),
        job("a", "decision_makers", "no_result"),
        job("b", "public_company_contacts", "processing"),
        job("b", "decision_makers", "queued"),
        job("c", "public_company_contacts", "failed"),
        job("c", "decision_makers", "succeeded"),
        job("d", "public_company_contacts", "retry_wait"),
        job("d", "decision_makers", "succeeded"),
      ],
      companyIds: ["a", "b", "c", "d"],
      publicEmailCount: 27,
      companiesWithPublicEmail: 12,
      decisionMakerCount: 43,
      highPriorityCount: 1,
    });
    expect(summary.ready).toBe(1);
    expect(summary.complete).toBe(1);
    expect(summary.researching).toBe(2);
    expect(summary.needsAttention).toBe(1);
    expect(summary.checksRemaining).toBe(3);
    expect(summary.companiesWithPublicEmail).toBe(12);
    expect(summary.publicEmailsFound).toBe(27);
    expect(summary.peopleFound).toBe(43);
    expect(summary.highRevealPriority).toBe(1);
  });
});
