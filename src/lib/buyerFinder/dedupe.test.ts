import { describe, it, expect } from "vitest";
import type { Buyer } from "@/lib/types";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidateRecord } from "./types";
import {
  emailDomain,
  findBuyerDuplicates,
  findCandidateDuplicates,
  isPublicEmailDomain,
  normalizeCompanyNameForCompare,
} from "./dedupe";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "cand-1",
    companyName: "ABC Foods Co., Ltd.",
    website: "https://www.abcfoods.co.th/",
    domain: "abcfoods.co.th",
    country: "Thailand",
    generalEmail: "purchasing@abcfoods.co.th",
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function contact(over: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact {
  return {
    id: "ctc-1",
    candidateId: "cand-1",
    firstName: "John",
    lastName: "Example",
    fullName: "John Example",
    jobTitle: "Procurement Manager",
    businessEmail: "john@abcfoods.co.th",
    isPrimary: true,
    ...over,
  };
}

function record(
  c: BuyerCandidate,
  contacts: BuyerCandidateContact[] = [],
): BuyerCandidateRecord {
  return { candidate: c, contacts, productMatches: [] };
}

function buyer(over: Partial<Buyer> & Pick<Buyer, "id">): Buyer {
  return {
    firstName: "Pat",
    lastName: "Buyer",
    company: "Other Co",
    email: "other@other.example",
    country: "Thailand",
    status: "new",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("isPublicEmailDomain", () => {
  it("recognizes common public mailbox providers", () => {
    expect(isPublicEmailDomain("gmail.com")).toBe(true);
    expect(isPublicEmailDomain("GOOGLEMAIL.COM")).toBe(true);
    expect(isPublicEmailDomain("outlook.com")).toBe(true);
    expect(isPublicEmailDomain("hotmail.com")).toBe(true);
    expect(isPublicEmailDomain("yahoo.co.in")).toBe(true);
    expect(isPublicEmailDomain("proton.me")).toBe(true);
    expect(isPublicEmailDomain("icloud.com")).toBe(true);
  });

  it("does not treat corporate domains as public mailboxes", () => {
    expect(isPublicEmailDomain("abcfoods.co.th")).toBe(false);
    expect(isPublicEmailDomain("mdfexports.com")).toBe(false);
    expect(isPublicEmailDomain("")).toBe(false);
    expect(isPublicEmailDomain(undefined)).toBe(false);
  });
});

describe("normalizeCompanyNameForCompare", () => {
  it("normalizes legal suffixes and punctuation to the same value", () => {
    expect(normalizeCompanyNameForCompare("ABC Foods Co., Ltd.")).toBe("abc foods");
    expect(normalizeCompanyNameForCompare("ABC FOODS COMPANY LIMITED")).toBe("abc foods");
    expect(normalizeCompanyNameForCompare("abc foods ltd")).toBe("abc foods");
    expect(normalizeCompanyNameForCompare("ABC Foods Inc.")).toBe("abc foods");
  });

  it("treats & as and and collapses whitespace", () => {
    expect(normalizeCompanyNameForCompare("  A  &  B   Foods  ")).toBe("a and b foods");
  });
});

describe("findBuyerDuplicates", () => {
  it("treats the same business email with different casing as an exact duplicate", () => {
    const result = findBuyerDuplicates({
      candidate: candidate(),
      contacts: [contact({ businessEmail: "John@ABCFoods.co.th" })],
      existingBuyers: [buyer({ id: "b1", email: "john@abcfoods.co.th", company: "ABC Foods" })],
    });
    expect(result.status).toBe("exact");
    expect(result.matches[0]?.confidence).toBe("exact");
    expect(result.matches[0]?.reasons.some((r) => r.type === "email")).toBe(true);
  });

  it("treats the same business email with surrounding whitespace as an exact duplicate", () => {
    const result = findBuyerDuplicates({
      candidate: candidate(),
      contacts: [contact({ businessEmail: "  john@abcfoods.co.th  " })],
      existingBuyers: [buyer({ id: "b1", email: "john@abcfoods.co.th" })],
    });
    expect(result.status).toBe("exact");
  });

  it("treats the same corporate domain as a strong duplicate", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({ domain: "abcfoods.co.th" }),
      contacts: [contact({ businessEmail: "new.person@abcfoods.co.th" })],
      existingBuyers: [
        buyer({
          id: "b1",
          email: "existing@abcfoods.co.th",
          company: "Different Trading",
          country: "UAE",
        }),
      ],
    });
    expect(result.status).toBe("high");
    expect(result.matches[0]?.reasons.some((r) => r.type === "domain" && r.value === "abcfoods.co.th")).toBe(
      true,
    );
  });

  it("does not treat Gmail-to-Gmail as a company duplicate", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({ domain: "gmail.com", website: undefined, generalEmail: undefined }),
      contacts: [contact({ businessEmail: "alice@gmail.com" })],
      existingBuyers: [buyer({ id: "b1", email: "bob@gmail.com", company: "Other", website: undefined })],
    });
    expect(result.status).toBe("none");
    expect(result.matches).toHaveLength(0);
  });

  it("does not treat Outlook-to-Outlook as a company duplicate", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({ domain: "outlook.com", website: undefined, generalEmail: undefined }),
      contacts: [contact({ businessEmail: "pat@outlook.com" })],
      existingBuyers: [buyer({ id: "b1", email: "sam@outlook.com", company: "Other", website: undefined })],
    });
    expect(result.status).toBe("none");
  });

  it("treats the same normalized company name + country as a high-confidence duplicate", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({
        companyName: "ABC Foods Co., Ltd.",
        country: "Thailand",
        domain: undefined,
        website: undefined,
        generalEmail: undefined,
      }),
      contacts: [contact({ businessEmail: "" })],
      existingBuyers: [
        buyer({
          id: "b1",
          company: "ABC FOODS COMPANY LIMITED",
          country: "Thailand",
          email: "someone@other-corp.example",
        }),
      ],
    });
    expect(result.status).toBe("high");
    expect(result.matches[0]?.reasons.some((r) => r.type === "company_name_country")).toBe(true);
  });

  it("lowers confidence when the company name matches but the country does not", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({
        companyName: "ABC Foods Ltd",
        country: "Thailand",
        domain: undefined,
        website: undefined,
        generalEmail: undefined,
      }),
      contacts: [contact({ businessEmail: "" })],
      existingBuyers: [
        buyer({
          id: "b1",
          company: "ABC Foods",
          country: "UAE",
          email: "uae@other-corp.example",
        }),
      ],
    });
    expect(result.status).toBe("possible");
    expect(result.matches[0]?.reasons.some((r) => r.type === "company_name")).toBe(true);
    expect(result.matches[0]?.reasons.some((r) => r.type === "company_name_country")).toBe(false);
  });

  it("returns none when company, domain, and email all differ", () => {
    const result = findBuyerDuplicates({
      candidate: candidate(),
      contacts: [contact()],
      existingBuyers: [
        buyer({
          id: "b1",
          company: "Zenith Spices",
          email: "hello@zenith-spices.example",
          website: "https://zenith-spices.example",
          country: "India",
        }),
      ],
    });
    expect(result.status).toBe("none");
    expect(result.matches).toHaveLength(0);
  });

  it("detects a secondary contact email that matches an existing Buyer", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({ generalEmail: undefined }),
      contacts: [
        contact({ businessEmail: "new@abcfoods.co.th", isPrimary: true }),
        contact({
          id: "ctc-2",
          businessEmail: "legacy@abcfoods.co.th",
          isPrimary: false,
        }),
      ],
      existingBuyers: [buyer({ id: "b1", email: "legacy@abcfoods.co.th", company: "Legacy" })],
    });
    expect(result.status).toBe("exact");
    expect(result.matches[0]?.reasons.some((r) => r.value === "legacy@abcfoods.co.th")).toBe(true);
  });

  it("detects a general company email that matches an existing Buyer", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({ generalEmail: "purchasing@abcfoods.co.th" }),
      contacts: [contact({ businessEmail: "someone-new@abcfoods.co.th" })],
      existingBuyers: [
        buyer({
          id: "b1",
          email: "purchasing@abcfoods.co.th",
          company: "Purchasing Desk",
        }),
      ],
    });
    expect(result.status).toBe("exact");
  });

  it("normalizes URL variations to the same corporate domain", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({
        website: "https://www.abcfoods.co.th/about",
        domain: undefined,
        generalEmail: undefined,
      }),
      contacts: [contact({ businessEmail: "" })],
      existingBuyers: [
        buyer({
          id: "b1",
          email: "office@unrelated.example",
          website: "http://abcfoods.co.th",
          company: "Unrelated Name",
          country: "India",
        }),
      ],
    });
    expect(result.status).toBe("high");
    expect(result.matches[0]?.reasons.some((r) => r.type === "domain" && r.value === "abcfoods.co.th")).toBe(
      true,
    );
  });

  it("never treats empty or null emails/domains as duplicates", () => {
    const result = findBuyerDuplicates({
      candidate: candidate({
        domain: "",
        website: "",
        generalEmail: "   ",
        companyName: "Unique Name XYZ",
        country: "Thailand",
      }),
      contacts: [contact({ businessEmail: "" }), contact({ id: "c2", businessEmail: "   " })],
      existingBuyers: [
        buyer({ id: "b1", email: "", company: "Other Unique", website: "", country: "UAE" }),
        buyer({ id: "b2", email: "   ", company: "Third", country: "India" }),
      ],
    });
    expect(result.status).toBe("none");
  });

  it("fails safely on malformed values without throwing", () => {
    expect(() =>
      findBuyerDuplicates({
        candidate: candidate({
          domain: "::::",
          website: "not a url",
          generalEmail: "@@@",
          companyName: "",
        }),
        contacts: [contact({ businessEmail: "not-an-email" }), contact({ id: "c2", businessEmail: "@" })],
        existingBuyers: [
          buyer({ id: "b1", email: "also-bad", website: "javascript:alert(1)", company: "" }),
        ],
      }),
    ).not.toThrow();
  });
});

