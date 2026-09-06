import { describe, expect, it } from "vitest";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";
import type { Buyer } from "@/lib/types";
import { calculateOutreachReadiness } from "./readiness";
import { BI_FIXTURE_CANDIDATE_ID } from "./testUtils/fixtures";

const candidate: BuyerCandidate = { id: BI_FIXTURE_CANDIDATE_ID, companyName: "Fixture", country: "AE", discoveryStatus: "archived", reviewStatus: "approved" };
const conversion = { id: "80000000-0000-4000-8000-000000000001", candidateId: candidate.id, buyerId: "90000000-0000-4000-8000-000000000001", sourceKind: "public_company_email" as const, publicEmailId: "70000000-0000-4000-8000-000000000001", createdAt: "2026-09-01T00:00:00Z" };
const buyer: Buyer = { id: conversion.buyerId, firstName: "", lastName: "", company: "Fixture", email: "buyer@example.test", country: "AE", status: "new", createdAt: conversion.createdAt, updatedAt: conversion.createdAt, suppressed: false };
const approved: BuyerCandidate = { ...candidate, discoveryStatus: "ready" };
const contact = (overrides: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact => ({
  id: "60000000-0000-4000-8000-000000000001", candidateId: candidate.id,
  firstName: "Amina", lastName: "Khan", fullName: "Amina Khan", jobTitle: "Buyer",
  businessEmail: "amina@example.test", isPrimary: true, ...overrides,
});
const publicEmail: BuyerCandidatePublicEmail = {
  id: "70000000-0000-4000-8000-000000000001", candidateId: candidate.id,
  email: "imports@example.test", mailboxType: "imports", mailboxKind: "corporate",
  source: "company_website", sourceUrl: "https://example.test/contact", isPrimary: true,
};

describe("BI2 outreach readiness lifecycle", () => {
  it("treats conversion as authoritative even after BF5 archives the research record", () => {
    expect(calculateOutreachReadiness({ candidate, contacts: [], publicEmails: [], conversion, buyer }).classification).toBe("ready_for_outreach");
  });
  it("keeps suppression authoritative and never implies sending is enabled", () => {
    const result = calculateOutreachReadiness({ candidate, contacts: [], publicEmails: [], conversion, buyer: { ...buyer, suppressed: true } });
    expect(result.classification).toBe("suppressed");
    expect(result.summary).not.toMatch(/sent|send now/i);
  });
  it("marks an unconverted rejected or archived Candidate not eligible", () => {
    expect(calculateOutreachReadiness({ candidate, contacts: [], publicEmails: [] }).classification).toBe("not_eligible");
  });

  it("does not accept an ordinary contact email without revealed-personal proof", () => {
    expect(calculateOutreachReadiness({ candidate: approved, contacts: [contact()], publicEmails: [] }).classification).toBe("needs_contact");
  });

  it("does not accept a revealed contact whose email type is not personal", () => {
    expect(calculateOutreachReadiness({ candidate: approved, contacts: [contact({ revealedAt: "2026-09-02T00:00:00Z", emailType: "generic" })], publicEmails: [] }).classification).toBe("needs_contact");
  });

  it("accepts a revealed personal contact with a usable persisted email", () => {
    expect(calculateOutreachReadiness({ candidate: approved, contacts: [contact({ revealedAt: "2026-09-02T00:00:00Z", emailType: "personal" })], publicEmails: [] }).classification).toBe("ready_for_conversion");
  });

  it("accepts a persisted usable public company email", () => {
    expect(calculateOutreachReadiness({ candidate: approved, contacts: [], publicEmails: [publicEmail] }).classification).toBe("ready_for_conversion");
  });

  it("does not accept Candidate general email as a BF5B conversion source", () => {
    expect(calculateOutreachReadiness({ candidate: { ...approved, generalEmail: "general@example.test" }, contacts: [], publicEmails: [] }).classification).toBe("needs_contact");
  });
});
