import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BI_FIXTURE_CANDIDATE_ID, buyerIntelligenceSourceFixtures } from "@/lib/buyerIntelligence/testUtils/fixtures";
import { SupabaseBuyerIntelligenceWriteRepository } from "./buyerIntelligenceWriteRepository";

function fakeRpc(response: Record<string, unknown> = { outcome: "created", id: "a0000000-0000-4000-8000-000000000001" }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: response, error: null }; } } as unknown as SupabaseClient;
  return { repository: new SupabaseBuyerIntelligenceWriteRepository(client), calls };
}

describe("BI2 Supabase write boundary", () => {
  it("does not accept or send a caller-controlled workspace id", async () => {
    const { repository, calls } = fakeRpc();
    await repository.ingestSource({ candidateId: BI_FIXTURE_CANDIDATE_ID, providerId: "fixture", sourceType: "manual", sourceKey: "one", accessClass: "manual", costClass: "free", retrievedAt: "2026-09-02T00:00:00Z" });
    expect(calls[0].fn).toBe("ingest_buyer_intelligence_source");
    expect(calls[0].args).toEqual(expect.objectContaining({ p_candidate_id: BI_FIXTURE_CANDIDATE_ID }));
    expect(JSON.stringify(calls[0].args)).not.toMatch(/workspace/i);
  });

  it("preserves deterministic replay and conflict outcomes returned by the transaction", async () => {
    for (const outcome of ["existing", "conflict"] as const) {
      const { repository } = fakeRpc({ outcome, id: "a0000000-0000-4000-8000-000000000001", ...(outcome === "conflict" ? { reason: "material_mismatch" } : {}) });
      const result = await repository.ingestClaim({ candidateId: BI_FIXTURE_CANDIDATE_ID, sourceId: buyerIntelligenceSourceFixtures[0].id,
        sourceRecordRef: "claim", claimType: "company_is_importer", evidenceType: "business_evidence", evidenceLevel: 2,
        confidence: "medium", rawValue: true, retrievedAt: "2026-09-02T00:00:00Z" });
      expect(result.outcome).toBe(outcome);
      if (outcome === "conflict") expect(result.reason).toBe("material_mismatch");
    }
  });

  it("invokes exactly one transactional refresh and validates its Candidate response", async () => {
    const { repository, calls } = fakeRpc({ outcome: "refreshed", candidate_id: BI_FIXTURE_CANDIDATE_ID });
    await expect(repository.refreshDerived(BI_FIXTURE_CANDIDATE_ID)).resolves.toEqual({ outcome: "refreshed", candidateId: BI_FIXTURE_CANDIDATE_ID });
    expect(calls).toEqual([{ fn: "refresh_buyer_intelligence", args: { p_candidate_id: BI_FIXTURE_CANDIDATE_ID } }]);
  });
});
