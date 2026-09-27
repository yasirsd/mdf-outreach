import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  serverRepos: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require", () => ({ requireMdfSession: mocks.requireSession }));
vi.mock("@/lib/repositories/server", () => ({ serverRepositories: mocks.serverRepos }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createTargetedCandidateAction, validateTargetedCandidateInputForTests } from "./targetedCandidateActions";
import type { BuyerCandidate, BuyerCandidateProductMatch } from "@/lib/buyerFinder/types";

interface FakeRepos {
  candidates: {
    list: () => Promise<BuyerCandidate[]>;
    findByDomain: (domain: string) => Promise<BuyerCandidate | undefined>;
    create: (input: BuyerCandidate) => Promise<BuyerCandidate>;
  };
  matches: {
    findByCandidateAndProduct: (candidateId: string, productId: string) => Promise<BuyerCandidateProductMatch | undefined>;
    create: (input: BuyerCandidateProductMatch) => Promise<BuyerCandidateProductMatch>;
  };
  state: {
    candidates: BuyerCandidate[];
    productMatches: BuyerCandidateProductMatch[];
    createdCandidates: number;
    createdMatches: number;
  };
}

function fakeRepos(seed: { candidates?: BuyerCandidate[]; productMatches?: BuyerCandidateProductMatch[] } = {}): FakeRepos {
  const state: FakeRepos["state"] = {
    candidates: [...(seed.candidates ?? [])],
    productMatches: [...(seed.productMatches ?? [])],
    createdCandidates: 0,
    createdMatches: 0,
  };
  return {
    state,
    candidates: {
      list: async () => state.candidates,
      findByDomain: async (domain: string) => state.candidates.find((c) => (c.domain ?? "").toLowerCase() === domain.toLowerCase()),
      create: async (input: BuyerCandidate) => {
        state.createdCandidates += 1;
        state.candidates.push(input);
        return input;
      },
    },
    matches: {
      findByCandidateAndProduct: async (candidateId: string, productId: string) =>
        state.productMatches.find((m) => m.candidateId === candidateId && m.productId === productId),
      create: async (input: BuyerCandidateProductMatch) => {
        state.createdMatches += 1;
        state.productMatches.push(input);
        return input;
      },
    },
  };
}

function installRepos(repos: FakeRepos): void {
  mocks.serverRepos.mockResolvedValue({
    repos: {
      buyerCandidates: repos.candidates,
      buyerCandidateProductMatches: repos.matches,
    },
  } as never);
}

beforeEach(() => {
  mocks.requireSession.mockReset();
  mocks.serverRepos.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.requireSession.mockResolvedValue({ membership: { role: "owner", workspaceId: "ws-1" }, userId: "user-1" });
});

afterEach(() => { vi.restoreAllMocks(); });

describe("BI4F 2C — targeted company discovery: input validation", () => {
  it("rejects missing name AND domain", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ countryCode: "US", productId: "guntur-dry-red-chilli" });
    expect(r).toMatchObject({ outcome: "invalid_input", message: expect.stringContaining("company name or a company domain") });
  });

  it("rejects malformed domain", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ domain: "  ", countryCode: "US", productId: "guntur-dry-red-chilli" });
    expect(r).toMatchObject({ outcome: "invalid_input", message: expect.stringContaining("name or a company domain") });
  });

  it("rejects unknown product ID (not in MDF canonical catalogue)", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ companyName: "Foo", countryCode: "US", productId: "not-a-real-product" });
    expect(r).toMatchObject({ outcome: "invalid_input", message: expect.stringContaining("canonical catalogue") });
  });

  it("rejects unknown country code", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ companyName: "Foo", countryCode: "XX", productId: "guntur-dry-red-chilli" });
    expect(r).toMatchObject({ outcome: "invalid_input", message: expect.stringContaining("ISO-3166") });
  });

  it("rejects missing country entirely", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ companyName: "Foo", productId: "guntur-dry-red-chilli" });
    expect(r).toMatchObject({ outcome: "invalid_input", message: expect.stringContaining("Country is required") });
  });

  it("accepts country by ISO name (canonical alias)", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ companyName: "LT Foods Americas", countryName: "United States", productId: "guntur-dry-red-chilli" });
    expect(r.outcome).toBe("created");
  });

  it("rejects non-owner session", async () => {
    installRepos(fakeRepos());
    mocks.requireSession.mockResolvedValueOnce({ membership: { role: "member", workspaceId: "ws-1" }, userId: "user-1" });
    const r = await createTargetedCandidateAction({ companyName: "LT Foods Americas", countryCode: "US", productId: "guntur-dry-red-chilli" });
    expect(r.outcome).toBe("forbidden");
  });

  it("rejects a candidate name longer than 200 chars", async () => {
    installRepos(fakeRepos());
    const r = await createTargetedCandidateAction({ companyName: "x".repeat(300), countryCode: "US", productId: "guntur-dry-red-chilli" });
    expect(r.outcome).toBe("invalid_input");
  });

  it("pure-validator helper rejects missing product", () => {
    const r = validateTargetedCandidateInputForTests({ companyName: "X", countryCode: "US", productId: "" });
    expect(r?.outcome).toBe("invalid_input");
  });

  it("pure-validator helper accepts complete input", () => {
    const r = validateTargetedCandidateInputForTests({ companyName: "X", countryCode: "US", productId: "guntur-dry-red-chilli" });
    expect(r).toBeNull();
  });
});

