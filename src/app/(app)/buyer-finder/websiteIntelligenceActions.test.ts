import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type {
  ClaimIngestionInput,
  IntelligenceIngestionResult,
  SourceIngestionInput,
} from "@/lib/buyerIntelligence/ingestion";
import type { TradeObservationIngestionInput } from "@/lib/buyerIntelligence/ingestion";

const SESSION = { userId: "user-a", membership: { workspaceId: "ws-a" } };

const sunImpex: BuyerCandidate = {
  id: "00000000-0000-4000-8000-0000000000bb",
  companyName: "Sun Impex",
  website: "https://sunimpex.example",
  domain: "sunimpex.example",
  country: "UAE",
  source: "hunter",
  discoveryStatus: "ready",
  reviewStatus: "approved",
};

// Simple in-memory BI writer + candidate store scoped per-test.
const store = {
  candidates: new Map<string, BuyerCandidate>(),
  sources: new Map<string, SourceIngestionInput & { id: string }>(),
  claims: new Map<string, ClaimIngestionInput & { id: string }>(),
  observations: [] as TradeObservationIngestionInput[],
  refreshCalls: 0,
  conflictNextClaim: false,
};

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

vi.mock("@/lib/buyerIntelligence/websiteResearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/buyerIntelligence/websiteResearch")>();
  return {
    ...actual,
    planWebsiteResearch: async () => ({
      status: "researched" as const,
      domain: "sunimpex.example",
      entryUrl: "https://sunimpex.example/",
      pages: [
        {
          requestedUrl: "https://sunimpex.example/",
          finalUrl: "https://sunimpex.example/",
          kind: "homepage" as const,
          outcome: "ok" as const,
          claims: [
            {
              claimType: "website_business_description" as const,
              sourceRecordRef: "page:homepage:/:description",
              confidence: "medium" as const,
              excerpt: "Specialty ingredients importer and distributor.",
            },
            {
              claimType: "company_is_importer" as const,
              sourceRecordRef: "page:homepage:/:importer",
              confidence: "medium" as const,
              excerpt: "We are a leading importer of spices.",
            },
          ],
          httpStatus: 200,
          bytesRead: 900,
        },
        {
          requestedUrl: "https://sunimpex.example/about",
          finalUrl: "https://sunimpex.example/about",
          kind: "about" as const,
          outcome: "no_claims" as const,
          claims: [],
          httpStatus: 200,
        },
      ],
      pagesFetched: 2,
      claimsExtracted: 2,
    }),
  };
});

vi.mock("@/lib/repositories/server", () => ({
  serverRepositories: async () => ({
    session: SESSION,
    repos: {
      buyers: {
        get: async () => undefined,
        create: async () => {
          throw new Error("BI3 must not create Buyers");
        },
      },
      buyerCandidates: {
        get: async (id: string) => store.candidates.get(id),
      },
      buyerIntelligenceWriter: {
        ingestSource: async (input: SourceIngestionInput): Promise<IntelligenceIngestionResult> => {
          const key = `${input.candidateId}:${input.providerId}:${input.sourceKey}`;
          const prev = store.sources.get(key);
          if (prev) return { outcome: "existing", id: prev.id };
          const id = `src-${store.sources.size + 1}`;
          store.sources.set(key, { ...input, id });
          return { outcome: "created", id };
        },
        ingestClaim: async (input: ClaimIngestionInput): Promise<IntelligenceIngestionResult> => {
          if (store.conflictNextClaim) {
            store.conflictNextClaim = false;
            return { outcome: "conflict", id: "existing", reason: "material_mismatch" };
          }
          const key = `${input.sourceId}:${input.sourceRecordRef}:${input.claimType}`;
          const prev = store.claims.get(key);
          if (prev) return { outcome: "existing", id: prev.id };
          const id = `cl-${store.claims.size + 1}`;
          store.claims.set(key, { ...input, id });
          return { outcome: "created", id };
        },
        ingestObservation: async (input: TradeObservationIngestionInput) => {
          store.observations.push(input);
          return { outcome: "created" as const, id: "obs-1" };
        },
        refreshDerived: async (candidateId: string) => {
          store.refreshCalls += 1;
          return { outcome: "refreshed" as const, candidateId };
        },
      },
    },
  }),
}));

import { researchCandidateWebsiteAction } from "./websiteIntelligenceActions";

beforeEach(() => {
  store.candidates = new Map([[sunImpex.id, { ...sunImpex }]]);
  store.sources.clear();
  store.claims.clear();
  store.observations = [];
  store.refreshCalls = 0;
  store.conflictNextClaim = false;
  harness.revalidatePath.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BI3 researchCandidateWebsiteAction — ingestion + BI2 authority", () => {
  it("routes every write through the BI2 writer, never creates trade observations or Buyers", async () => {
    const summary = await researchCandidateWebsiteAction(sunImpex.id);
    expect(summary.outcome).toBe("researched");
    expect(summary.claimsCreated).toBe(2);
    expect(summary.sourcesCreated).toBe(1);
    // Trade Intelligence isolation — the writer's observation path is never called.
    expect(store.observations).toEqual([]);
    // BI-refresh runs at least once (either through the claim RPC or the belt-and-braces call).
    expect(store.refreshCalls).toBeGreaterThan(0);
    // Revalidation for BF / candidate detail.
    expect(harness.revalidatePath).toHaveBeenCalledWith("/buyer-finder");
    expect(harness.revalidatePath).toHaveBeenCalledWith(`/buyer-finder/candidate/${sunImpex.id}`);
  });

  it("is idempotent — a second identical run returns existing, no new sources/claims", async () => {
    await researchCandidateWebsiteAction(sunImpex.id);
    const second = await researchCandidateWebsiteAction(sunImpex.id);
    expect(second.outcome).toBe("researched");
    expect(second.claimsCreated).toBe(0);
    expect(second.claimsExisting).toBe(2);
    expect(second.sourcesCreated).toBe(0);
    expect(second.sourcesExisting).toBe(1);
  });

  it("surfaces material_mismatch as a conflict outcome without silently overwriting evidence", async () => {
    store.conflictNextClaim = true;
    const summary = await researchCandidateWebsiteAction(sunImpex.id);
    // A conflict on the first claim; the second claim still persists as created.
    expect(summary.claimsConflicting).toBeGreaterThan(0);
    expect(summary.pages.some((p) => p.claimsConflicting > 0)).toBe(true);
    // No Buyer created.
    expect(store.observations).toEqual([]);
  });

  it("rejects an archived or rejected Candidate as invalid_input", async () => {
    store.candidates = new Map([[sunImpex.id, { ...sunImpex, discoveryStatus: "archived" as const }]]);
    const summary = await researchCandidateWebsiteAction(sunImpex.id);
    expect(summary.outcome).toBe("invalid_input");
    expect(summary.claimsCreated).toBe(0);
    expect(store.sources.size).toBe(0);
  });

  it("returns invalid_input for a bad candidate id without touching repositories", async () => {
    const summary = await researchCandidateWebsiteAction("not-a-uuid");
    expect(summary.outcome).toBe("invalid_input");
    expect(store.sources.size).toBe(0);
    expect(store.claims.size).toBe(0);
    expect(store.refreshCalls).toBe(0);
  });
});
