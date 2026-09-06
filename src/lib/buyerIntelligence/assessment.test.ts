import { describe, expect, it } from "vitest";
import { calculateBasicLegitimacy, classifyContactAccess } from "./assessment";
import {
  buyerIntelligenceClaimFixtures,
  buyerIntelligenceSourceFixtures,
  buyerTradeObservationFixtures,
  controlledLegitimacy,
} from "./testUtils/fixtures";
import type { BuyerCandidateContact, BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";

function contact(overrides: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact {
  return {
    id: "60000000-0000-4000-8000-000000000001",
    candidateId: "20000000-0000-4000-8000-000000000001",
    firstName: "Amina",
    lastName: "Khan",
    fullName: "Amina Khan",
    jobTitle: "Head of Procurement",
    businessEmail: "",
    isPrimary: true,
    ...overrides,
  };
}

function publicEmail(): BuyerCandidatePublicEmail {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    candidateId: "20000000-0000-4000-8000-000000000001",
    email: "imports@example.test",
    mailboxType: "imports",
    mailboxKind: "corporate",
    source: "company_website",
    sourceUrl: "https://example.test/contact",
    isPrimary: true,
  };
}

describe("BI1 deterministic assessments", () => {
  it("classifies controlled company-specific shipment evidence as verified and explains why", () => {
    expect(controlledLegitimacy.classification).toBe("verified");
    expect(controlledLegitimacy.summary).toMatch(/company-specific trade evidence/i);
    expect(controlledLegitimacy.components[0]).toEqual(
      expect.objectContaining({ key: "verified_trade", evidenceCount: 2 }),
    );
    expect(controlledLegitimacy.evidence).toHaveLength(2);
  });

  it("requires independent sources for strong business evidence", () => {
    const second = {
      ...buyerIntelligenceClaimFixtures[0],
      id: "40000000-0000-4000-8000-000000000099",
      sourceId: "30000000-0000-4000-8000-000000000099",
    };
    const result = calculateBasicLegitimacy({
      claims: [buyerIntelligenceClaimFixtures[0], second],
      observations: [],
    });
    expect(result.classification).toBe("strong_evidence");
    expect(result.components[0].explanation).toContain("2 independent");
  });

  it("does not count two source envelopes from the same provider as independent", () => {
    const second = {
      ...buyerIntelligenceClaimFixtures[0],
      id: "40000000-0000-4000-8000-000000000099",
      sourceId: buyerIntelligenceClaimFixtures[1].sourceId,
    };
    const sources = buyerIntelligenceSourceFixtures.slice(1).map((source) => ({
      ...source,
      providerId: "same-provider",
    }));
    const result = calculateBasicLegitimacy({
      claims: [buyerIntelligenceClaimFixtures[0], second],
      observations: [],
      sources,
    });
    expect(result.classification).toBe("moderate_evidence");
  });

  it("does not promote directory discovery into verified trade", () => {
    const result = calculateBasicLegitimacy({
      claims: [buyerIntelligenceClaimFixtures[1]],
      observations: [buyerTradeObservationFixtures[2]],
    });
    expect(result.classification).toBe("weak_signal");
    expect(result.summary).toMatch(/not verified/i);
  });

  it("keeps contact access separate from legitimacy and conversion", () => {
    expect(classifyContactAccess({ contacts: [], publicEmails: [] })).toBe("company_only");
    expect(classifyContactAccess({ contacts: [], publicEmails: [publicEmail()] })).toBe("public_route");
    expect(classifyContactAccess({ contacts: [contact()], publicEmails: [] })).toBe("named_contact");
    expect(
      classifyContactAccess({
        contacts: [contact({ businessEmail: "amina@example.test" })],
        publicEmails: [],
      }),
    ).toBe("direct_contact");
    expect(
      classifyContactAccess({
        contacts: [
          contact({
            businessEmail: "amina@example.test",
            source: "hunter",
            revealedAt: "2026-08-01T00:00:00.000Z",
            emailType: "personal",
          }),
        ],
        publicEmails: [],
      }),
    ).toBe("credit_enriched");
  });
});
