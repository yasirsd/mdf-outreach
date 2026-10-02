import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION = { userId: "11111111-1111-4111-8111-111111111111", membership: { workspaceId: "22222222-2222-4222-8222-222222222222" } };
const CANDIDATE = "33333333-3333-4333-8333-333333333333";

const harness = {
  rows: [] as Array<Record<string, unknown>>,
  listCalls: [] as Array<[string, string]>,
  insertCalls: [] as Array<Record<string, unknown>>,
  supersedeCalls: [] as Array<[string, Record<string, unknown>]>,
  withdrawCalls: [] as string[],
  insertedId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

vi.mock("@/lib/auth/require", () => ({
  requireMdfSession: async () => SESSION,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => ({}) }));
vi.mock("@/lib/tradeResearch/server/serviceRoleClient", () => ({
  getTradeResearchServiceRoleClient: () => ({}),
}));
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: CANDIDATE }, error: null }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/tradeResearch/repository", () => ({
  createTradeResearchReadRepository: () => ({}),
  TradeResearchWriter: class {
    async insertThaiManualEvidence(input: Record<string, unknown>) {
      harness.insertCalls.push(input);
      return { id: harness.insertedId };
    }
    async supersedeThaiManualEvidence(previousId: string, input: Record<string, unknown>) {
      harness.supersedeCalls.push([previousId, input]);
      return { id: harness.insertedId };
    }
    async withdrawThaiManualEvidence(id: string) {
      harness.withdrawCalls.push(id);
    }
    async listThaiManualEvidenceForCandidate(workspaceId: string, candidateId: string) {
      harness.listCalls.push([workspaceId, candidateId]);
      return harness.rows;
    }
  },
}));
vi.mock("@/lib/tradeResearch/thailand/manualEvidenceResolver", () => ({
  resolveActiveThailandManualEvidence: () => ({ conflicts: [] }),
}));
vi.mock("@/lib/tradeResearch/thailand/manualEvidenceSourceAllowlist", () => ({
  requireAllowedManualEvidenceSourceUrl: () => undefined,
  ThailandManualEvidenceSourceUrlError: class extends Error {},
}));

import {
  recordThailandManualEvidenceAction,
  supersedeThailandManualEvidenceAction,
  getThailandManualEvidenceHistoryAction,
  type RecordThailandManualEvidenceInput,
} from "./thailandManualEvidenceActions";

function baseInput(overrides: Partial<RecordThailandManualEvidenceInput> = {}): RecordThailandManualEvidenceInput {
  return {
    candidateId: CANDIDATE,
    providerId: "thai-customs-operator",
    sourceUrl: "https://www.customs.go.th/x",
    sourceLabel: "Customs operator lookup",
    evidencePayload: {},
    evidenceStatus: "verified",
    ...overrides,
  };
}

beforeEach(() => {
  harness.rows = [];
  harness.listCalls = [];
  harness.insertCalls = [];
  harness.supersedeCalls = [];
  harness.withdrawCalls = [];
});
afterEach(() => { vi.restoreAllMocks(); });

