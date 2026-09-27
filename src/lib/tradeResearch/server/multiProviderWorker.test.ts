import { describe, expect, it, vi } from "vitest";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import type { InternalJobRow, SnapshotRow, TradeResearchWriter } from "../repository";
import { aggregateProviderEvidence, processTradeResearchJob } from "./worker";
import type { TradeResearchSourceEvidence } from "../types";

const NOW = new Date("2026-09-28T12:00:00Z");

function job(over: Partial<InternalJobRow> = {}): InternalJobRow {
  return {
    id: "job-us", batch_id: "batch-us", workspace_id: "workspace-us", candidate_id: "candidate-us",
    product_id: "guntur-dry-red-chilli", country_code: "US",
    status: "running", stage: "preparing_identity", revision: 1, ...over,
  };
}

function ltFoods(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: "candidate-us", companyName: "LT Foods Americas",
    country: "United States", city: "Cypress, CA 90630",
    industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
    ...over,
  };
}

function fsvpSnapshot(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snap-fsvp", provider_id: "fda-fsvp", dataset_id: "fsvp-participant-list",
    published_period: "April 1, 2026 – June 30, 2026",
    source_url: "https://www.fda.gov/media/186093/download",
    material_hash: "h-fsvp", retrieved_at: NOW.toISOString(), expires_at: "2026-12-31T00:00:00Z",
    row_count: 2,
    normalized_rows: [
      { companyName: "LT FOODS AMERICAS", stateCode: "CA" },
      { companyName: "OTHER FIRM", stateCode: "FL" },
    ] as unknown as SnapshotRow["normalized_rows"],
    ...over,
  };
}

function vqipSnapshot(over: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snap-vqip", provider_id: "fda-vqip", dataset_id: "fda-vqip-participant-list",
    published_period: "FY2026 (10/1/2025 – 9/30/2026)",
    source_url: "https://www.fda.gov/food/importing-food-products-united-states/voluntary-qualified-importer-program-vqip-public-list-approved-vqip-importers",
    material_hash: "h-vqip", retrieved_at: NOW.toISOString(), expires_at: "2027-04-01T00:00:00Z",
    row_count: 2,
    normalized_rows: [
      { firmName: "LT Foods Americas", stateCode: "CA", address: "11130 Warland Dr, Cypress, CA 90630-5302 US" },
      { firmName: "Costco Wholesale Corporation", stateCode: "WA", address: "999 Lake Dr, Issaquah, WA 98027-8990 US" },
    ] as unknown as SnapshotRow["normalized_rows"],
    ...over,
  };
}

interface Fixture {
  writer: TradeResearchWriter;
  state: {
    finalized: Array<{ status: string; outcome: string; result: unknown }>;
    events: Array<{ event: string; payload: Record<string, unknown> }>;
    attempts: Array<{ id: string; patch: Record<string, unknown> }>;
    startedAttempts: string[];
    reconciled: Array<{ id: string; safe_error_code: string }>;
    saveCalls: Array<Record<string, unknown>>;
  };
}

