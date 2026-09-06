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
  buyerOpenHref,
  conversionEligibility,
  convertCandidateToBuyer,
  defaultConversionSelection,
  findConversionDuplicate,
  hasUsableEmailForConversion,
  listConversionOptions,
  mapConversionBuyer,
  mapPersonName,
  pickAuthoritativeProductMatchId,
  selectionFromBrowserInput,
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

function infoMail(over: Partial<BuyerCandidatePublicEmail> = {}): BuyerCandidatePublicEmail {
  return {
    id: "00000000-0000-4000-8000-0000000000e1",
    candidateId: "00000000-0000-4000-8000-0000000000cc",
    email: "info@ksonsglobal.com",
    mailboxType: "general",
    mailboxKind: "corporate",
    source: "company_website",
    sourceUrl: "https://ksonsglobal.com/contact",
    isPrimary: true,
    ...over,
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

describe("BF5B-final email-required conversion", () => {
  it("does not offer a company-only option and blocks Create when no usable email exists", () => {
    const preview = buildConversionPreview({
      candidate: candidate({ companyName: "Empty Co" }),
      contacts: [ahmed({ businessEmail: "", firstName: "", lastName: "", fullName: "A. B." })],
      publicEmails: [],
      productMatches: [chilli()],
      existingBuyers: [],
    });
    // No selectable option remains — the panel will render "Needs contact".
    expect(preview.options.some((o) => o.kind === "public_company_email")).toBe(false);
    expect(preview.options.some((o) => o.kind === "revealed_personal_contact")).toBe(false);
    // company_only is not in the option set at all.
    expect(preview.options.some((o) => (o as { kind: string }).kind === "company_only")).toBe(
      false,
    );
    expect(preview.missingEmail).toBe(true);
    expect(preview.createBlocked).toBe(true);
    // Candidate is still eligible; the block is on the selection, not the queue state.
    expect(preview.eligibility).toBe("ok");
  });

  it("does not offer malformed persisted personal or public email values", () => {
    const options = listConversionOptions({
      contacts: [ahmed({ businessEmail: "person@invalid" })],
      publicEmails: [infoMail({ email: "not-an-email" })],
    });
    expect(options.some((o) => o.kind === "revealed_personal_contact")).toBe(false);
    expect(options.some((o) => o.kind === "public_company_email")).toBe(false);
    expect(hasUsableEmailForConversion({
      contacts: [ahmed({ businessEmail: "person@invalid" })],
      publicEmails: [infoMail({ email: "not-an-email" })],
    })).toBe(false);
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

/**
 * BF5A.1 — the browser-side "authoritative product-match identity" the
 * server action hands to the Postgres RPC. The RPC then re-loads the row
 * for (id, candidate_id, workspace_id), reads product_key, and derives the
 * Buyer's product_interest through a whitelist that mirrors these ids.
 *
 * These tests cover the browser-side selector; the SQL-side rejection of
 * an unrecognized product_key (Case 3) and a mismatched id (Case 4) is
 * guarded by migration0018.test.ts.
 */
describe("pickAuthoritativeProductMatchId", () => {
  const CANDIDATE_ID = "00000000-0000-4000-8000-0000000000aa";
  const OTHER_CANDIDATE = "00000000-0000-4000-8000-00000000dead";

  function match(over: Partial<BuyerCandidateProductMatch>): BuyerCandidateProductMatch {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      candidateId: CANDIDATE_ID,
      productId: "guntur-dry-red-chilli",
      relevance: 10,
      evidence: [],
      source: "hunter",
      ...over,
    };
  }

  it("Case 1 — no matches: RPC receives no productMatchId; RPC leaves product_interest null", () => {
    expect(pickAuthoritativeProductMatchId([])).toBeUndefined();
  });

  it("Case 2 — a known persisted product: RPC receives that id and derives the canonical label", () => {
    const chilliMatch = match({ id: "id-chilli", productId: "guntur-dry-red-chilli", relevance: 50 });
    expect(pickAuthoritativeProductMatchId([chilliMatch])).toBe("id-chilli");
  });

  it("Case 3 — only unknown product_keys persisted: RPC receives no id, will not silently accept", () => {
    // The RPC's SQL whitelist would return unsupported_product for any of
    // these; the browser helper does not forward them.
    const unknownOnly = [
      match({ id: "id-x", productId: "not-in-catalogue", relevance: 90 }),
      match({ id: "id-y", productId: "another-unknown", relevance: 5 }),
    ];
    expect(pickAuthoritativeProductMatchId(unknownOnly)).toBeUndefined();
  });

  it("prefers a known product over a higher-relevance unknown one (never a fabricated label)", () => {
    const mixed = [
      match({ id: "id-unknown-hi", productId: "not-in-catalogue", relevance: 999 }),
      match({ id: "id-mango-lo", productId: "banganapalli-mango", relevance: 1 }),
    ];
    expect(pickAuthoritativeProductMatchId(mixed)).toBe("id-mango-lo");
  });

  it("Case 4 — id crafted against a different candidate: browser helper does not validate ownership; RPC's (id, candidate_id, workspace_id) SELECT is what blocks it", () => {
    // The browser helper picks by relevance among whitelisted matches; it
    // is intentionally naive. The Postgres RPC — guarded by
    // migration0018.test.ts — is the authority that rejects a mismatched id.
    const foreign = match({
      id: "id-foreign",
      candidateId: OTHER_CANDIDATE,
      productId: "guntur-dry-red-chilli",
      relevance: 100,
    });
    expect(pickAuthoritativeProductMatchId([foreign])).toBe("id-foreign");
  });
});

/**
 * BF5B-final — email is mandatory to create a Buyer. company_only is no
 * longer a valid selection, so the preview never legitimately reaches
 * `findConversionDuplicate` with an empty email. Case/whitespace-
 * insensitive non-empty duplicates still block; the historical empty-
 * email guard remains behaviourally intact for defence-in-depth.
 */
describe("BF5B-final duplicate detection", () => {
  it("blocks a non-empty email duplicate (case- and whitespace-insensitive)", () => {
    const mapping = {
      firstName: "Ahmed",
      lastName: "El Din",
      company: "Natureland",
      email: "ahmed@example.com",
      country: "Kuwait",
      source: BUYER_FINDER_BUYER_SOURCE,
    } as const;
    const match = findConversionDuplicate({
      mapping,
      candidate: candidate(),
      existingBuyers: [
        existingBuyer({ id: "buyer-9", company: "Other", email: "  AHMED@Example.com " }),
      ],
    });
    expect(match?.class).toBe("definite");
    expect(match?.reason).toBe("email");
  });

  it("still treats a stray empty-email caller as a duplicate against a pre-existing empty-email Buyer", () => {
    // Not a real call path any more — the panel does not send company-only
    // and the RPC rejects it — but the preview guard remains as a
    // defence-in-depth check against a stale caller.
    const mapping = {
      firstName: "",
      lastName: "",
      company: "Beta",
      email: "",
      country: "Kuwait",
      source: BUYER_FINDER_BUYER_SOURCE,
    } as const;
    const match = findConversionDuplicate({
      mapping,
      candidate: candidate({ companyName: "Beta", website: undefined, domain: undefined }),
      existingBuyers: [
        existingBuyer({ id: "buyer-empty", company: "Alpha", email: "", website: undefined }),
      ],
    });
    expect(match?.class).toBe("definite");
    expect(match?.reason).toBe("email");
  });
});

/**
 * BF5B — exact-buyer navigation. When the conversion linkage hands us a
 * real Buyer id, `buyerOpenHref` must produce `?buyerId=<uuid>` — the
 * Buyers page uses this to open the exact Buyer's drawer even when the
 * company name matches other rows. A stray display-only value (no id)
 * still falls back to the historical `?q=` search-style link.
 */
describe("BF5B buyerOpenHref exact navigation", () => {
  it("returns ?buyerId=<uuid> when a valid Buyer id is provided", () => {
    const href = buyerOpenHref({
      id: "12345678-1234-4234-8234-1234567890ab",
      email: "ahmed@natureland.net",
      company: "Natureland",
    });
    expect(href).toBe("/buyers?buyerId=12345678-1234-4234-8234-1234567890ab");
  });

  it("falls back to the ?q= search link when id is missing", () => {
    const href = buyerOpenHref({ email: "ahmed@natureland.net", company: "Natureland" });
    expect(href).toBe("/buyers?q=ahmed%40natureland.net");
  });

  it("falls back to the ?q= search link when id is not a valid uuid", () => {
    const href = buyerOpenHref({ id: "not-a-uuid", email: "", company: "Natureland" });
    expect(href).toBe("/buyers?q=Natureland");
  });
});

/**
 * BF5B-final — email-required eligibility (spec cases A–E).
 * The Postgres RPC in migration 0019 enforces the same shape at the DB
 * layer; the in-memory `convertCandidateToBuyer` here mirrors it.
 */
describe("BF5B-final email-required conversion — eligibility matrix", () => {
  it("A: approved Candidate + public company email → eligible for conversion", async () => {
    const buyers: Buyer[] = [];
    const conversions = new Map<string, CandidateConversion>();
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-a",
      candidate: ksons(),
      contacts: [chandan()],
      publicEmails: [infoMail()],
      productMatches: [],
      requested: { kind: "public_company_email", publicEmailId: infoMail().id },
      loadExistingBuyers: async () => buyers,
      loadConversion: async () => undefined,
      insertAtomic: async (buyer, conversion) => {
        buyers.push(buyer);
        conversions.set(conversion.candidateId, conversion);
      },
    });
    expect(result.outcome).toBe("created");
    expect(buyers).toHaveLength(1);
    expect(buyers[0]?.email).toBe("info@ksonsglobal.com");
  });

  it("B: approved Candidate + revealed personal email → eligible", async () => {
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
      insertAtomic: async (buyer, conversion) => {
        buyers.push(buyer);
        conversions.set(conversion.candidateId, conversion);
      },
    });
    expect(result.outcome).toBe("created");
    expect(buyers[0]?.email).toBe("ahmed@natureland.net");
  });

  it("C: approved Candidate + no email → preview blocks Create (no company_only fallback)", () => {
    const preview = buildConversionPreview({
      candidate: candidate({ companyName: "No Contact Co" }),
      // Only a masked (un-revealed) contact — no personal email; no
      // public company email.
      contacts: [
        ahmed({
          businessEmail: "",
          firstName: "",
          lastName: "",
          fullName: "Masked Person",
        }),
      ],
      publicEmails: [],
      productMatches: [chilli()],
      existingBuyers: [],
    });
    expect(preview.createBlocked).toBe(true);
    expect(preview.missingEmail).toBe(true);
    expect(preview.options.some((o) => (o as { kind: string }).kind === "company_only")).toBe(
      false,
    );
  });

  it("D: company_only requested directly at the domain layer → invalid_selection (no Buyer inserted)", async () => {
    const buyers: Buyer[] = [];
    const result = await convertCandidateToBuyer({
      workspaceKey: "ws-a",
      candidate: candidate(),
      contacts: [ahmed()],
      publicEmails: [],
      productMatches: [],
      // The type union still includes 'company_only' because linkage
      // rows written under 0018 may carry it, but the browser cannot
      // resolve this selection any more.
      requested: { kind: "company_only" },
      loadExistingBuyers: async () => buyers,
      loadConversion: async () => undefined,
      insertAtomic: async () => {
        throw new Error("must not insert");
      },
    });
    expect(result.outcome).toBe("invalid_selection");
    expect(buyers).toHaveLength(0);
  });

  it("E: with no email and no valid selection, the panel-facing preview reports Needs Contact", () => {
    expect(
      hasUsableEmailForConversion({
        contacts: [ahmed({ businessEmail: "" })],
        publicEmails: [],
      }),
    ).toBe(false);
    expect(
      hasUsableEmailForConversion({
        contacts: [ahmed()],
        publicEmails: [],
      }),
    ).toBe(true);
    expect(
      hasUsableEmailForConversion({
        contacts: [],
        publicEmails: [infoMail()],
      }),
    ).toBe(true);
  });

  it("selectionFromBrowserInput no longer accepts a companyOnly flag", () => {
    // Legit selections still resolve.
    expect(
      selectionFromBrowserInput({
        contactId: "00000000-0000-4000-8000-0000000000c1",
      }),
    ).toEqual({
      kind: "revealed_personal_contact",
      contactId: "00000000-0000-4000-8000-0000000000c1",
    });
    expect(
      selectionFromBrowserInput({
        publicEmailId: "00000000-0000-4000-8000-0000000000e1",
      }),
    ).toEqual({
      kind: "public_company_email",
      publicEmailId: "00000000-0000-4000-8000-0000000000e1",
    });
    // A caller with no fields returns undefined (nothing to do).
    expect(selectionFromBrowserInput({})).toBeUndefined();
    // A caller that sneaks companyOnly through (unknown property in the
    // narrower type) is a type error at the boundary; runtime ignores it.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      selectionFromBrowserInput({ companyOnly: true } as any),
    ).toBeUndefined();
  });
});