describe("TH06 FINAL — Issue 2: Customs operator type must match contract", () => {
  it("verified Customs operator result WITHOUT operatorTypeSnapshot is rejected (never defaults to importer)", async () => {
    const result = await recordThailandManualEvidenceAction(baseInput({ evidencePayload: {} }));
    expect(result.outcome).toBe("invalid_input");
    expect(harness.insertCalls).toHaveLength(0);
    if (result.outcome === "invalid_input") {
      expect(result.message.toLowerCase()).toContain("operatortypesnapshot");
      expect(result.message.toLowerCase()).toContain("never defaults to importer");
    }
  });

  it("verified result with operatorTypeSnapshot=importer is accepted", async () => {
    const result = await recordThailandManualEvidenceAction(baseInput({
      evidencePayload: { operatorTypeSnapshot: "importer" },
    }));
    expect(result.outcome).toBe("recorded");
    expect(harness.insertCalls).toHaveLength(1);
    expect((harness.insertCalls[0]!.evidencePayload as Record<string, unknown>).operatorTypeSnapshot).toBe("importer");
  });

  it("verified result accepts each allowed operator type", async () => {
    for (const t of ["importer", "exporter", "broker", "aeo", "other"]) {
      harness.insertCalls = [];
      const result = await recordThailandManualEvidenceAction(baseInput({
        evidencePayload: { operatorTypeSnapshot: t },
      }));
      expect(result.outcome).toBe("recorded");
      expect(harness.insertCalls).toHaveLength(1);
    }
  });

  it("verified result rejects an operator type outside the allowed set", async () => {
    const result = await recordThailandManualEvidenceAction(baseInput({
      evidencePayload: { operatorTypeSnapshot: "customs-agent" },
    }));
    expect(result.outcome).toBe("invalid_input");
    expect(harness.insertCalls).toHaveLength(0);
  });

  it("not_found Customs operator result is accepted WITHOUT operatorTypeSnapshot (not fabricated)", async () => {
    const result = await recordThailandManualEvidenceAction(baseInput({
      evidenceStatus: "not_found",
      evidencePayload: { lookupBasis: "juristic_number" },
    }));
    expect(result.outcome).toBe("recorded");
    expect(harness.insertCalls).toHaveLength(1);
    expect((harness.insertCalls[0]!.evidencePayload as Record<string, unknown>).operatorTypeSnapshot).toBeUndefined();
  });

  it("inconclusive Customs operator result accepts an observed operator type", async () => {
    const result = await recordThailandManualEvidenceAction(baseInput({
      evidenceStatus: "inconclusive",
      evidencePayload: { operatorTypeSnapshot: "broker" },
    }));
    expect(result.outcome).toBe("recorded");
  });

  it("inconclusive/not_found rejects a BAD operator type if the caller still supplies one", async () => {
    const result = await recordThailandManualEvidenceAction(baseInput({
      evidenceStatus: "inconclusive",
      evidencePayload: { operatorTypeSnapshot: "garbage" },
    }));
    expect(result.outcome).toBe("invalid_input");
  });

  it("supersedeThailandManualEvidenceAction also enforces operator type on verified", async () => {
    const previousId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const result = await supersedeThailandManualEvidenceAction(previousId, baseInput({ evidencePayload: {} }));
    expect(result.outcome).toBe("invalid_input");
    expect(harness.supersedeCalls).toHaveLength(0);
  });

  it("supersedeThailandManualEvidenceAction accepts a corrected operator type", async () => {
    const previousId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const result = await supersedeThailandManualEvidenceAction(previousId, baseInput({
      evidencePayload: { operatorTypeSnapshot: "exporter" },
    }));
    expect(result.outcome).toBe("recorded");
    expect(harness.supersedeCalls).toHaveLength(1);
    expect(harness.supersedeCalls[0]![0]).toBe(previousId);
  });

  it("DBD / FDA providers do NOT require operatorTypeSnapshot even when verified", async () => {
    harness.insertCalls = [];
    const dbd = await recordThailandManualEvidenceAction(baseInput({
      providerId: "thai-dbd",
      sourceUrl: "https://datawarehouse.dbd.go.th/x",
      evidencePayload: { juristicRegistrationNumber: "1234567890123" },
    }));
    expect(dbd.outcome).toBe("recorded");
    const fda = await recordThailandManualEvidenceAction(baseInput({
      providerId: "thai-fda-importer",
      sourceUrl: "https://www.fda.moph.go.th/x",
      evidencePayload: { licenseNumberSnapshot: "FDA-1" },
    }));
    expect(fda.outcome).toBe("recorded");
    expect(harness.insertCalls).toHaveLength(2);
  });
});

function row(partial: Record<string, unknown>) {
  return {
    id: partial.id,
    provider_id: partial.provider_id,
    evidence_status: partial.evidence_status,
    captured_at: partial.captured_at ?? "2026-10-02T00:00:00.000Z",
    captured_by_user_id: partial.captured_by_user_id ?? SESSION.userId,
    source_url: partial.source_url ?? "https://datawarehouse.dbd.go.th/x",
    source_label: partial.source_label ?? "DBD lookup",
    supersedes_id: partial.supersedes_id ?? null,
    lookup_basis: partial.lookup_basis ?? null,
    lookup_basis_detail: partial.lookup_basis_detail ?? null,
  };
}

