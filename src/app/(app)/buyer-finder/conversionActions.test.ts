import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Buyer } from "@/lib/types";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidatePublicEmail } from "@/lib/buyerFinder/types";
import {
  convertCandidateToBuyer,
  type CandidateConversion,
} from "@/lib/buyerFinder/conversion";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };

const natureland: BuyerCandidate = {
  id: "00000000-0000-4000-8000-0000000000aa",
  companyName: "Natureland",
  website: "https://natureland.net",
  domain: "natureland.net",
  country: "Kuwait",
  discoveryStatus: "ready",
  reviewStatus: "approved",
  buyerType: "Importer",
};

const ahmed: BuyerCandidateContact = {
  id: "00000000-0000-4000-8000-0000000000c1",
  candidateId: natureland.id,
  firstName: "Ahmed",
  lastName: "El Din",
  fullName: "Ahmed El Din",
  jobTitle: "Category Manager",
  businessEmail: "ahmed@natureland.net",
  isPrimary: true,
  contactScore: 18,
  source: "hunter",
};

const chilli = {
  id: "00000000-0000-4000-8000-0000000000bb",
  candidateId: natureland.id,
  productId: "guntur-dry-red-chilli" as const,
  relevance: 50,
  evidence: [],
  source: "hunter",
};

const buyers: Buyer[] = [];
const conversions = new Map<string, CandidateConversion>();
const candidates = new Map<string, BuyerCandidate>([[natureland.id, { ...natureland }]]);

const harness = {
  requireMdfSession: vi.fn(async () => SESSION),
  revalidatePath: vi.fn(),
};

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: () => harness.requireMdfSession(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => harness.revalidatePath(path),
}));

vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: SESSION,
    repos: {
      buyers: {
        list: async () => buyers.slice(),
        get: async (id: string) => buyers.find((b) => b.id === id),
        create: async () => {
          throw new Error("preview/convert must not call buyers.create");
        },
      },
      buyerCandidates: {
        get: async (id: string) => candidates.get(id),
        update: async (id: string, patch: Partial<BuyerCandidate>) => {
          const cur = candidates.get(id);
          if (!cur) throw new Error("missing");
          const next = { ...cur, ...patch };
          candidates.set(id, next);
          return next;
        },
      },
      buyerCandidateContacts: {
        listByCandidate: async () => [ahmed],
      },
      buyerCandidatePublicEmails: {
        listByCandidate: async (): Promise<BuyerCandidatePublicEmail[]> => [],
      },
      buyerCandidateProductMatches: {
        listByCandidate: async () => [chilli],
      },
      buyerFinderCandidateConversions: {
        getByCandidate: async (id: string) => conversions.get(id),
        listByCandidateIds: async (ids: string[]) =>
          ids.map((id) => conversions.get(id)).filter(Boolean),
        convert: async (input: {
          candidateId: string;
          sourceKind: "revealed_personal_contact" | "public_company_email" | "company_only";
          contactId?: string;
          publicEmailId?: string;
          productInterest?: string;
        }) =>
          convertCandidateToBuyer({
            workspaceKey: SESSION.membership.workspaceId,
            candidate: candidates.get(input.candidateId),
            contacts: [ahmed],
            publicEmails: [],
            productMatches: [chilli],
            requested: {
              kind: input.sourceKind,
              contactId: input.contactId,
              publicEmailId: input.publicEmailId,
            },
            loadExistingBuyers: async () => buyers.slice(),
            loadConversion: async () => conversions.get(input.candidateId),
            insertAtomic: async (buyer, conversion) => {
              buyers.push(buyer);
              conversions.set(conversion.candidateId, conversion);
            },
          }),
      },
    },
  }),
}));

import {
  convertCandidateToBuyerAction,
  previewCandidateConversionAction,
} from "./conversionActions";

beforeEach(() => {
  buyers.length = 0;
  conversions.clear();
  candidates.set(natureland.id, { ...natureland, reviewStatus: "approved" });
  harness.revalidatePath.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BF5A conversion actions", () => {
  it("preview does not insert a Buyer", async () => {
    const preview = await previewCandidateConversionAction({ candidateId: natureland.id });
    expect(preview.eligibility).toBe("ok");
    expect(preview.mapping.email).toBe("ahmed@natureland.net");
    expect(preview.mapping.productInterest).toBe("Guntur Dry Red Chilli");
    expect(preview.mapping.source).toBe("Buyer Finder");
    expect(preview.mapping.buyerType).toBeUndefined();
    expect(buyers).toHaveLength(0);
    expect(conversions.size).toBe(0);
    expect(harness.revalidatePath).not.toHaveBeenCalled();
  });

  it("Create Buyer inserts one Buyer and one conversion from persisted data", async () => {
    const result = await convertCandidateToBuyerAction({
      candidateId: natureland.id,
      contactId: ahmed.id,
    });
    expect(result.outcome).toBe("created");
    expect(buyers).toHaveLength(1);
    expect(conversions.size).toBe(1);
    expect(buyers[0]?.email).toBe("ahmed@natureland.net");
    expect(buyers[0]?.buyerType).toBeUndefined();
    expect(result.buyerHref).toContain("/buyers?q=");
    expect(harness.revalidatePath).toHaveBeenCalledWith("/buyers");
  });

  it("second convert is already converted and does not insert another Buyer", async () => {
    await convertCandidateToBuyerAction({ candidateId: natureland.id, contactId: ahmed.id });
    const second = await convertCandidateToBuyerAction({
      candidateId: natureland.id,
      contactId: ahmed.id,
    });
    expect(second.outcome).toBe("already_converted");
    expect(buyers).toHaveLength(1);
  });
});
