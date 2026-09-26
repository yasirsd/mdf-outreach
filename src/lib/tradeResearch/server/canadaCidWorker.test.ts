import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type { InternalJobRow, SnapshotRow, TradeResearchWriter } from "../repository";
import { processTradeResearchJob } from "./worker";

const NOW = new Date("2026-09-27T12:00:00Z");

function job(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "job-ca", batch_id: "batch-ca", workspace_id: "workspace-ca", candidate_id: "candidate-ca",
    product_id: "guntur-dry-red-chilli", country_code: "CA",
    status: "running", stage: "preparing_identity", revision: 1, ...over,
  };
}

function loblaw(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "candidate-ca",
    companyName: "Loblaw Companies Limited",
    country: "Canada",
    city: "Brampton, ON L6Y 5S5",
    industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
    ...over,
  };
}

function cidSnapshot(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snapshot-ca", provider_id: "canada-cid", dataset_id: "cid-major-importers-by-hs6-by-country",
    published_period: "2024", source_url: "https://ised-isde.canada.ca/site/ised/sites/default/files/documents/cid-bdic-majorimportersbyhs6bycountry2024.xls",
    material_hash: "h-ca-2024", retrieved_at: NOW.toISOString(), expires_at: "2027-09-27T12:00:00Z",
    row_count: 3,
    normalized_rows: [
      { hs6: "090421", originCountry: "IND", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
      { hs6: "090421", originCountry: "CHN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
      { hs6: "080810", originCountry: "USA", companyName: "APPLE CANADA CORP.", province: "ON", city: "Toronto" },
    ] as unknown as SnapshotRow["normalized_rows"],
    ...over,
  };
}

function cidPlan(over: Record<string, unknown> = {}) {
  return { id: "plan-ca", provider_id: "canada-cid", cost_class: "free", automatic_spend_rupees: 0, ...over };
}

function fdaXlsxBytes(): Uint8Array {
  return zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>Header</t></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData/></worksheet>`),
  });
}

// A tiny CID XLSX for cold-path tests.
function cidXlsxBytes(): Uint8Array {
  const shared = [
    "Canadian Importers Database (2024)", "HS6", "Country of Origin", "Importer Name", "Province", "City",
    "090421", "IND", "LOBLAW COMPANIES LIMITED", "ON", "Brampton",
  ];
  return zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8([
      `<worksheet><sheetData>`,
      `<row><c r="A1" t="s"><v>0</v></c></row>`,
      `<row>`,
      `<c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c>`,
      `<c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>4</v></c><c r="E2" t="s"><v>5</v></c>`,
      `</row>`,
      `<row>`,
      `<c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c>`,
      `<c r="C3" t="s"><v>8</v></c><c r="D3" t="s"><v>9</v></c><c r="E3" t="s"><v>10</v></c>`,
      `</row>`,
      `</sheetData></worksheet>`,
    ].join("")),
  });
}

interface State {
  cancelled: boolean;
  fresh?: SnapshotRow;
  latest?: SnapshotRow;
  attempts: Record<string, unknown>[];
  released: string[];
  finalized: Record<string, unknown>[];
  events: Record<string, unknown>[];
  saved: number;
  refreshed: number;
  candidate: BuyerCandidate;
  plan: Record<string, unknown>;
}

function writerFor(over: Partial<State> = {}): { state: State; writer: TradeResearchWriter } {
  const state: State = {
    cancelled: false, fresh: undefined, latest: undefined,
    attempts: [], released: [], finalized: [], events: [], saved: 0, refreshed: 0,
    candidate: loblaw(), plan: cidPlan(), ...over,
  };
  const writer = {
    isCancellationRequested: vi.fn(async () => state.cancelled),
    advance: vi.fn(async (row: InternalJobRow, _worker: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getEligiblePlan: vi.fn(async () => state.plan),
    latestAttempt: vi.fn(async () => undefined),
    startAttempt: vi.fn(async (_row: InternalJobRow, _planId: string, attemptNumber: number) => ({ id: `attempt-${attemptNumber}`, attempt_number: attemptNumber })),
    finishAttempt: vi.fn(async (_id: string, patch: Record<string, unknown>) => { state.attempts.push(patch); }),
    appendEvent: vi.fn(async (_job: InternalJobRow, event: string, safe: Record<string, unknown>) => { state.events.push({ event, ...safe }); }),
    release: vi.fn(async (_job: InternalJobRow, _worker: string, next: string) => { state.released.push(next); }),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (_job: InternalJobRow, _worker: string, status: string, outcome: string, result: unknown) => {
      state.finalized.push({ status, outcome, result });
    }),
    getFreshSnapshot: vi.fn(async () => undefined), // FDA — never used in CID path
    getLatestSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async (_p: string, _d: string) => state.fresh),
    getLatestSnapshotByProvider: vi.fn(async (_p: string, _d: string) => state.latest),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => { state.saved += 1; return { id: "new-ca", ...input } as SnapshotRow; }),
    refreshSnapshotExpiry: vi.fn(async () => { state.refreshed += 1; return state.latest!; }),
    getCandidate: vi.fn(async () => state.candidate),
  };
  return { state, writer: writer as unknown as TradeResearchWriter };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("BI4F 2B — worker dispatch by plan.provider_id", () => {
  it("CA candidate + Canada CID plan + fresh cache → matches, finalizes as needs_review (proxy HS)", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    const outcome = await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(outcome).toBe("completed");
    expect(state.finalized).toHaveLength(1);
    // Guntur HS 090421 is a PROXY mapping — even a strong identity match
    // must NOT rise to `official_importer_program_corroboration`.
    expect(state.finalized[0]).toMatchObject({ status: "needs_review", outcome: "needs_review" });
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result).toMatchObject({
      officialProgramEvidence: "verified",
      productEvidence: "supporting", // proxy mapping caps at supporting
      originEvidence: "verified",
      indiaOrigin: "verified",
      shipmentEvidence: "not_verified",
      sourcesChecked: 1,
      automaticSpendRupees: 0,
    });
    const evidence = (result.evidence ?? {}) as Record<string, unknown>;
    expect(evidence.source).toBe("Canadian Importers Database");
    expect(String(evidence.coverageExplanation)).toContain("Open Government Licence");
    expect(String(evidence.coverageExplanation)).toContain("proxy");
  });

  it("CID cache miss triggers cold fetch, parses XLSX, and saves ONE new canada-cid snapshot", async () => {
    const { state, writer } = writerFor({ fresh: undefined, latest: undefined });
    const fetchImpl = vi.fn(async () => new Response(cidXlsxBytes(), {
      status: 200, headers: { "content-type": "application/vnd.ms-excel", "etag": "\"v1\"" },
    })) as unknown as typeof fetch;
    const outcome = await processTradeResearchJob(writer, job(), "worker-a", () => NOW, fetchImpl);
    expect(outcome).toBe("completed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(state.saved).toBe(1);
    expect((writer as unknown as { saveSnapshot: ReturnType<typeof vi.fn> }).saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: "canada-cid",
      dataset_id: "cid-major-importers-by-hs6-by-country",
    }));
  });

  it("warm CID cache → no second fetch, no new snapshot, attempt marked skipped_cached", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.saved).toBe(0);
    expect(state.attempts[0]).toMatchObject({ state: "skipped_cached", record_count: 3 });
  });

  it("CA candidate + Canada CID: attempt reuse on resume — no duplicate attempts", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    const w = writer as unknown as { latestAttempt: ReturnType<typeof vi.fn>; startAttempt: ReturnType<typeof vi.fn> };
    w.latestAttempt.mockResolvedValueOnce({ id: "attempt-prior", attempt_number: 1, state: "completed" });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(w.startAttempt).not.toHaveBeenCalled();
    expect(state.attempts).toHaveLength(0);
    expect(state.finalized).toHaveLength(1);
  });

  it("cold path + insufficient deadline headroom → writer.release + retry (no fetch)", async () => {
    const { state, writer } = writerFor({ fresh: undefined, latest: undefined });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, fetchImpl, undefined,
      Date.now() + 5_000, // 5 s remaining — less than 30 s CID cold + 8 s reserve
    );
    expect(outcome).toBe("retry");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.released).toHaveLength(1);
    expect(state.finalized).toHaveLength(0);
  });

  it("cache hit + insufficient headroom before matching → checkpoint retry (no finalize)", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    const outcome = await processTradeResearchJob(
      writer, job(), "worker-a", () => NOW, undefined, undefined,
      Date.now() + 2_000, // 2 s remaining — less than match gate's 5 s
    );
    expect(outcome).toBe("retry");
    expect(state.released).toHaveLength(1);
    expect(state.finalized).toHaveLength(0);
  });

  it("India absent from matched rows → indiaOrigin stays 'not_verified'", async () => {
    const snapshotNoIndia = cidSnapshot({
      normalized_rows: [
        { hs6: "090421", originCountry: "CHN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
      ] as unknown as SnapshotRow["normalized_rows"],
    });
    const { state, writer } = writerFor({ fresh: snapshotNoIndia });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.indiaOrigin).toBe("not_verified");
    expect(result.originEvidence).toBe("verified");
  });

  it("no company match → productEvidence + originEvidence = 'no_verified_match', outcome = no_verified_evidence", async () => {
    const { state, writer } = writerFor({
      fresh: cidSnapshot(),
      candidate: loblaw({ companyName: "NoSuchCompany Ltd" }),
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const finalized = state.finalized[0]!;
    expect(finalized).toMatchObject({ status: "completed", outcome: "no_verified_evidence" });
    const result = finalized.result as Record<string, unknown>;
    expect(result).toMatchObject({
      productEvidence: "no_verified_match",
      originEvidence: "no_verified_match",
      indiaOrigin: "not_verified",
      shipmentEvidence: "not_verified",
      sourcesChecked: 1,
      automaticSpendRupees: 0,
    });
  });

  it("proxy HS mapping never verifies product-level evidence even under strong identity", async () => {
    // Guntur is proxy → 090421. Strong identity + India origin present.
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.productEvidence).toBe("supporting");
    expect(result.productEvidence).not.toBe("verified");
  });

  it("exact HS mapping + strong identity → productEvidence = 'verified' AND outcome = official_importer_program_corroboration", async () => {
    // indian-apples → 080810 exact. Use a matching CID row for that HS.
    const snapshot = cidSnapshot({
      normalized_rows: [
        { hs6: "080810", originCountry: "USA", companyName: "APPLE CANADA CORP.", province: "ON", city: "Toronto" },
      ] as unknown as SnapshotRow["normalized_rows"],
    });
    const { state, writer } = writerFor({
      fresh: snapshot,
      candidate: loblaw({ companyName: "Apple Canada Corp.", city: "Toronto, ON M5V 3A8" }),
    });
    await processTradeResearchJob(writer, job({ product_id: "indian-apples" }), "worker-a", () => NOW);
    const finalized = state.finalized[0]!;
    expect(finalized).toMatchObject({ status: "completed", outcome: "official_importer_program_corroboration" });
    const result = finalized.result as Record<string, unknown>;
    expect(result.productEvidence).toBe("verified");
  });

  it("no candidate HS mapping → unsupported_coverage, ₹0, sourcesChecked = 0", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    // productId set to something without an HS mapping.
    await processTradeResearchJob(writer, job({ product_id: "not-a-real-product" }), "worker-a", () => NOW);
    const finalized = state.finalized[0]!;
    expect(finalized).toMatchObject({ status: "completed", outcome: "unsupported_coverage" });
    const result = finalized.result as Record<string, unknown>;
    expect(result.sourcesChecked).toBe(0);
    expect(result.automaticSpendRupees).toBe(0);
  });

  it("ambiguous identity (no candidate province) → outcome = needs_review, evidence downgraded to supporting", async () => {
    const { state, writer } = writerFor({
      fresh: cidSnapshot(),
      candidate: loblaw({ city: undefined, address: undefined }),
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const finalized = state.finalized[0]!;
    expect(finalized).toMatchObject({ status: "needs_review", outcome: "needs_review" });
    const result = finalized.result as Record<string, unknown>;
    expect(result.productEvidence).toBe("supporting");
    expect(result.originEvidence).toBe("supporting");
    expect(result.indiaOrigin).toBe("supporting");
  });

  it("multiple origin countries observed for the same company + HS6 are all preserved in evidence text", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const evidence = ((state.finalized[0]!.result as Record<string, unknown>).evidence ?? {}) as Record<string, unknown>;
    const coverage = String(evidence.coverageExplanation ?? "");
    expect(coverage).toMatch(/IND/);
    expect(coverage).toMatch(/CHN/);
  });

  it("origin country from a DIFFERENT company row never leaks into candidate evidence", async () => {
    const snapshot = cidSnapshot({
      normalized_rows: [
        { hs6: "090421", originCountry: "CHN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
        { hs6: "090421", originCountry: "IND", companyName: "SOMEONE ELSE INC.", province: "QC", city: "Montréal" },
      ] as unknown as SnapshotRow["normalized_rows"],
    });
    const { state, writer } = writerFor({ fresh: snapshot });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.indiaOrigin).toBe("not_verified");
    const evidence = (result.evidence ?? {}) as Record<string, unknown>;
    expect(String(evidence.coverageExplanation)).toContain("CHN");
    expect(String(evidence.coverageExplanation)).not.toMatch(/HS6:.*IND/);
  });

  it("shipmentEvidence stays 'not_verified' for every CID outcome", async () => {
    for (const preset of [cidSnapshot(), cidSnapshot({ normalized_rows: [] as unknown as SnapshotRow["normalized_rows"] })]) {
      const { state, writer } = writerFor({ fresh: preset });
      await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
      const result = state.finalized[0]!.result as Record<string, unknown>;
      expect(result.shipmentEvidence).toBe("not_verified");
    }
  });

  it("sourcesChecked = 1 for cache-hit CID execution; automatic spend stays ₹0", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.sourcesChecked).toBe(1);
    expect(result.automaticSpendRupees).toBe(0);
  });

  it("cancellation requested before match → finalize as 'cancelled' with sourcesChecked 0", async () => {
    const { state, writer } = writerFor({ fresh: cidSnapshot() });
    // Flip cancellation flag AFTER attempt path completes.
    const w = writer as unknown as { isCancellationRequested: ReturnType<typeof vi.fn> };
    w.isCancellationRequested
      .mockResolvedValueOnce(false)   // preamble
      .mockResolvedValueOnce(false)   // pre-attempt
      .mockResolvedValueOnce(true);   // pre-match
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(state.finalized[0]).toMatchObject({ status: "cancelled", outcome: "cancelled" });
  });
});

describe("BI4F 2B — routing regressions (FDA path preserved byte-identically)", () => {
  it("US candidate + FDA plan continues to dispatch through processFdaFsvpPlan", async () => {
    // Reusing writerFor with an FDA-shaped plan.
    const fdaSnapshot: SnapshotRow = {
      id: "snapshot-us", provider_id: "fda-fsvp", dataset_id: "fsvp-participant-list",
      published_period: "April 1, 2026 – June 30, 2026",
      source_url: "https://www.fda.gov/media/186093/download",
      material_hash: "h-us", retrieved_at: NOW.toISOString(), expires_at: "2026-12-31T00:00:00Z",
      row_count: 1,
      normalized_rows: [{ companyName: "IBERIA FOODS CORP.", stateCode: "FL" }] as unknown as SnapshotRow["normalized_rows"],
    };
    const { state, writer } = writerFor({
      fresh: undefined, plan: { id: "plan-us", provider_id: "fda-fsvp", cost_class: "free", automatic_spend_rupees: 0 },
      candidate: {
        id: "candidate-us", companyName: "Iberia Foods Corp.",
        country: "United States", city: "Miami, FL 33122",
        industry: "Food", isImporter: true, discoveryStatus: "ready", reviewStatus: "pending",
      },
    });
    // Override FDA fresh probe to return a snapshot.
    (writer as unknown as { getFreshSnapshot: ReturnType<typeof vi.fn> }).getFreshSnapshot.mockResolvedValue(fdaSnapshot);
    const outcome = await processTradeResearchJob(
      writer,
      job({ country_code: "US", product_id: "guntur-dry-red-chilli" }),
      "worker-a", () => NOW,
    );
    expect(outcome).toBe("completed");
    // FDA path emits provider_id "fda-fsvp" on its attempt-start event.
    expect(state.events.some((e) => e.event === "provider_attempt_started" && e.providerId === "fda-fsvp")).toBe(true);
  });

  it("unrecognised provider_id → finalize as unsupported_coverage (safe default)", async () => {
    const { state, writer } = writerFor({
      fresh: cidSnapshot(),
      plan: { id: "plan-x", provider_id: "unknown-provider", cost_class: "free", automatic_spend_rupees: 0 },
    });
    const outcome = await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(outcome).toBe("completed");
    expect(state.finalized[0]).toMatchObject({ status: "completed", outcome: "unsupported_coverage" });
    // Never fires a CID or FDA provider_attempt_started event.
    expect(state.events.filter((e) => e.event === "provider_attempt_started")).toHaveLength(0);
  });
});

// silence unused-import
void fdaXlsxBytes;