function makeFixture(opts: {
  plans: Array<{ provider_id: string; id: string; sequence?: number }>;
  fdaFresh?: SnapshotRow;
  vqipFresh?: SnapshotRow;
  cidFresh?: SnapshotRow;
  candidate?: BuyerCandidate;
  latestAttempt?: (planId: string) => Record<string, unknown> | undefined;
  vqipLoadThrows?: unknown;
}): Fixture {
  const state: Fixture["state"] = { finalized: [], events: [], attempts: [], startedAttempts: [], reconciled: [], saveCalls: [] };
  const writer = {
    isCancellationRequested: vi.fn(async () => false),
    advance: vi.fn(async (row: InternalJobRow, _w: string, stage: InternalJobRow["stage"]) => ({ ...row, stage, revision: row.revision + 1 })),
    getEligiblePlan: vi.fn(async () => opts.plans[0] ? { ...opts.plans[0], cost_class: "free", automatic_spend_rupees: 0 } : undefined),
    getEligiblePlans: vi.fn(async () => opts.plans.map((p) => ({ ...p, cost_class: "free", automatic_spend_rupees: 0 }))),
    latestAttempt: vi.fn(async (planId: string) => opts.latestAttempt?.(planId)),
    reconcileStaleAttempt: vi.fn(async (_job: InternalJobRow, _worker: string, id: string, safe: string) => { state.reconciled.push({ id, safe_error_code: safe }); }),
    startAttempt: vi.fn(async (_row: InternalJobRow, planId: string, n: number) => {
      const id = `attempt-${planId}-${n}`;
      state.startedAttempts.push(id);
      return { id, attempt_number: n };
    }),
    finishAttempt: vi.fn(async (_job: InternalJobRow, _worker: string, id: string, patch: Record<string, unknown>) => { state.attempts.push({ id, patch }); }),
    appendEvent: vi.fn(async (_r: InternalJobRow, event: string, payload: Record<string, unknown>) => { state.events.push({ event, payload }); }),
    release: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1, lease_owner: null })),
    heartbeat: vi.fn(async (row: InternalJobRow) => ({ ...row, revision: row.revision + 1 })),
    finalize: vi.fn(async (row: InternalJobRow, _w: string, status: InternalJobRow["status"], outcome: string, result: unknown) => {
      state.finalized.push({ status, outcome, result });
      return { ...row, status, stage: "complete", outcome, revision: row.revision + 1, lease_owner: null };
    }),
    getFreshSnapshot: vi.fn(async () => opts.fdaFresh),
    getLatestSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async (providerId: string) =>
      providerId === "fda-vqip" ? opts.vqipFresh :
      providerId === "canada-cid" ? opts.cidFresh :
      opts.fdaFresh),
    getLatestSnapshotByProvider: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => { state.saveCalls.push(input); return { id: "new", ...input } as SnapshotRow; }),
    refreshSnapshotExpiry: vi.fn(async () => undefined),
    getCandidate: vi.fn(async () => opts.candidate ?? ltFoods()),
  };
  return { writer: writer as unknown as TradeResearchWriter, state };
}

