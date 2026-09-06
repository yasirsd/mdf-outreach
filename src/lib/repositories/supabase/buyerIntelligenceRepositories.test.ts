import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBuyerIntelligenceRepositories,
  SupabaseBuyerTradeMetricRepository,
  SupabaseBuyerTradeObservationRepository,
} from "./buyerIntelligenceRepositories";
import {
  BI_FIXTURE_CANDIDATE_ID,
  BI_FIXTURE_WORKSPACE_ID,
  buyerTradeObservationFixtures,
} from "@/lib/buyerIntelligence/testUtils/fixtures";

type Call = { method: string; args: unknown[] };

function rowFromObservation(row: (typeof buyerTradeObservationFixtures)[number]) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    candidate_id: row.candidateId,
    source_id: row.sourceId,
    source_record_ref: row.sourceRecordRef,
    granularity: row.granularity,
    evidence_type: row.evidenceType,
    evidence_level: row.evidenceLevel,
    confidence: row.confidence,
    trade_date: row.tradeDate ?? null,
    origin_country_code: row.originCountryCode ?? null,
    destination_country_code: row.destinationCountryCode ?? null,
    supplier_name_raw: row.supplierNameRaw ?? null,
    supplier_name_normalized: row.supplierNameNormalized ?? null,
    supplier_country_code: row.supplierCountryCode ?? null,
    product_description_raw: row.productDescriptionRaw ?? null,
    normalized_product_category: row.normalizedProductCategory ?? null,
    mdf_product_id: row.mdfProductId ?? null,
    hs_code_raw: row.hsCodeRaw ?? null,
    retrieved_at: row.retrievedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function fakeSupabase(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "or", "is", "lt"]) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  query.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  query.then = (resolve: (result: unknown) => unknown) =>
    Promise.resolve(resolve({ data: rows, error: null }));
  const client = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("BI1 Supabase read repositories", () => {
  it("pins observation reads to workspace + candidate and returns a DB keyset cursor", async () => {
    const { client, calls } = fakeSupabase(
      buyerTradeObservationFixtures.slice(0, 2).map(rowFromObservation),
    );
    const repository = new SupabaseBuyerTradeObservationRepository(
      client,
      BI_FIXTURE_WORKSPACE_ID,
    );
    const page = await repository.listByCandidatePage(BI_FIXTURE_CANDIDATE_ID, {
      limit: 1,
      evidenceType: "verified_trade_evidence",
      originCountryCode: "IN",
    });

    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBe(
      "bi1|2026-07-10|50000000-0000-4000-8000-000000000001",
    );
    expect(calls).toContainEqual({ method: "eq", args: ["workspace_id", BI_FIXTURE_WORKSPACE_ID] });
    expect(calls).toContainEqual({ method: "eq", args: ["candidate_id", BI_FIXTURE_CANDIDATE_ID] });
    expect(calls).toContainEqual({ method: "eq", args: ["evidence_type", "verified_trade_evidence"] });
    expect(calls).toContainEqual({ method: "eq", args: ["origin_country_code", "IN"] });
    expect(calls).toContainEqual({ method: "limit", args: [2] });
  });

  it("translates the opaque cursor to database ordering filters, never provider pagination", async () => {
    const { client, calls } = fakeSupabase([]);
    const repository = new SupabaseBuyerTradeObservationRepository(
      client,
      BI_FIXTURE_WORKSPACE_ID,
    );
    await repository.listByCandidatePage(BI_FIXTURE_CANDIDATE_ID, {
      cursor: "bi1|2026-07-10|50000000-0000-4000-8000-000000000001",
    });
    const or = calls.find((call) => call.method === "or");
    expect(or?.args[0]).toContain("trade_date.lt.2026-07-10");
    expect(or?.args[0]).toContain("id.lt.50000000-0000-4000-8000-000000000001");
  });

  it("rejects unknown MDF product filters before completing the query", async () => {
    const { client } = fakeSupabase([]);
    const repository = new SupabaseBuyerTradeObservationRepository(
      client,
      BI_FIXTURE_WORKSPACE_ID,
    );
    await expect(
      repository.listByCandidatePage(BI_FIXTURE_CANDIDATE_ID, {
        mdfProductId: "invented-product",
      }),
    ).rejects.toThrow(/Unknown MDF/);
  });

  it("provides all six read-only repository contracts", () => {
    const { client } = fakeSupabase([]);
    expect(Object.keys(createBuyerIntelligenceRepositories(client, BI_FIXTURE_WORKSPACE_ID))).toEqual([
      "buyerIntelligenceSources",
      "buyerIntelligenceClaims",
      "buyerTradeObservations",
      "buyerTradeMetrics",
      "buyerIntelligenceAssessments",
      "buyerIntelligenceAssessmentEvidence",
    ]);
  });

  it("uses the lifetime calculation window for the Candidate overview summary", async () => {
    const { client, calls } = fakeSupabase([]);
    const repository = new SupabaseBuyerTradeMetricRepository(client, BI_FIXTURE_WORKSPACE_ID);
    await repository.getTradeSummary(BI_FIXTURE_CANDIDATE_ID);
    expect(calls).toContainEqual({
      method: "eq",
      args: ["calculation_window", "lifetime"],
    });
  });
});
