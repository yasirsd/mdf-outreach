import { describe, expect, it } from "vitest";
import { createBuyerCandidateRepository } from "./buyerCandidateRepository";
import { createBuyerCandidateProductMatchRepository } from "./buyerCandidateProductMatchRepository";

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CANDIDATE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CANDIDATE_B = "bbbbbbbb-0000-4000-8000-000000000001";
const MATCH_A = "aaaaaaaa-0000-4000-8000-000000000002";
const MATCH_B = "bbbbbbbb-0000-4000-8000-000000000002";

function candidateRow(id: string, workspaceId: string) {
  return {
    id, workspace_id: workspaceId, company_name: "LT Foods Americas",
    website: "https://ltfoodsglobal.com", domain: "ltfoodsglobal.com",
    country: "United States", city: null, address: null, phone: null,
    general_email: null, company_linkedin_url: null, industry: null,
    buyer_type: null, source: "other", source_url: null, is_importer: null,
    is_distributor: null, evidence: [], buyer_score: null,
    discovery_status: "ready", review_status: "pending", rejection_reason: null,
    people_searched_at: null, people_has_more: false,
    public_contacts_searched_at: null,
    created_at: "2026-09-28T00:00:00.000Z", updated_at: "2026-09-28T00:00:00.000Z",
  };
}

function matchRow(id: string, workspaceId: string, candidateId: string) {
  return {
    id, workspace_id: workspaceId, candidate_id: candidateId,
    product_key: "guntur-dry-red-chilli", country: "United States", query: null,
    relevance: null, evidence: [], source: "other",
    discovered_at: "2026-09-28T00:00:00.000Z",
    created_at: "2026-09-28T00:00:00.000Z", updated_at: "2026-09-28T00:00:00.000Z",
  };
}

type Row = Record<string, unknown>;

function fakeSupabase() {
  const tables: Record<string, Row[]> = {
    buyer_candidates: [candidateRow(CANDIDATE_A, WS_A), candidateRow(CANDIDATE_B, WS_B)],
    buyer_candidate_product_matches: [matchRow(MATCH_A, WS_A, CANDIDATE_A), matchRow(MATCH_B, WS_B, CANDIDATE_B)],
  };
  const inserted: Array<{ table: string; row: Row }> = [];
  return {
    inserted,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let insertRow: Row | undefined;
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        order: () => query,
        limit: () => query,
        insert: (row: Row) => {
          insertRow = row;
          return query;
        },
        maybeSingle: async () => ({ data: (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)))[0] ?? null, error: null }),
        single: async () => {
          if (!insertRow) return { data: null, error: null };
          inserted.push({ table, row: insertRow });
          const parent = tables.buyer_candidates.find((row) => row.id === insertRow!.candidate_id);
          if (table === "buyer_candidate_product_matches" && parent?.workspace_id !== insertRow.workspace_id) {
            return { data: null, error: new Error("composite workspace foreign key rejected") };
          }
          const persisted = {
            ...insertRow,
            created_at: "2026-09-28T00:00:00.000Z",
            updated_at: "2026-09-28T00:00:00.000Z",
          };
          tables[table] ??= [];
          tables[table].push(persisted);
          return { data: persisted, error: null };
        },
        then: (resolve: (value: unknown) => void) => resolve({
          data: (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row))),
          error: null,
        }),
      };
      return query;
    },
  };
}

describe("two-workspace repository isolation", () => {
  it("lists, finds by id, and finds by domain only inside the selected workspace", async () => {
    const db = fakeSupabase();
    const selectedB = createBuyerCandidateRepository(db as never, WS_B);
    await expect(selectedB.list()).resolves.toMatchObject([{ id: CANDIDATE_B }]);
    await expect(selectedB.get(CANDIDATE_A)).resolves.toBeUndefined();
    await expect(selectedB.get(CANDIDATE_B)).resolves.toMatchObject({ id: CANDIDATE_B });
    await expect(selectedB.findByDomain("ltfoodsglobal.com")).resolves.toMatchObject({ id: CANDIDATE_B });
  });

  it("switching A to B changes results deterministically", async () => {
    const db = fakeSupabase();
    const selectedA = createBuyerCandidateRepository(db as never, WS_A);
    const selectedB = createBuyerCandidateRepository(db as never, WS_B);
    await expect(selectedA.list()).resolves.toMatchObject([{ id: CANDIDATE_A }]);
    await expect(selectedB.list()).resolves.toMatchObject([{ id: CANDIDATE_B }]);
  });

  it("scopes product-match reads and rejects a cross-workspace parent on write", async () => {
    const db = fakeSupabase();
    const matchesB = createBuyerCandidateProductMatchRepository(db as never, WS_B);
    await expect(matchesB.listByCandidate(CANDIDATE_A)).resolves.toEqual([]);
    await expect(matchesB.findByCandidateAndProduct(CANDIDATE_A, "guntur-dry-red-chilli")).resolves.toBeUndefined();
    await expect(matchesB.create({
      id: "bbbbbbbb-0000-4000-8000-000000000003",
      candidateId: CANDIDATE_A,
      productId: "guntur-dry-red-chilli",
      source: "other",
      evidence: [],
    })).rejects.toThrow("composite workspace foreign key rejected");
    expect(db.inserted.at(-1)?.row.workspace_id).toBe(WS_B);
  });

  it("allows the same domain to exist once in each workspace", async () => {
    const db = fakeSupabase();
    const selectedA = createBuyerCandidateRepository(db as never, WS_A);
    const selectedB = createBuyerCandidateRepository(db as never, WS_B);
    await expect(selectedA.findByDomain("ltfoodsglobal.com")).resolves.toMatchObject({ id: CANDIDATE_A });
    await expect(selectedB.findByDomain("ltfoodsglobal.com")).resolves.toMatchObject({ id: CANDIDATE_B });
  });
});