describe("BI4F 2C — multi-provider execution (US: FSVP + VQIP)", () => {
  it("US candidate + FSVP + VQIP both cache-hit → both attempts skipped_cached, sourcesChecked=2, sources[] length 2", async () => {
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: fsvpSnapshot(), vqipFresh: vqipSnapshot(),
    });
    const outcome = await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    expect(outcome).toBe("completed");
    expect(state.finalized).toHaveLength(1);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.sourcesChecked).toBe(2);
    const sources = result.sources as TradeResearchSourceEvidence[];
    expect(sources.map((s) => s.providerId).sort()).toEqual(["fda-fsvp", "fda-vqip"]);
    expect(sources.every((s) => s.outcome === "cache_hit")).toBe(true);
    // Both are strong matches → aggregate identity = verified_identity
    const aggregate = result.aggregate as { identity: string; sourcesCorroborating: number };
    expect(aggregate.identity).toBe("verified_identity");
    expect(aggregate.sourcesCorroborating).toBe(2);
    // Job finalized as corroboration.
    expect(state.finalized[0]).toMatchObject({ status: "completed", outcome: "official_importer_program_corroboration" });
  });

  it("US candidate: FSVP no-match + VQIP verified → single_source_support, sourcesChecked=2, evidence preserved per source", async () => {
    const noMatchFsvp = fsvpSnapshot({
      normalized_rows: [{ companyName: "SOMEONE ELSE", stateCode: "TX" }] as unknown as SnapshotRow["normalized_rows"],
    });
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: noMatchFsvp, vqipFresh: vqipSnapshot(),
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.sourcesChecked).toBe(2);
    const sources = result.sources as TradeResearchSourceEvidence[];
    const fsvpEv = sources.find((s) => s.providerId === "fda-fsvp")!;
    const vqipEv = sources.find((s) => s.providerId === "fda-vqip")!;
    expect(fsvpEv.companyEvidence).toBe("no_verified_match");
    expect(vqipEv.companyEvidence).toBe("verified");
    // Aggregate: single verified source.
    expect((result.aggregate as { identity: string }).identity).toBe("single_source_support");
    // Top-level projection: strong from VQIP → officialProgramEvidence verified.
    expect(result.officialProgramEvidence).toBe("verified");
  });

  it("US candidate: both providers no-match → no_evidence aggregate, sourcesChecked=2, outcome=no_verified_evidence", async () => {
    const empty = fsvpSnapshot({ normalized_rows: [] as unknown as SnapshotRow["normalized_rows"] });
    const emptyVqip = vqipSnapshot({ normalized_rows: [] as unknown as SnapshotRow["normalized_rows"] });
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: empty, vqipFresh: emptyVqip,
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    expect(result.sourcesChecked).toBe(2);
    expect((result.aggregate as { identity: string }).identity).toBe("no_evidence");
    expect(result.officialProgramEvidence).toBe("no_verified_match");
    expect(state.finalized[0]!.outcome).toBe("no_verified_evidence");
  });

  it("VQIP with conflicting state → verified FSVP + rejected VQIP → aggregate is single_source_support (VQIP contributes no_verified_match)", async () => {
    // VQIP has our company but under a conflicting state.
    const conflictingVqip = vqipSnapshot({
      normalized_rows: [
        { firmName: "LT Foods Americas", stateCode: "NY", address: "wrong state" },
      ] as unknown as SnapshotRow["normalized_rows"],
    });
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: fsvpSnapshot(), vqipFresh: conflictingVqip,
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    const sources = result.sources as TradeResearchSourceEvidence[];
    const vqipEv = sources.find((s) => s.providerId === "fda-vqip")!;
    // Matcher returns 'rejected' → we map that to no_verified_match.
    expect(vqipEv.companyEvidence).toBe("no_verified_match");
    // FSVP is verified, VQIP no-match → single_source_support.
    expect((result.aggregate as { identity: string }).identity).toBe("single_source_support");
    // NO strongest-positive-wins overwrite: FSVP's verified stays verified, VQIP's no_verified_match stays no_verified_match.
    const fsvpEv = sources.find((s) => s.providerId === "fda-fsvp")!;
    expect(fsvpEv.companyEvidence).toBe("verified");
  });

  it("stale attempt on VQIP-only doesn't corrupt FSVP attempt state (per-provider reconciliation)", async () => {
    const staleVqip = {
      id: "attempt-vqip-stale", attempt_number: 1, state: "running",
      lease_owner: "inline-killed", lease_expires_at: "2026-09-27T01:15:23Z", safe_error_code: null,
    };
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: fsvpSnapshot(), vqipFresh: vqipSnapshot(),
      latestAttempt: (planId) => planId === "plan-vqip" ? staleVqip : undefined,
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    // Only the VQIP stale attempt got reconciled.
    expect(state.reconciled).toEqual([{ id: "attempt-vqip-stale", safe_error_code: "STALE_LEASE_RECOVERED" }]);
    // FSVP attempt was still created (as attempt #1).
    expect(state.startedAttempts.some((id) => id.startsWith("attempt-plan-fsvp-"))).toBe(true);
    // Result finalized normally.
    expect(state.finalized).toHaveLength(1);
  });

  it("independent attempt numbers: each provider owns its own attempt sequence", async () => {
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: fsvpSnapshot(), vqipFresh: vqipSnapshot(),
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    // Cache-hit path with NO previous attempt still inserts a new
    // attempt row that will be marked `skipped_cached`. Verify both
    // providers own attempt #1 independently (different plan-ids).
    expect(state.startedAttempts.sort()).toEqual(["attempt-plan-fsvp-1", "attempt-plan-vqip-1"]);
  });

  it("Canada CID single-plan candidate is byte-identical to Phase 2B (no multi-provider dispatch)", async () => {
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "canada-cid", id: "plan-cid" }],
      cidFresh: {
        id: "snap-cid", provider_id: "canada-cid", dataset_id: "cid-major-importers-by-hs6-by-country",
        published_period: "2020", source_url: "https://ised-isde.canada.ca/x.csv",
        material_hash: "h-cid", retrieved_at: NOW.toISOString(), expires_at: "2027-01-01T00:00:00Z",
        row_count: 1,
        normalized_rows: [
          { hs6: "090421", originCountry: "IN", companyName: "LOBLAW COMPANIES LIMITED", province: "ON", city: "Brampton" },
        ] as unknown as SnapshotRow["normalized_rows"],
      },
      candidate: {
        id: "candidate-ca", companyName: "Loblaw Companies Limited",
        country: "Canada", city: "Brampton, ON L6Y 5S5",
        industry: "Food", isImporter: true,
        discoveryStatus: "ready", reviewStatus: "pending",
      },
    });
    await processTradeResearchJob(
      writer,
      job({ country_code: "CA", candidate_id: "candidate-ca" }),
      "worker-a", () => NOW,
    );
    const result = state.finalized[0]!.result as Record<string, unknown>;
    // Single-provider CA path: sources[] should NOT be present (Phase 2B contract),
    // and evidence.source stays 'Canadian Importers Database'.
    expect(result.sources).toBeUndefined();
    const evidence = result.evidence as { source: string };
    expect(evidence.source).toBe("Canadian Importers Database");
  });
});

