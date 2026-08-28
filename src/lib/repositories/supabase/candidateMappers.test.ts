import { describe, it, expect } from "vitest";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
} from "@/lib/buyerFinder/types";
import {
  candidateFromRow,
  candidateToPatchRow,
  candidateToRow,
  contactFromRow,
  contactToPatchRow,
  contactToRow,
  evidenceFromJson,
  productMatchFromRow,
  productMatchToPatchRow,
  productMatchToRow,
  type BuyerCandidateContactRow,
  type BuyerCandidateProductMatchRow,
  type BuyerCandidateRow,
} from "./candidateMappers";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000aa";
const CONTACT_ID = "00000000-0000-0000-0000-0000000000bb";
const MATCH_ID = "00000000-0000-0000-0000-0000000000cc";

describe("candidate mapper", () => {
  it("round-trips company fields and pins workspace_id from the server", () => {
    const candidate: BuyerCandidate = {
      id: CANDIDATE_ID,
      companyName: "ABC Foods Thailand",
      website: "https://abcfoods.example",
      domain: "abcfoods.example",
      country: "Thailand",
      city: "Bangkok",
      industry: "Food ingredients",
      buyerType: "Importer",
      companyLinkedinUrl: "https://www.linkedin.com/company/abc-foods-example",
      companyScore: 91,
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "mock",
      evidence: [{ note: "Spice importer", confidence: 90, url: "https://abcfoods.example" }],
    };
    const row = {
      ...candidateToRow(candidate, WORKSPACE),
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    } as BuyerCandidateRow;
    expect(row.workspace_id).toBe(WORKSPACE);
    expect(row.domain).toBe("abcfoods.example");
    expect(row.buyer_score).toBe(91);
    const back = candidateFromRow(row);
    expect(back.companyName).toBe("ABC Foods Thailand");
    expect(back.companyScore).toBe(91);
    expect(back.evidence?.[0]?.note).toBe("Spice importer");
    expect(back.source).toBe("mock");
  });

  it("round-trips source=hunter without coercing it to mock", () => {
    const candidate: BuyerCandidate = {
      id: CANDIDATE_ID,
      companyName: "Mahmood & Sons",
      website: "https://mahmoodsons.com",
      domain: "mahmoodsons.com",
      country: "United Arab Emirates",
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "hunter",
    };
    const row = {
      ...candidateToRow(candidate, WORKSPACE),
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    } as BuyerCandidateRow;
    expect(row.source).toBe("hunter");
    expect(candidateFromRow(row).source).toBe("hunter");
  });


  it("normalizes empty domain to null so it cannot occupy the unique index", () => {
    const row = candidateToRow(
      {
        id: CANDIDATE_ID,
        companyName: "No Domain Co",
        country: "Thailand",
        domain: "   ",
        discoveryStatus: "new",
        reviewStatus: "pending",
      },
      WORKSPACE,
    );
    expect(row.domain).toBeNull();
  });

  it("derives domain from website when domain is omitted", () => {
    const row = candidateToRow(
      {
        id: CANDIDATE_ID,
        companyName: "Web Only",
        country: "Thailand",
        website: "https://WWW.Example.COM/about",
        discoveryStatus: "new",
        reviewStatus: "pending",
      },
      WORKSPACE,
    );
    expect(row.domain).toBe("example.com");
  });

  it("rejects out-of-range buyer_score", () => {
    expect(() =>
      candidateToRow(
        {
          id: CANDIDATE_ID,
          companyName: "Bad Score",
          country: "Thailand",
          companyScore: 500,
          discoveryStatus: "new",
          reviewStatus: "pending",
        },
        WORKSPACE,
      ),
    ).toThrow(/buyer_score/);
  });
});

describe("candidateToPatchRow (partial-update safety)", () => {
  it("emits only the fields present in the patch", () => {
    const patch = candidateToPatchRow({ reviewStatus: "rejected" });
    expect(patch).toEqual({ review_status: "rejected" });
  });

  it("does not null scores when they are omitted", () => {
    const patch = candidateToPatchRow({ city: "Bangkok" });
    expect(patch).not.toHaveProperty("buyer_score");
    expect(patch).not.toHaveProperty("discovery_status");
    expect(patch.city).toBe("Bangkok");
  });
});

