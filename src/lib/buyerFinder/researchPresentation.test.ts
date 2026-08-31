import { describe, expect, it } from "vitest";
import type { FreeEnrichmentJob } from "./freeEnrichmentJob";
import { companyResearchState, researchFeedbackCopy, researchJobLabel } from "./researchPresentation";

function job(over: Partial<FreeEnrichmentJob> & Pick<FreeEnrichmentJob, "status">): FreeEnrichmentJob {
  return {
    id: "j1",
    workspaceId: "ws",
    candidateId: "c1",
    capability: "public_company_contacts",
    attemptCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("companyResearchState", () => {
  it("is ready when every capability is succeeded or no_result", () => {
    expect(
      companyResearchState([
        job({ status: "succeeded", capability: "public_company_contacts" }),
        job({ status: "no_result", capability: "decision_makers" }),
      ]),
    ).toBe("ready");
  });

  it("is researching while any job is queued, processing, or retry_wait", () => {
    expect(
      companyResearchState([
        job({ status: "succeeded" }),
        job({ status: "processing", capability: "decision_makers" }),
      ]),
    ).toBe("researching");
    expect(companyResearchState([job({ status: "queued" })])).toBe("researching");
    expect(companyResearchState([job({ status: "retry_wait" })])).toBe("researching");
  });

  it("is needs_attention when any job failed, even if the other succeeded", () => {
    expect(
      companyResearchState([
        job({ status: "failed", capability: "public_company_contacts" }),
        job({ status: "succeeded", capability: "decision_makers" }),
      ]),
    ).toBe("needs_attention");
  });
});

describe("researchJobLabel", () => {
  it("uses operator vocabulary instead of raw DB strings", () => {
    expect(researchJobLabel("queued")).toBe("Waiting");
    expect(researchJobLabel("processing")).toBe("Researching");
    expect(researchJobLabel("retry_wait")).toBe("Retrying");
    expect(researchJobLabel("succeeded")).toBe("Ready");
    expect(researchJobLabel("succeeded", "blocked")).toBe("Website restricted");
    expect(researchJobLabel("no_result")).toBe("No result found");
    expect(researchJobLabel("failed")).toBe("Needs attention");
  });
});

describe("researchFeedbackCopy", () => {
  it("does not invent percentages", () => {
    expect(
      researchFeedbackCopy({
        researching: 5,
        needsAttention: 0,
        ready: 20,
        companies: 29,
        checksRemaining: 5,
      }),
    ).toBe("Free research is running automatically · 5 checks remaining");
    expect(
      researchFeedbackCopy({
        researching: 0,
        needsAttention: 7,
        ready: 22,
        companies: 29,
        checksRemaining: 0,
      }),
    ).toBe("Research complete · 7 need attention");
    expect(
      researchFeedbackCopy({
        researching: 0,
        needsAttention: 0,
        ready: 29,
        companies: 29,
        checksRemaining: 0,
      }),
    ).toBe("Free research complete");
  });
});