describe("BI4F 2C — aggregation function is deterministic and never overwrites per-source", () => {
  const mk = (over: Partial<TradeResearchSourceEvidence>): TradeResearchSourceEvidence => ({
    providerId: "fda-fsvp",
    outcome: "completed",
    source: "FDA FSVP",
    datasetPeriod: "test", retrievedAt: NOW.toISOString(),
    matchedSourceName: undefined, matchedState: undefined,
    candidateName: "Test", candidateState: undefined,
    identityDecision: "strong",
    matchReason: "test", coverageExplanation: "test",
    companyEvidence: "verified", productEvidence: "not_available",
    originEvidence: "not_available", shipmentEvidence: "not_verified",
    attribution: "test",
    ...over,
  });

  it("two verified sources + no geography conflict → verified_identity", () => {
    const agg = aggregateProviderEvidence([
      mk({ providerId: "fda-fsvp", matchedState: "CA" }),
      mk({ providerId: "fda-vqip", matchedState: "CA", source: "FDA VQIP" }),
    ]);
    expect(agg.identity).toBe("verified_identity");
    expect(agg.sourcesCorroborating).toBe(2);
  });

  it("two verified sources + conflicting state → conflicting_evidence", () => {
    const agg = aggregateProviderEvidence([
      mk({ providerId: "fda-fsvp", matchedState: "CA" }),
      mk({ providerId: "fda-vqip", matchedState: "NY", source: "FDA VQIP" }),
    ]);
    expect(agg.identity).toBe("conflicting_evidence");
  });

  it("one verified + one no_verified_match → single_source_support", () => {
    const agg = aggregateProviderEvidence([
      mk({ providerId: "fda-fsvp", companyEvidence: "verified", matchedState: "CA" }),
      mk({ providerId: "fda-vqip", companyEvidence: "no_verified_match", source: "FDA VQIP" }),
    ]);
    expect(agg.identity).toBe("single_source_support");
    expect(agg.sourcesCorroborating).toBe(1);
  });

  it("two supporting sources → multi_source_support", () => {
    const agg = aggregateProviderEvidence([
      mk({ providerId: "fda-fsvp", companyEvidence: "supporting" }),
      mk({ providerId: "fda-vqip", companyEvidence: "supporting", source: "FDA VQIP" }),
    ]);
    expect(agg.identity).toBe("multi_source_support");
  });

  it("one supporting only → needs_review", () => {
    const agg = aggregateProviderEvidence([
      mk({ providerId: "fda-fsvp", companyEvidence: "supporting" }),
    ]);
    expect(agg.identity).toBe("needs_review");
  });

  it("all no_verified_match → no_evidence with 'not evidence that the company does not import' reason", () => {
    const agg = aggregateProviderEvidence([
      mk({ providerId: "fda-fsvp", companyEvidence: "no_verified_match" }),
      mk({ providerId: "fda-vqip", companyEvidence: "no_verified_match", source: "FDA VQIP" }),
    ]);
    expect(agg.identity).toBe("no_evidence");
    expect(agg.reason).toMatch(/not evidence that the company does not import/i);
  });

  it("empty sources array → no_evidence", () => {
    const agg = aggregateProviderEvidence([]);
    expect(agg.identity).toBe("no_evidence");
    expect(agg.sourcesEvaluated).toBe(0);
  });

  it("aggregation is a pure function — never mutates input sources", () => {
    const sources: TradeResearchSourceEvidence[] = [
      mk({ providerId: "fda-fsvp", matchedState: "CA" }),
      mk({ providerId: "fda-vqip", matchedState: "CA", source: "FDA VQIP" }),
    ];
    const snapshot = JSON.stringify(sources);
    aggregateProviderEvidence(sources);
    expect(JSON.stringify(sources)).toBe(snapshot);
  });
});