describe("contact mapper", () => {
  it("round-trips and lowercases email; empty email becomes null", () => {
    const contact: BuyerCandidateContact = {
      id: CONTACT_ID,
      candidateId: CANDIDATE_ID,
      firstName: "Somchai",
      lastName: "Example",
      fullName: "Somchai Example",
      jobTitle: "Procurement Manager",
      businessEmail: "Somchai@ABCFoods.example",
      emailStatus: "valid",
      emailConfidence: 96,
      isPrimary: true,
      contactScore: 95,
      source: "mock",
    };
    const row = {
      ...contactToRow(contact, WORKSPACE),
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    } as BuyerCandidateContactRow;
    expect(row.workspace_id).toBe(WORKSPACE);
    expect(row.business_email).toBe("somchai@abcfoods.example");
    const back = contactFromRow(row);
    expect(back.businessEmail).toBe("somchai@abcfoods.example");
    expect(back.isPrimary).toBe(true);

    const empty = contactToRow(
      { ...contact, businessEmail: "  " },
      WORKSPACE,
    );
    expect(empty.business_email).toBeNull();
  });

  it("rejects out-of-range contact_score", () => {
    expect(() =>
      contactToRow(
        {
          id: CONTACT_ID,
          candidateId: CANDIDATE_ID,
          firstName: "A",
          lastName: "B",
          fullName: "A B",
          jobTitle: "Buyer",
          businessEmail: "a@example.com",
          isPrimary: false,
          contactScore: -20,
        },
        WORKSPACE,
      ),
    ).toThrow(/contact_score/);
  });
});

describe("contactToPatchRow (partial-update safety)", () => {
  it("emits only is_primary when that is the patch", () => {
    expect(contactToPatchRow({ isPrimary: true })).toEqual({ is_primary: true });
  });

  it("does not wipe email_status when omitted", () => {
    const patch = contactToPatchRow({ jobTitle: "Import Manager" });
    expect(patch).toEqual({ job_title: "Import Manager" });
  });
});

describe("product-match mapper", () => {
  it("round-trips a valid MDF ProductKey", () => {
    const match: BuyerCandidateProductMatch = {
      id: MATCH_ID,
      candidateId: CANDIDATE_ID,
      productId: "guntur-dry-red-chilli",
      relevance: 94,
      evidence: [{ note: "Chilli in catalogue", confidence: 90 }],
      source: "mock",
    };
    const row = {
      ...productMatchToRow(match, WORKSPACE),
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    } as BuyerCandidateProductMatchRow;
    expect(row.workspace_id).toBe(WORKSPACE);
    expect(row.product_key).toBe("guntur-dry-red-chilli");
    const back = productMatchFromRow(row);
    expect(back.productId).toBe("guntur-dry-red-chilli");
    expect(back.relevance).toBe(94);
  });

  it("rejects a product key that is not in the existing MDF catalogue", () => {
    expect(() =>
      productMatchToRow(
        {
          id: MATCH_ID,
          candidateId: CANDIDATE_ID,
          productId: "not-a-real-product" as BuyerCandidateProductMatch["productId"],
          evidence: [],
        },
        WORKSPACE,
      ),
    ).toThrow(/Invalid MDF business product id/);
  });
});

describe("productMatchToPatchRow (partial-update safety)", () => {
  it("emits only relevance when that is the patch", () => {
    expect(productMatchToPatchRow({ relevance: 70 })).toEqual({ relevance: 70 });
  });

  it("does not emit product_key when omitted", () => {
    const patch = productMatchToPatchRow({ country: "Thailand" });
    expect(patch).toEqual({ country: "Thailand" });
    expect(patch).not.toHaveProperty("product_key");
    expect(patch).not.toHaveProperty("relevance");
  });
});

describe("evidence JSON sanitizer", () => {
  it("drops non-objects, HTML-like bulk, and unknown keys", () => {
    const cleaned = evidenceFromJson([
      { note: "ok", confidence: 80, url: "https://example.com", extra: "<html>nope</html>" },
      { note: "" },
      "string",
      { note: "  keep  ", confidence: 150 },
    ]);
    expect(cleaned).toEqual([
      { note: "ok", confidence: 80, url: "https://example.com" },
      { note: "keep", confidence: 100 },
    ]);
  });
});