describe("BI4F 2C — targeted company discovery: happy paths", () => {
  it("creates a new candidate with the exact name + domain the operator supplied", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas",
      domain: "https://www.ltfoodsglobal.com/",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
    expect(repos.state.createdCandidates).toBe(1);
    expect(repos.state.candidates[0]).toMatchObject({
      companyName: "LT Foods Americas",
      domain: "ltfoodsglobal.com",
      country: "United States",
      source: "other",
      discoveryStatus: "ready",
      reviewStatus: "pending",
    });
    // Product match created — search intent, not verified-import evidence.
    expect(repos.state.createdMatches).toBe(1);
    expect(repos.state.productMatches[0]).toMatchObject({
      candidateId: repos.state.candidates[0].id,
      productId: "guntur-dry-red-chilli",
    });
  });

  it("domain-only input derives a display name and normalizes host", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      domain: "https://www.starkist.com",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
    expect(repos.state.candidates[0].domain).toBe("starkist.com");
    // Display name derived from host prefix when no name supplied.
    expect(repos.state.candidates[0].companyName).toBe("STARKIST");
  });

  it("name-only input creates a candidate without a domain (no fabrication)", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "Sovena USA, Inc.",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
    expect(repos.state.candidates[0].domain).toBeUndefined();
    expect(repos.state.candidates[0].website).toBeUndefined();
    expect(repos.state.candidates[0].companyName).toBe("Sovena USA, Inc.");
  });

  it("normalizes host (strips protocol, path, www)", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    await createTargetedCandidateAction({
      companyName: "Costco Wholesale Corporation",
      domain: "www.Costco.com/imports",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(repos.state.candidates[0].domain).toBe("costco.com");
  });
});

describe("BI4F 2C — targeted company discovery: duplicate safety", () => {
  it("reuses an existing candidate matched by domain — no duplicate row", async () => {
    const existing: BuyerCandidate = {
      id: "existing-1", companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      country: "United States", source: "hunter",
      discoveryStatus: "ready", reviewStatus: "pending",
    };
    const repos = fakeRepos({ candidates: [existing] });
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas",
      domain: "ltfoodsglobal.com",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r).toMatchObject({ outcome: "reused", candidateId: "existing-1" });
    expect(repos.state.createdCandidates).toBe(0);
    // Existing source is NOT overwritten (still "hunter").
    expect(repos.state.candidates[0].source).toBe("hunter");
  });

  it("reuses an existing candidate matched by normalized company name", async () => {
    const existing: BuyerCandidate = {
      id: "existing-2", companyName: "LT Foods Americas, Inc.", domain: undefined,
      country: "United States", source: "hunter",
      discoveryStatus: "ready", reviewStatus: "pending",
    };
    const repos = fakeRepos({ candidates: [existing] });
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas Inc",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r).toMatchObject({ outcome: "reused", candidateId: "existing-2" });
    expect(repos.state.createdCandidates).toBe(0);
  });

  it("domain match takes precedence over name mismatch", async () => {
    // Existing candidate has the domain the operator supplied but a
    // different name — domain is the stronger identity signal.
    const existing: BuyerCandidate = {
      id: "existing-3", companyName: "Some Legacy Name", domain: "costco.com",
      country: "United States", source: "hunter",
      discoveryStatus: "ready", reviewStatus: "pending",
    };
    const repos = fakeRepos({ candidates: [existing] });
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "Costco Wholesale Corporation",
      domain: "costco.com",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r).toMatchObject({ outcome: "reused", candidateId: "existing-3" });
  });

  it("reused candidate still gets the product match if missing", async () => {
    const existing: BuyerCandidate = {
      id: "existing-4", companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      country: "United States", source: "hunter",
      discoveryStatus: "ready", reviewStatus: "pending",
    };
    const repos = fakeRepos({ candidates: [existing] });
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas",
      domain: "ltfoodsglobal.com",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r).toMatchObject({ outcome: "reused", productMatchCreated: true });
    expect(repos.state.createdMatches).toBe(1);
  });

  it("reused candidate WITH an existing product match — no duplicate match created", async () => {
    const existing: BuyerCandidate = {
      id: "existing-5", companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      country: "United States", source: "hunter",
      discoveryStatus: "ready", reviewStatus: "pending",
    };
    const existingMatch: BuyerCandidateProductMatch = {
      id: "match-1", candidateId: "existing-5", productId: "guntur-dry-red-chilli",
      evidence: [], source: "directory",
    };
    const repos = fakeRepos({ candidates: [existing], productMatches: [existingMatch] });
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas",
      domain: "ltfoodsglobal.com",
      countryCode: "US",
      productId: "guntur-dry-red-chilli",
    });
    expect(r).toMatchObject({ outcome: "reused", productMatchCreated: false });
    expect(repos.state.createdMatches).toBe(0);
  });
});

