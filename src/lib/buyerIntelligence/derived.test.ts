import { describe, expect, it } from "vitest";
import type { BuyerCandidate, BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";
import { calculateDerivedBuyerIntelligence } from "./derived";
import { calculateBuyerPotential } from "./potential";
import { calculateOutreachReadiness } from "./readiness";
import { projectProducts, projectSuppliers } from "./projections";
import {
  BI_FIXTURE_CANDIDATE_ID, buyerIntelligenceClaimFixtures,
  buyerIntelligenceSourceFixtures, buyerTradeObservationFixtures,
} from "./testUtils/fixtures";

function candidate(reviewStatus: BuyerCandidate["reviewStatus"] = "pending", discoveryStatus: BuyerCandidate["discoveryStatus"] = "ready"): BuyerCandidate {
  return { id: BI_FIXTURE_CANDIDATE_ID, companyName: "Fixture Imports", country: "AE", reviewStatus, discoveryStatus };
}
function publicEmail(): BuyerCandidatePublicEmail {
  return { id: "70000000-0000-4000-8000-000000000001", candidateId: BI_FIXTURE_CANDIDATE_ID,
    email: "imports@example.test", mailboxType: "imports", mailboxKind: "corporate",
    source: "company_website", sourceUrl: "https://example.test/contact", isPrimary: true };
}

describe("BI2 controlled scenarios", () => {
  it("A: keeps an empty Candidate conservative", () => {
    const result = calculateDerivedBuyerIntelligence({ sources: [], claims: [], observations: [],
      contactAccess: { contacts: [], publicEmails: [] },
      readiness: { candidate: candidate(), contacts: [], publicEmails: [] },
      asOf: new Date("2026-09-02T00:00:00Z") });
    expect(result.assessments.map((row) => [row.assessmentType, row.classification])).toEqual([
      ["buyer_legitimacy", "no_evidence_found"], ["buyer_potential", "insufficient_evidence"],
      ["contact_access", "company_only"], ["outreach_readiness", "needs_review"],
    ]);
  });

  it("B/C/F: separates one provider, two providers, and directory-only evidence", () => {
    const one = calculateDerivedBuyerIntelligence({ sources: buyerIntelligenceSourceFixtures,
      claims: [buyerIntelligenceClaimFixtures[0]], observations: [], contactAccess: { contacts: [], publicEmails: [] },
      readiness: { candidate: candidate(), contacts: [], publicEmails: [] } });
    expect(one.assessments[0].classification).toBe("moderate_evidence");
    const second = { ...buyerIntelligenceClaimFixtures[0], id: "40000000-0000-4000-8000-000000000099", sourceId: buyerIntelligenceSourceFixtures[2].id };
    const two = calculateDerivedBuyerIntelligence({ sources: buyerIntelligenceSourceFixtures,
      claims: [buyerIntelligenceClaimFixtures[0], second], observations: [], contactAccess: { contacts: [], publicEmails: [] },
      readiness: { candidate: candidate(), contacts: [], publicEmails: [] } });
    expect(two.assessments[0].classification).toBe("strong_evidence");
    expect(two.assessments[0].evidence).toHaveLength(2);
    const directory = calculateDerivedBuyerIntelligence({ sources: buyerIntelligenceSourceFixtures,
      claims: [buyerIntelligenceClaimFixtures[1]], observations: [buyerTradeObservationFixtures[2]], contactAccess: { contacts: [], publicEmails: [] },
      readiness: { candidate: candidate(), contacts: [], publicEmails: [] } });
    expect(directory.assessments[0].classification).toBe("weak_signal");
    expect(directory.metrics.find((row) => row.metricKey === "shipment_count")?.value).toEqual({ type: "number", value: 0 });
  });

  it("D/E: calculates one India shipment as 100% and India plus Vietnam as 50%", () => {
    const one = calculateDerivedBuyerIntelligence({ sources: buyerIntelligenceSourceFixtures, claims: [],
      observations: [buyerTradeObservationFixtures[0]], contactAccess: { contacts: [], publicEmails: [] },
      readiness: { candidate: candidate(), contacts: [], publicEmails: [] }, asOf: new Date("2026-09-02T00:00:00Z") });
    expect(one.assessments[0].classification).toBe("verified");
    expect(one.metrics.find((row) => row.metricKey === "india_observation_share")?.value).toEqual({ type: "number", value: 1 });
    const two = calculateDerivedBuyerIntelligence({ sources: buyerIntelligenceSourceFixtures, claims: [],
      observations: buyerTradeObservationFixtures.slice(0, 2), contactAccess: { contacts: [], publicEmails: [] },
      readiness: { candidate: candidate(), contacts: [], publicEmails: [] }, asOf: new Date("2026-09-02T00:00:00Z") });
    expect(two.metrics.find((row) => row.metricKey === "india_observation_share")?.value).toEqual({ type: "number", value: 0.5 });
  });

  it("G: high potential cannot bypass the email requirement", () => {
    expect(calculateBuyerPotential([buyerTradeObservationFixtures[0]], { asOf: new Date("2026-09-02T00:00:00Z") }).classification).toBe("high");
    expect(calculateOutreachReadiness({ candidate: candidate("approved"), contacts: [], publicEmails: [] }).classification).toBe("needs_contact");
    expect(calculateOutreachReadiness({ candidate: candidate("approved"), contacts: [], publicEmails: [publicEmail()] }).classification).toBe("ready_for_conversion");
  });

  it("projects suppliers/products deterministically without creating truth records", () => {
    expect(projectSuppliers(buyerTradeObservationFixtures).map((row) => row.name)).toEqual(["Example Indian Exporter", "Example Vietnam Foods"]);
    const products = projectProducts(buyerTradeObservationFixtures);
    expect(products.find((row) => row.key === "mdf:guntur-dry-red-chilli")).toEqual(expect.objectContaining({ verifiedShipmentCount: 1 }));
  });
});
