import { describe, expect, it } from "vitest";
import { buildBuyerIntelligenceViewModel, emptyBuyerIntelligenceViewModel } from "./viewModel";
import { BI_FIXTURE_CANDIDATE_ID, BI_FIXTURE_WORKSPACE_ID, buyerIntelligenceClaimFixtures, buyerIntelligenceSourceFixtures, controlledBuyerIntelligenceViewModel } from "./testUtils/fixtures";

describe("BI1 read-only view model", () => {
  it("projects provenance without exposing internal source keys or metadata", () => {
    const model = controlledBuyerIntelligenceViewModel();
    expect(model.sources[0]).not.toHaveProperty("sourceKey");
    expect(model.sources[0]).not.toHaveProperty("metadata");
    expect(model.sources[0].evidence).toEqual([
      { evidenceType: "verified_trade_evidence", evidenceLevel: 1 },
    ]);
  });

  it("uses truthful empty states without synthetic trade values", () => {
    const model = emptyBuyerIntelligenceViewModel({ contacts: [], publicEmails: [] });
    expect(model.overview.legitimacy.classification).toBe("no_evidence_found");
    expect(model.overview.metrics.lastObservedTrade).toBeUndefined();
    expect(model.overview.metrics.indiaShipmentShare).toBeUndefined();
    expect(model.trade.rows).toEqual([]);
  });

  it("prefers persisted assessments and exposes their durable evidence links", () => {
    const assessmentId = "a0000000-0000-4000-8000-000000000001";
    const model = buildBuyerIntelligenceViewModel({ sources: buyerIntelligenceSourceFixtures,
      claims: [buyerIntelligenceClaimFixtures[0]], trade: { rows: [] }, metrics: [], contactAccess: { contacts: [], publicEmails: [] },
      assessments: [{ id: assessmentId, workspaceId: BI_FIXTURE_WORKSPACE_ID, candidateId: BI_FIXTURE_CANDIDATE_ID,
        assessmentType: "buyer_legitimacy", classification: "moderate_evidence", summary: "Persisted result.",
        components: [{ key: "business_evidence", explanation: "Persisted.", evidenceCount: 1 }],
        calculatedAt: "2026-09-02T00:00:00Z", calculationVersion: "bi2-legitimacy-v1",
        createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" }],
      assessmentEvidence: [{ id: "b0000000-0000-4000-8000-000000000001", workspaceId: BI_FIXTURE_WORKSPACE_ID,
        candidateId: BI_FIXTURE_CANDIDATE_ID, assessmentId, componentKey: "business_evidence", kind: "claim",
        claimId: buyerIntelligenceClaimFixtures[0].id, createdAt: "2026-09-02T00:00:00Z" }],
    });
    expect(model.overview.legitimacy.summary).toBe("Persisted result.");
    expect(model.overview.legitimacy.evidence).toEqual([{ kind: "claim", id: buyerIntelligenceClaimFixtures[0].id, componentKey: "business_evidence" }]);
    expect(model.overview.linkedAssessmentEvidenceCount).toBe(1);
  });
});