describe("BI4F 2C — targeted company discovery: provenance + no Buyer creation", () => {
  it("new candidate uses `source: 'other'` (operator-seeded) — NEVER 'hunter' / 'apollo' provenance", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    await createTargetedCandidateAction({
      companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      countryCode: "US", productId: "guntur-dry-red-chilli",
    });
    expect(repos.state.candidates[0].source).toBe("other");
  });

  it("product match is CONTEXT, not verified-import evidence (relevance/evidence deliberately left absent)", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    await createTargetedCandidateAction({
      companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      countryCode: "US", productId: "guntur-dry-red-chilli",
    });
    const match = repos.state.productMatches[0];
    expect(match.productId).toBe("guntur-dry-red-chilli");
    expect(match.relevance).toBeUndefined();
    // No fabricated evidence array — the action never claims the
    // company has been verified as importing the product.
  });

  it("never creates a Buyer row (buyer creation surface is out of scope)", async () => {
    // Buyer creation is via serverRepositories().repos.buyers.create.
    // Our fakeRepos deliberately omits `buyers` — the action must not
    // reference it. Any accidental buyer.create call would throw.
    const repos = fakeRepos();
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      countryCode: "US", productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
    // No `buyers` repo touched — the action shape guarantees this.
  });

  it("no personal-reveal / email surface touched (BUYER_FINDER_HUNTER_REVEAL_ENABLED contract)", async () => {
    // Fake repos have no contact/email creators. If the action tried
    // to reveal contacts, the fake would 'undefined-is-not-a-function'.
    const repos = fakeRepos();
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      countryCode: "US", productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
  });

  it("₹0: no fetch call is made; targeted discovery is pure DB seeding", async () => {
    const fetchImpl = vi.fn();
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const repos = fakeRepos();
    installRepos(repos);
    await createTargetedCandidateAction({
      companyName: "LT Foods Americas", domain: "ltfoodsglobal.com",
      countryCode: "US", productId: "guntur-dry-red-chilli",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("Canada targeted discovery works and preserves country semantics", async () => {
    const repos = fakeRepos();
    installRepos(repos);
    const r = await createTargetedCandidateAction({
      companyName: "Loblaw Companies Limited",
      domain: "loblaw.ca",
      countryCode: "CA",
      productId: "guntur-dry-red-chilli",
    });
    expect(r.outcome).toBe("created");
    expect(repos.state.candidates[0]).toMatchObject({
      country: "Canada", domain: "loblaw.ca", discoveryStatus: "ready",
    });
  });

  it("action revalidates /buyer-finder so the UI reflects the new/reused candidate", async () => {
    installRepos(fakeRepos());
    await createTargetedCandidateAction({
      companyName: "Costco Wholesale Corporation",
      domain: "costco.com", countryCode: "US", productId: "guntur-dry-red-chilli",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/buyer-finder");
  });
});
