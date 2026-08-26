import { describe, it, expect } from "vitest";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidateProductMatch } from "./types";
import {
  scoreBuyerCandidate,
  scoreContactRole,
  SCORE_MAX,
} from "./scoring";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "cand-1",
    companyName: "ABC Foods Thailand",
    website: "https://abcfoods.example",
    domain: "abcfoods.example",
    country: "Thailand",
    city: "Bangkok",
    industry: "Food ingredients",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: true,
    companyLinkedinUrl: "https://www.linkedin.com/company/abc-foods-example",
    source: "mock",
    evidence: [{ note: "Spice importer directory listing", confidence: 80 }],
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function contact(over: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact {
  return {
    id: "ctc-1",
    candidateId: "cand-1",
    firstName: "Somchai",
    lastName: "Example",
    fullName: "Somchai Example",
    jobTitle: "Procurement Manager",
    businessEmail: "somchai@abcfoods.example",
    emailStatus: "valid",
    emailConfidence: 96,
    linkedinUrl: "https://www.linkedin.com/in/somchai-example",
    contactScore: 95,
    isPrimary: true,
    source: "mock",
    ...over,
  };
}

function match(over: Partial<BuyerCandidateProductMatch> = {}): BuyerCandidateProductMatch {
  return {
    id: "match-1",
    candidateId: "cand-1",
    productKey: "guntur-chilli",
    relevance: 94,
    evidence: [{ note: "Chilli in catalogue", confidence: 90 }],
    source: "mock",
    ...over,
  };
}

function reasonCodes(result: ReturnType<typeof scoreBuyerCandidate>): string[] {
  return result.reasons.map((r) => r.code);
}

function pointsFor(result: ReturnType<typeof scoreBuyerCandidate>, code: string): number {
  return result.reasons.filter((r) => r.code === code).reduce((n, r) => n + r.points, 0);
}

describe("scoreContactRole", () => {
  it("scores Senior Procurement Manager as a high-priority role", () => {
    const role = scoreContactRole("Senior Procurement Manager");
    expect(role.tier).toBe(1);
    expect(role.points).toBe(12);
  });

  it("scores Procurement Manager higher than a generic role", () => {
    expect(scoreContactRole("Procurement Manager").points).toBeGreaterThan(
      scoreContactRole("Sales Associate").points,
    );
  });

  it("keeps Owner and Managing Director useful", () => {
    expect(scoreContactRole("Owner").points).toBeGreaterThan(0);
    expect(scoreContactRole("Managing Director").points).toBeGreaterThan(0);
    expect(scoreContactRole("Founder").tier).toBe(3);
    expect(scoreContactRole("Managing Director").tier).toBe(2);
  });

  it("is case-insensitive and ignores extra punctuation", () => {
    expect(scoreContactRole("PROCUREMENT MANAGER")).toEqual(scoreContactRole("procurement manager"));
    expect(scoreContactRole("Import-Manager").tier).toBe(1);
  });
});

describe("scoreBuyerCandidate", () => {
  it("gives a high score to a strong importer with high relevance, procurement contact, and valid email", () => {
    const result = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [match(), match({ id: "match-2", productKey: "banganapalli-mango", relevance: 67 })],
      targetProductKey: "guntur-chilli",
      targetCountry: "Thailand",
    });
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.total).toBeLessThanOrEqual(SCORE_MAX);
    expect(reasonCodes(result)).toContain("product-relevance");
    expect(reasonCodes(result)).toContain("importer");
    expect(reasonCodes(result)).toContain("contact-role");
    expect(reasonCodes(result)).toContain("email-status");
  });

  it("keeps a strong company relevant when there are no contacts, but with a lower score", () => {
    const withContacts = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [match()],
      targetProductKey: "guntur-chilli",
      targetCountry: "Thailand",
    });
    const without = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [],
      productMatches: [match()],
      targetProductKey: "guntur-chilli",
      targetCountry: "Thailand",
    });
    expect(without.contactQuality).toBe(0);
    expect(without.companyFit).toBe(withContacts.companyFit);
    expect(without.total).toBeGreaterThan(40);
    expect(without.total).toBeLessThan(withContacts.total);
  });

  it("scores a valid email higher than unverified, all else equal", () => {
    const valid = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact({ emailStatus: "valid" })],
      productMatches: [match()],
    });
    const unverified = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact({ emailStatus: "unverified" })],
      productMatches: [match()],
    });
    expect(valid.contactQuality).toBeGreaterThan(unverified.contactQuality);
    expect(valid.total).toBeGreaterThan(unverified.total);
  });

  it("scores accept-all below valid", () => {
    const valid = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact({ emailStatus: "valid" })],
      productMatches: [match()],
    });
    const acceptAll = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact({ emailStatus: "accept_all" })],
      productMatches: [match()],
    });
    expect(acceptAll.contactQuality).toBeLessThan(valid.contactQuality);
    expect(acceptAll.contactQuality).toBeGreaterThan(0);
  });

  it("gives no email-quality points for an invalid email, without zeroing the company", () => {
    const result = scoreBuyerCandidate({
      candidate: candidate({ isImporter: true }),
      contacts: [contact({ emailStatus: "invalid", emailConfidence: 90 })],
      productMatches: [match({ relevance: 90 })],
      targetCountry: "Thailand",
    });
    expect(pointsFor(result, "email-status")).toBe(0);
    expect(pointsFor(result, "email-confidence")).toBe(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.companyFit).toBeGreaterThan(0);
  });

  it("does not inflate contact quality just because there are more people", () => {
    const one = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [match()],
    });
    const many = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [
        contact(),
        contact({ id: "ctc-2", isPrimary: false, businessEmail: "two@abcfoods.example" }),
        contact({ id: "ctc-3", isPrimary: false, businessEmail: "three@abcfoods.example" }),
      ],
      productMatches: [match()],
    });
    expect(many.contactQuality).toBe(one.contactQuality);
  });

  it("uses the strongest (or targeted) product match and does not sum relevance above the cap", () => {
    const generic = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [
        match({ relevance: 90 }),
        match({ id: "m2", productKey: "pomegranate", relevance: 90 }),
        match({ id: "m3", productKey: "indian-apple", relevance: 90 }),
      ],
    });
    expect(pointsFor(generic, "product-relevance")).toBeLessThanOrEqual(22);
    expect(generic.reasons.filter((r) => r.code === "product-relevance")).toHaveLength(1);

    const chilli = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [
        match({ productKey: "guntur-chilli", relevance: 50 }),
        match({ id: "m2", productKey: "banganapalli-mango", relevance: 99 }),
      ],
      targetProductKey: "guntur-chilli",
    });
    const mango = scoreBuyerCandidate({
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [
        match({ productKey: "guntur-chilli", relevance: 50 }),
        match({ id: "m2", productKey: "banganapalli-mango", relevance: 99 }),
      ],
      targetProductKey: "banganapalli-mango",
    });
    expect(mango.companyFit).toBeGreaterThan(chilli.companyFit);
  });

  it("never exceeds 100 or goes below 0", () => {
    const strong = scoreBuyerCandidate({
      candidate: candidate({
        address: "1 Example Rd",
        phone: "+66 2 000 0000",
        generalEmail: "purchasing@abcfoods.example",
        evidence: [
          { note: "one", confidence: 90 },
          { note: "two", confidence: 85 },
        ],
      }),
      contacts: [contact({ contactScore: 100, emailConfidence: 100 })],
      productMatches: [
        match({ relevance: 100 }),
        match({ id: "m2", productKey: "pomegranate", relevance: 100 }),
      ],
      targetProductKey: "guntur-chilli",
      targetCountry: "Thailand",
    });
    expect(strong.total).toBeLessThanOrEqual(100);
    expect(strong.total).toBeGreaterThanOrEqual(0);
    expect(strong.companyFit).toBeLessThanOrEqual(45);
    expect(strong.contactQuality).toBeLessThanOrEqual(40);
    expect(strong.completeness).toBeLessThanOrEqual(15);

    const empty = scoreBuyerCandidate({
      candidate: {
        id: "empty",
        companyName: "X",
        country: "",
        discoveryStatus: "new",
        reviewStatus: "pending",
      },
      contacts: [],
      productMatches: [],
    });
    expect(empty.total).toBeGreaterThanOrEqual(0);
    expect(empty.total).toBeLessThanOrEqual(100);
  });

  it("returns the same result for the same input (deterministic)", () => {
    const input = {
      candidate: candidate(),
      contacts: [contact()],
      productMatches: [match()],
      targetProductKey: "guntur-chilli" as const,
      targetCountry: "Thailand",
    };
    expect(scoreBuyerCandidate(input)).toEqual(scoreBuyerCandidate(input));
  });

  it("has category breakdowns that sum to the total score", () => {
    const result = scoreBuyerCandidate({
      candidate: candidate({ address: "1 Rd", generalEmail: "info@abcfoods.example" }),
      contacts: [contact()],
      productMatches: [match(), match({ id: "m2", productKey: "pomegranate", relevance: 40 })],
      targetProductKey: "guntur-chilli",
      targetCountry: "Thailand",
    });
    expect(result.companyFit + result.contactQuality + result.completeness).toBe(result.total);
    const fromReasons = result.reasons.reduce((n, r) => n + r.points, 0);
    expect(fromReasons).toBe(result.total);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