describe("BI4F 2C — cross-source inference safety", () => {
  it("a rejected CID source stays source-local no-match when another provider verifies the company", () => {
    const evidence = (over: Partial<TradeResearchSourceEvidence>): TradeResearchSourceEvidence => ({
      providerId: "fda-fsvp",
      outcome: "completed",
      source: "FDA FSVP",
      datasetPeriod: "test",
      retrievedAt: NOW.toISOString(),
      candidateName: "Test",
      identityDecision: "strong",
      matchReason: "test",
      coverageExplanation: "test",
      companyEvidence: "verified",
      productEvidence: "not_available",
      originEvidence: "not_available",
      shipmentEvidence: "not_verified",
      attribution: "test",
      ...over,
    });
    const rejectedCid = evidence({
      providerId: "canada-cid",
      source: "Canadian Importers Database",
      identityDecision: "rejected",
      matchedState: "BC",
      companyEvidence: "no_verified_match",
      productEvidence: "no_verified_match",
      originEvidence: "no_verified_match",
    });
    const verifiedFsvp = evidence({
      providerId: "fda-fsvp",
      source: "FDA FSVP",
      identityDecision: "strong",
      matchedState: "ON",
      companyEvidence: "verified",
    });

    const aggregate = aggregateProviderEvidence([rejectedCid, verifiedFsvp]);

    expect(aggregate.identity).toBe("single_source_support");
    expect(aggregate.sourcesCorroborating).toBe(1);
    expect(rejectedCid).toMatchObject({
      identityDecision: "rejected",
      companyEvidence: "no_verified_match",
      productEvidence: "no_verified_match",
      originEvidence: "no_verified_match",
    });
  });

  it("VQIP has no product data → sources[].productEvidence is 'not_available' regardless of FSVP", async () => {
    const { writer, state } = makeFixture({
      plans: [{ provider_id: "fda-fsvp", id: "plan-fsvp" }, { provider_id: "fda-vqip", id: "plan-vqip" }],
      fdaFresh: fsvpSnapshot(), vqipFresh: vqipSnapshot(),
    });
    await processTradeResearchJob(writer, job(), "worker-a", () => NOW);
    const result = state.finalized[0]!.result as Record<string, unknown>;
    const sources = result.sources as TradeResearchSourceEvidence[];
    for (const s of sources) {
      expect(s.productEvidence).toBe("not_available");
      expect(s.originEvidence).toBe("not_available");
      expect(s.shipmentEvidence).toBe("not_verified");
    }
  });
});
