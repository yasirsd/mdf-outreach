import { describe, expect, it } from "vitest";
import type { Buyer } from "@/lib/types";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidatePublicEmail,
} from "./types";
import {
  BUYER_FINDER_BUYER_SOURCE,
  buildConversionPreview,
  conversionEligibility,
  convertCandidateToBuyer,
  defaultConversionSelection,
  findConversionDuplicate,
  listConversionOptions,
  mapConversionBuyer,
  mapPersonName,
  type CandidateConversion,
} from "./conversion";

const NOW = "2026-08-31T00:00:00.000Z";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    companyName: "Natureland",
    website: "https://natureland.net",
    domain: "natureland.net",
    country: "Kuwait",
    source: "hunter",
    discoveryStatus: "ready",
    reviewStatus: "approved",
    buyerType: "Importer",
    ...over,
  };
}

function ahmed(over: Partial<BuyerCandidateContact> = {}): BuyerCandidateContact {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    candidateId: "00000000-0000-4000-8000-0000000000aa",
    firstName: "Ahmed",
    lastName: "El Din",
    fullName: "Ahmed El Din",
    jobTitle: "Category Manager",
    businessEmail: "ahmed@natureland.net",
    isPrimary: true,
    contactScore: 18,
    source: "hunter",
    emailType: "personal",
    ...over,
  };
}

function chilli(): BuyerCandidateProductMatch {
  return {
    id: "00000000-0000-4000-8000-0000000000bb",
    candidateId: "00000000-0000-4000-8000-0000000000aa",
    productId: "guntur-dry-red-chilli",
    relevance: 50,
    evidence: [],
    source: "hunter",
  };
}

function ksons(): BuyerCandidate {
  return {
    id: "00000000-0000-4000-8000-0000000000cc",
    companyName: "KSONS Global",
    website: "https://ksonsglobal.com",
    domain: "ksonsglobal.com",
    country: "United Arab Emirates",
    source: "hunter",
    discoveryStatus: "ready",
    reviewStatus: "approved",
    buyerType: "Distributor",
  };
}

function chandan(): BuyerCandidateContact {
  return {
    id: "00000000-0000-4000-8000-0000000000c8",
    candidateId: "00000000-0000-4000-8000-0000000000cc",
    firstName: "",
    lastName: "",
    fullName: "Chandan G.",
    jobTitle: "Director of Agricultural Commodities",
    businessEmail: "",
    isPrimary: true,
    contactScore: 11,
    source: "hunter",
    emailType: "personal",
  };
}

function infoMail(): BuyerCandidatePublicEmail {
  return {
    id: "00000000-0000-4000-8000-0000000000e1",
    candidateId: "00000000-0000-4000-8000-0000000000cc",
    email: "info@ksonsglobal.com",
    mailboxType: "general",
    mailboxKind: "corporate",
    source: "company_website",
    sourceUrl: "https://ksonsglobal.com/contact",
    isPrimary: true,
  };
}

