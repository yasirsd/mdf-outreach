import { describe, expect, it } from "vitest";
import { assessRevealPriority, revealPriorityTierForTitle } from "./revealPriority";
import { scoreContactRole } from "./scoring";
import type { BuyerCandidate, BuyerCandidateContact } from "./types";

const CANDIDATE: BuyerCandidate = {
  id: "00000000-0000-4000-8000-0000000000aa",
  companyName: "ABC Foods",
  country: "United Arab Emirates",
  source: "hunter",
  companyScore: 40,
  discoveryStatus: "ready",
  reviewStatus: "pending",
};

function contact(title: string, id = "00000000-0000-4000-8000-0000000000c1"): BuyerCandidateContact {
  return {
    id,
    candidateId: CANDIDATE.id,
    firstName: "A",
    lastName: "B",
    fullName: "A B",
    jobTitle: title,
    businessEmail: "",
    emailType: "personal",
    isPrimary: true,
  };
}

describe("revealPriorityTierForTitle", () => {
  it("maps procurement / import titles to HIGH using existing role scoring", () => {
    expect(revealPriorityTierForTitle("Head of Procurement")).toBe("high");
    expect(revealPriorityTierForTitle("Procurement Manager")).toBe("high");
    expect(revealPriorityTierForTitle("Import Manager")).toBe("high");
  });

  it("maps agri / commodity commercial leadership to HIGH without changing scoreContactRole", () => {
    expect(revealPriorityTierForTitle("Director of Agricultural Commodities")).toBe("high");
    expect(revealPriorityTierForTitle("Head of Agricultural Commodities")).toBe("high");
    expect(revealPriorityTierForTitle("Agricultural Commodities Director")).toBe("high");
    expect(revealPriorityTierForTitle("Commodity Director")).toBe("high");
    expect(revealPriorityTierForTitle("Commodity Manager")).toBe("high");
    expect(revealPriorityTierForTitle("Head of Commodities")).toBe("high");
    expect(revealPriorityTierForTitle("Commodity Trader")).toBe("high");
    expect(revealPriorityTierForTitle("Agricultural Trader")).toBe("high");
    expect(revealPriorityTierForTitle("Agri Commodities")).toBe("high");
    expect(revealPriorityTierForTitle("Head of Trading")).toBe("high");
    expect(revealPriorityTierForTitle("Trading Manager")).toBe("high");
    expect(scoreContactRole("Director of Agricultural Commodities").tier).toBe(3);
    expect(scoreContactRole("Director of Agricultural Commodities").matched).toBe("director");
  });

  it("does not treat unrelated commodity-like or generic director titles as HIGH", () => {
    expect(revealPriorityTierForTitle("Director")).toBe("medium");
    expect(revealPriorityTierForTitle("Managing Director")).toBe("medium");
    expect(revealPriorityTierForTitle("Sales Director")).toBe("low");
    expect(revealPriorityTierForTitle("Accountant")).toBe("low");
    expect(revealPriorityTierForTitle("Commodity Software Engineer")).toBe("low");
  });

  it("maps supply-chain and managing director to MEDIUM", () => {
    expect(revealPriorityTierForTitle("Supply Chain Manager")).toBe("medium");
    expect(revealPriorityTierForTitle("Managing Director")).toBe("medium");
  });

  it("maps owner / founder / CEO / director to MEDIUM", () => {
    expect(revealPriorityTierForTitle("Owner")).toBe("medium");
    expect(revealPriorityTierForTitle("Founder")).toBe("medium");
    expect(revealPriorityTierForTitle("CEO")).toBe("medium");
    expect(revealPriorityTierForTitle("Director")).toBe("medium");
  });

  it("maps sales and HR to LOW", () => {
    expect(revealPriorityTierForTitle("Sales Executive")).toBe("low");
    expect(revealPriorityTierForTitle("HR Manager")).toBe("low");
  });
});

describe("assessRevealPriority", () => {
  it("returns NONE when no person is available", () => {
    expect(assessRevealPriority({ candidate: CANDIDATE, contacts: [] }).tier).toBe("none");
  });

  it("keeps a strong person even when a free company mailbox exists", () => {
    const result = assessRevealPriority({
      candidate: CANDIDATE,
      contacts: [contact("Head of Procurement")],
      publicEmails: [
        {
          id: "00000000-0000-4000-8000-0000000000e1",
          candidateId: CANDIDATE.id,
          email: "sales@abc.com",
          mailboxType: "sales",
          mailboxKind: "corporate",
          source: "company_website",
          sourceUrl: "https://abc.com/contact",
          isPrimary: true,
        },
      ],
    });
    expect(result.tier).toBe("high");
    expect(result.bestPerson?.jobTitle).toBe("Head of Procurement");
    expect(result.publicCompanyEmail).toBe("sales@abc.com");
  });

  it("ranks Director of Agricultural Commodities as HIGH reveal priority", () => {
    const result = assessRevealPriority({
      candidate: CANDIDATE,
      contacts: [contact("Director of Agricultural Commodities")],
    });
    expect(result.tier).toBe("high");
    expect(result.bestPerson?.jobTitle).toBe("Director of Agricultural Commodities");
  });
});