describe("TH06 FINAL — Issue 3: Manual evidence history must be viewable", () => {
  it("returns null for an invalid candidate id without touching the DB", async () => {
    const result = await getThailandManualEvidenceHistoryAction("not-a-uuid");
    expect(result).toBeNull();
    expect(harness.listCalls).toHaveLength(0);
  });

  it("reads only the current workspace scope (session-derived)", async () => {
    harness.rows = [];
    await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(harness.listCalls).toHaveLength(1);
    expect(harness.listCalls[0]![0]).toBe(SESSION.membership.workspaceId);
    expect(harness.listCalls[0]![1]).toBe(CANDIDATE);
  });

  it("groups rows by provider; buckets are empty when no rows exist", async () => {
    harness.rows = [];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result).not.toBeNull();
    expect(result!.dbd).toEqual([]);
    expect(result!.customsOperator).toEqual([]);
    expect(result!.fdaImporter).toEqual([]);
  });

  it("labels a leaf verified row as Current (no newer row supersedes it)", async () => {
    harness.rows = [row({ id: "r1", provider_id: "thai-dbd", evidence_status: "verified" })];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result!.dbd).toHaveLength(1);
    expect(result!.dbd[0]!.historyStatus).toBe("current");
    expect(result!.dbd[0]!.superseded_by_id).toBeNull();
  });

  it("labels withdrawn rows as Withdrawn regardless of supersession", async () => {
    harness.rows = [row({ id: "r1", provider_id: "thai-dbd", evidence_status: "withdrawn" })];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result!.dbd[0]!.historyStatus).toBe("withdrawn");
  });

  it("marks a predecessor as Superseded when a newer row has supersedes_id = its id", async () => {
    // listThaiManualEvidenceForCandidate is ordered DESC by created_at,
    // so newer row comes first in the array.
    harness.rows = [
      row({ id: "r2", provider_id: "thai-dbd", evidence_status: "verified", supersedes_id: "r1", captured_at: "2026-10-02T01:00:00.000Z" }),
      row({ id: "r1", provider_id: "thai-dbd", evidence_status: "verified", captured_at: "2026-10-02T00:00:00.000Z" }),
    ];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    const r2 = result!.dbd.find((r) => r.id === "r2")!;
    const r1 = result!.dbd.find((r) => r.id === "r1")!;
    expect(r2.historyStatus).toBe("current");
    expect(r1.historyStatus).toBe("superseded");
    expect(r1.superseded_by_id).toBe("r2");
    expect(r2.supersedes_id).toBe("r1");
  });

  it("preserves newest-first order within each provider bucket", async () => {
    harness.rows = [
      row({ id: "r3", provider_id: "thai-dbd", evidence_status: "verified", captured_at: "2026-10-02T03:00:00.000Z" }),
      row({ id: "r2", provider_id: "thai-dbd", evidence_status: "verified", captured_at: "2026-10-02T02:00:00.000Z" }),
      row({ id: "r1", provider_id: "thai-dbd", evidence_status: "verified", captured_at: "2026-10-02T01:00:00.000Z" }),
    ];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result!.dbd.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("groups rows from different providers into their own buckets", async () => {
    harness.rows = [
      row({ id: "d1", provider_id: "thai-dbd", evidence_status: "verified" }),
      row({ id: "c1", provider_id: "thai-customs-operator", evidence_status: "not_found" }),
      row({ id: "f1", provider_id: "thai-fda-importer", evidence_status: "inconclusive" }),
    ];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result!.dbd.map((r) => r.id)).toEqual(["d1"]);
    expect(result!.customsOperator.map((r) => r.id)).toEqual(["c1"]);
    expect(result!.fdaImporter.map((r) => r.id)).toEqual(["f1"]);
  });

  it("surfaces lookup_basis and lookup_basis_detail when present", async () => {
    harness.rows = [
      row({ id: "r1", provider_id: "thai-dbd", evidence_status: "not_found", lookup_basis: "juristic_number", lookup_basis_detail: "no 1234..." }),
    ];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result!.dbd[0]!.lookup_basis).toBe("juristic_number");
    expect(result!.dbd[0]!.lookup_basis_detail).toBe("no 1234...");
  });

  it("ignores rows for unknown provider ids (defense in depth)", async () => {
    harness.rows = [
      row({ id: "x1", provider_id: "thai-unknown", evidence_status: "verified" }),
      row({ id: "d1", provider_id: "thai-dbd", evidence_status: "verified" }),
    ];
    const result = await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(result!.dbd.map((r) => r.id)).toEqual(["d1"]);
  });

  it("history is read-only — never mutates rows (no writer calls)", async () => {
    harness.rows = [row({ id: "r1", provider_id: "thai-dbd", evidence_status: "verified" })];
    await getThailandManualEvidenceHistoryAction(CANDIDATE);
    expect(harness.insertCalls).toHaveLength(0);
    expect(harness.supersedeCalls).toHaveLength(0);
    expect(harness.withdrawCalls).toHaveLength(0);
  });
});