describe("findCandidateDuplicates", () => {
  it("detects candidate-to-candidate same corporate domain", () => {
    const a = record(candidate({ id: "a", domain: "abcfoods.co.th", generalEmail: undefined }), [
      contact({ businessEmail: "one@abcfoods.co.th" }),
    ]);
    const b = record(
      candidate({
        id: "b",
        companyName: "Different Label",
        country: "UAE",
        domain: "abcfoods.co.th",
        website: undefined,
        generalEmail: undefined,
      }),
      [contact({ candidateId: "b", businessEmail: "two@abcfoods.co.th" })],
    );
    const result = findCandidateDuplicates(a, [a, b]);
    expect(result.status).toBe("high");
    expect(result.matches[0]?.candidateId).toBe("b");
    expect(result.matches[0]?.reasons.some((r) => r.type === "domain")).toBe(true);
  });

  it("detects candidate-to-candidate same email", () => {
    const a = record(candidate({ id: "a", domain: undefined, website: undefined, generalEmail: undefined }), [
      contact({ businessEmail: "shared@corp.example" }),
    ]);
    const b = record(
      candidate({
        id: "b",
        companyName: "Other Co",
        country: "India",
        domain: undefined,
        website: undefined,
        generalEmail: undefined,
      }),
      [contact({ candidateId: "b", businessEmail: "  SHARED@corp.example " })],
    );
    const result = findCandidateDuplicates(a, [b]);
    expect(result.status).toBe("exact");
    expect(result.matches[0]?.reasons.some((r) => r.type === "email")).toBe(true);
  });

  it("does not report a candidate as a duplicate of itself", () => {
    const a = record(candidate({ id: "a" }), [contact()]);
    const result = findCandidateDuplicates(a, [a]);
    expect(result.status).toBe("none");
  });
});

describe("emailDomain", () => {
  it("extracts a host and ignores blanks", () => {
    expect(emailDomain("John@ABCFoods.co.th")).toBe("abcfoods.co.th");
    expect(emailDomain("")).toBeUndefined();
    expect(emailDomain("no-at-sign")).toBeUndefined();
  });
});