function existingBuyer(over: Partial<Buyer> & Pick<Buyer, "id" | "company" | "email">): Buyer {
  return {
    firstName: "",
    lastName: "",
    country: "Kuwait",
    status: "new",
    suppressed: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function approveOnly(row: BuyerCandidate): BuyerCandidate {
  return { ...row, reviewStatus: "approved" };
}

describe("BF5A conversion eligibility", () => {
  it("treats pending, rejected, archived, and already-converted as blocked", () => {
    expect(conversionEligibility({ candidate: candidate({ reviewStatus: "pending" }) })).toBe(
      "not_approved",
    );
    expect(conversionEligibility({ candidate: candidate({ reviewStatus: "rejected" }) })).toBe(
      "rejected",
    );
    expect(
      conversionEligibility({ candidate: candidate({ discoveryStatus: "archived" }) }),
    ).toBe("archived");
    expect(conversionEligibility({ candidate: undefined })).toBe("not_found");
    expect(
      conversionEligibility({
        candidate: candidate(),
        conversion: {
          id: "conv",
          candidateId: candidate().id,
          buyerId: "buyer",
          sourceKind: "company_only",
          createdAt: NOW,
        },
      }),
    ).toBe("already_converted");
    expect(conversionEligibility({ candidate: candidate({ reviewStatus: "approved" }) })).toBe("ok");
  });
});

describe("BF5A Approve ≠ Convert", () => {
  it("approval only changes review state — zero buyers and zero conversions", () => {
    const pending = candidate({ reviewStatus: "pending" });
    const buyers: Buyer[] = [];
    const conversions = new Map<string, CandidateConversion>();
    const approved = approveOnly(pending);
    expect(approved.reviewStatus).toBe("approved");
    expect(buyers).toHaveLength(0);
    expect(conversions.size).toBe(0);
    expect(conversionEligibility({ candidate: approved })).toBe("ok");
  });
});

describe("BF5A Natureland mapping", () => {
  it("maps revealed Ahmed El Din from structured names and canonical product, not search intent", () => {
    const row = candidate();
    const preview = buildConversionPreview({
      candidate: row,
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [chilli()],
      existingBuyers: [],
    });
    expect(preview.eligibility).toBe("ok");
    expect(preview.sourceKind).toBe("revealed_personal_contact");
    expect(preview.mapping.company).toBe("Natureland");
    expect(preview.mapping.country).toBe("Kuwait");
    expect(preview.mapping.website).toBe("https://natureland.net");
    expect(preview.mapping.email).toBe("ahmed@natureland.net");
    expect(preview.mapping.firstName).toBe("Ahmed");
    expect(preview.mapping.lastName).toBe("El Din");
    expect(preview.mapping.productInterest).toBe("Guntur Dry Red Chilli");
    expect(preview.mapping.source).toBe(BUYER_FINDER_BUYER_SOURCE);
    expect(preview.mapping.source).toBe("Buyer Finder");
    expect(preview.mapping.buyerType).toBeUndefined();
    expect(preview.mapping.notes).toBeUndefined();
    expect(preview.duplicate).toBe("none");
    expect(preview.createBlocked).toBe(false);
    expect("buyerType" in preview.mapping && preview.mapping.buyerType).toBeFalsy();
  });

  it("does not parse fullName when structured first/last are empty", () => {
    const names = mapPersonName(ahmed({ firstName: "", lastName: "", fullName: "Ahmed El Din" }));
    expect(names).toEqual({ firstName: "", lastName: "" });
    expect(names.firstName).not.toBe("Ahmed El");
  });
});

describe("BF5A public email mapping", () => {
  it("selects company email and keeps masked people unselectable without fabricating a name", () => {
    const options = listConversionOptions({
      contacts: [chandan()],
      publicEmails: [infoMail()],
    });
    const masked = options.find((o) => o.kind === "masked_person");
    const pub = options.find((o) => o.kind === "public_company_email");
    expect(masked?.selectable).toBe(false);
    expect(masked && "reason" in masked ? masked.reason : "").toBe("Personal email not revealed");
    expect(pub?.selectable).toBe(true);
    expect(defaultConversionSelection(options)).toEqual({
      kind: "public_company_email",
      publicEmailId: infoMail().id,
    });
    const mapping = mapConversionBuyer({
      candidate: ksons(),
      contacts: [chandan()],
      publicEmails: [infoMail()],
      productMatches: [],
      selection: { kind: "public_company_email", publicEmailId: infoMail().id },
    });
    expect(mapping?.email).toBe("info@ksonsglobal.com");
    expect(mapping?.firstName).toBe("");
    expect(mapping?.lastName).toBe("");
    expect(mapping?.company).toBe("KSONS Global");
    expect(mapping?.buyerType).toBeUndefined();
  });
});

describe("BF5A company-only mapping", () => {
  it("allows company-only with a missing-email warning and no fabricated contact", () => {
    const preview = buildConversionPreview({
      candidate: candidate({ companyName: "Empty Co" }),
      contacts: [ahmed({ businessEmail: "", firstName: "", lastName: "", fullName: "A. B." })],
      publicEmails: [],
      productMatches: [chilli()],
      existingBuyers: [],
    });
    expect(preview.sourceKind).toBe("company_only");
    expect(preview.missingEmail).toBe(true);
    expect(preview.mapping.email).toBe("");
    expect(preview.mapping.firstName).toBe("");
    expect(preview.mapping.lastName).toBe("");
    expect(preview.mapping.productInterest).toBe("Guntur Dry Red Chilli");
    expect(preview.createBlocked).toBe(false);
  });
});

describe("BF5A duplicate detection", () => {
  it("blocks an exact normalized email as a definite duplicate", () => {
    const mapping = mapConversionBuyer({
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      selection: { kind: "revealed_personal_contact", contactId: ahmed().id },
    })!;
    const match = findConversionDuplicate({
      mapping,
      candidate: candidate(),
      existingBuyers: [
        existingBuyer({
          id: "buyer-1",
          company: "Other",
          email: "  AHMED@natureland.net ",
        }),
      ],
    });
    expect(match?.class).toBe("definite");
    expect(match?.reason).toBe("email");
  });

  it("matches https://www.natureland.net/ to natureland.net and not notnatureland.net", () => {
    const mapping = mapConversionBuyer({
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      selection: { kind: "revealed_personal_contact", contactId: ahmed().id },
    })!;
    const www = findConversionDuplicate({
      mapping,
      candidate: candidate(),
      existingBuyers: [
        existingBuyer({
          id: "buyer-2",
          company: "Natureland Trading",
          email: "info@other.com",
          website: "https://www.natureland.net/",
        }),
      ],
    });
    expect(www?.class).toBe("definite");
    expect(www?.reason).toBe("domain");
    const near = findConversionDuplicate({
      mapping,
      candidate: candidate(),
      existingBuyers: [
        existingBuyer({
          id: "buyer-3",
          company: "Not Natureland",
          email: "hello@notnatureland.net",
          website: "https://notnatureland.net",
        }),
      ],
    });
    expect(near).toBeUndefined();
  });

  it("treats trimmed case-insensitive company name as a possible duplicate and blocks", () => {
    const mapping = mapConversionBuyer({
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      selection: { kind: "revealed_personal_contact", contactId: ahmed().id },
    })!;
    const preview = buildConversionPreview({
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [chilli()],
      existingBuyers: [
        existingBuyer({
          id: "buyer-4",
          company: " Natureland ",
          email: "other@example.com",
        }),
      ],
    });
    expect(preview.duplicate).toBe("possible");
    expect(preview.duplicateMatch?.reason).toBe("company_name");
    expect(preview.createBlocked).toBe(true);
    expect(
      findConversionDuplicate({
        mapping,
        candidate: candidate(),
        existingBuyers: [
          existingBuyer({ id: "buyer-4", company: " Natureland ", email: "other@example.com" }),
        ],
      })?.class,
    ).toBe("possible");
  });
});

describe("BF5A convertCandidateToBuyer", () => {
  it("creates a normal new unsuppressed Buyer with Buyer Finder source and no outreach fields", async () => {
    const buyers: Buyer[] = [];
    const conversions = new Map<string, CandidateConversion>();
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-a",
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [chilli()],
      loadExistingBuyers: async () => buyers,
      loadConversion: async () => conversions.get(candidate().id),
      now: () => new Date(NOW),
      insertAtomic: async (buyer, conversion) => {
        buyers.push(buyer);
        conversions.set(conversion.candidateId, conversion);
      },
    });
    expect(result.outcome).toBe("created");
    expect(buyers).toHaveLength(1);
    expect(conversions.size).toBe(1);
    expect(buyers[0]?.status).toBe("new");
    expect(buyers[0]?.suppressed).toBe(false);
    expect(buyers[0]?.source).toBe("Buyer Finder");
    expect(buyers[0]?.buyerType).toBeUndefined();
    expect(buyers[0]?.notes).toBeUndefined();
    expect(buyers[0]?.productInterest).toBe("Guntur Dry Red Chilli");
    expect(buyers[0]?.email).toBe("ahmed@natureland.net");
    expect(buyers[0]?.firstName).toBe("Ahmed");
    expect(buyers[0]?.lastName).toBe("El Din");
  });

  it("blocks pending candidates and does not insert", async () => {
    const buyers: Buyer[] = [];
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-a",
      candidate: candidate({ reviewStatus: "pending" }),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      loadExistingBuyers: async () => buyers,
      loadConversion: async () => undefined,
      insertAtomic: async (buyer) => {
        buyers.push(buyer);
      },
    });
    expect(result.outcome).toBe("not_eligible");
    expect(buyers).toHaveLength(0);
  });

  it("rechecks duplicates at convert time and inserts nothing", async () => {
    const buyers = [
      existingBuyer({ id: "buyer-1", company: "Natureland", email: "ahmed@natureland.net" }),
    ];
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-a",
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      loadExistingBuyers: async () => buyers,
      loadConversion: async () => undefined,
      insertAtomic: async () => {
        throw new Error("must not insert");
      },
    });
    expect(result.outcome).toBe("duplicate");
    expect(result.duplicateMatch?.class).toBe("definite");
  });

  it("serializes two Create Buyer calls for the same candidate to one Buyer", async () => {
    const buyers: Buyer[] = [];
    const conversions = new Map<string, CandidateConversion>();
    const run = () =>
      convertCandidateToBuyer({
        workspaceKey: "ws-a",
        candidate: candidate(),
        contacts: [ahmed()],
        publicEmails: [],
        productMatches: [],
        loadExistingBuyers: async () => buyers,
        loadConversion: async () => conversions.get(candidate().id),
        insertAtomic: async (buyer, conversion) => {
          await new Promise((r) => setTimeout(r, 5));
          buyers.push(buyer);
          conversions.set(conversion.candidateId, conversion);
        },
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect([a.outcome, b.outcome].sort()).toEqual(["already_converted", "created"]);
    expect(buyers).toHaveLength(1);
    expect(conversions.size).toBe(1);
  });

  it("blocks a second candidate converting the same normalized email in the same workspace", async () => {
    const buyers: Buyer[] = [];
    const conversions = new Map<string, CandidateConversion>();
    const other = candidate({
      id: "00000000-0000-4000-8000-0000000000dd",
      companyName: "Natureland Copy",
    });
    const otherContact = ahmed({
      id: "00000000-0000-4000-8000-0000000000c9",
      candidateId: other.id,
    });
    const run = (row: BuyerCandidate, contact: BuyerCandidateContact) =>
      convertCandidateToBuyer({
        workspaceKey: "ws-a",
        candidate: row,
        contacts: [contact],
        publicEmails: [],
        productMatches: [],
        loadExistingBuyers: async () => buyers,
        loadConversion: async () => conversions.get(row.id),
        insertAtomic: async (buyer, conversion) => {
          buyers.push(buyer);
          conversions.set(conversion.candidateId, conversion);
        },
      });
    const [a, b] = await Promise.all([run(candidate(), ahmed()), run(other, otherContact)]);
    const created = [a, b].filter((r) => r.outcome === "created");
    const blocked = [a, b].filter((r) => r.outcome === "duplicate");
    expect(created).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(buyers).toHaveLength(1);
  });

  it("does not use another workspace's Buyers as duplicates", async () => {
    const foreign = [
      existingBuyer({ id: "buyer-x", company: "Natureland", email: "ahmed@natureland.net" }),
    ];
    const local: Buyer[] = [];
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-b",
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      loadExistingBuyers: async () => local,
      loadConversion: async () => undefined,
      insertAtomic: async (buyer) => {
        local.push(buyer);
      },
    });
    expect(result.outcome).toBe("created");
    expect(local).toHaveLength(1);
    expect(foreign).toHaveLength(1);
  });

  it("rejects a masked contact id as the conversion authority", async () => {
    const buyers: Buyer[] = [];
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-a",
      candidate: ksons(),
      contacts: [chandan()],
      publicEmails: [infoMail()],
      productMatches: [],
      requested: { kind: "revealed_personal_contact", contactId: chandan().id },
      loadExistingBuyers: async () => buyers,
      loadConversion: async () => undefined,
      insertAtomic: async (buyer) => {
        buyers.push(buyer);
      },
    });
    expect(result.outcome).toBe("invalid_selection");
    expect(buyers).toHaveLength(0);
  });
});
