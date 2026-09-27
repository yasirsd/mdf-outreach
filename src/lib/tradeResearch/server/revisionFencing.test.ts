import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";

import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  TradeResearchLeaseLostError,
  type InternalJobRow,
  type SnapshotRow,
  type TradeResearchWriter,
} from "../repository";
import { drainTradeResearch, processTradeResearchJob } from "./worker";

const NOW = new Date("2026-09-28T12:00:00Z");

function fsvpXlsx(): Uint8Array {
  const shared = [
    "Foreign Supplier Verification Programs - List of Participants (Name and State Only) April 1, 2026 – June 30, 2026",
    "Firm Legal Name", "State Code", "LT FOODS AMERICAS", "CA",
  ];
  return zipSync({
    "xl/sharedStrings.xml": strToU8(`<sst>${shared.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData><row><c r=\"B1\" t=\"s\"><v>0</v></c></row><row><c r=\"B2\" t=\"s\"><v>1</v></c><c r=\"C2\" t=\"s\"><v>2</v></c></row><row><c r=\"B3\" t=\"s\"><v>3</v></c><c r=\"C3\" t=\"s\"><v>4</v></c></row></sheetData></worksheet>"),
  });
}

function vqipHtml(): Uint8Array {
  return new TextEncoder().encode(`<!DOCTYPE html><html><body>
    <p>Publicly available list of approved VQIP importers for fiscal year 2026 (FY2026) Benefit Period (10/1/2025 to 9/30/2026).</p>
    <table><thead><tr><th>Firm Name</th><th>Address</th><th>Email</th><th>Website</th></tr></thead>
    <tbody><tr><td>LT Foods Americas</td><td>11130 Warland Dr, Cypress, CA 90630 US</td><td>x@example.com</td><td>https://example.com</td></tr></tbody></table>
  </body></html>`);
}

function candidate(): BuyerCandidate {
  return {
    id: "candidate", companyName: "LT Foods Americas", country: "United States",
    city: "Cypress, CA 90630", industry: "Food", isImporter: true,
    discoveryStatus: "ready", reviewStatus: "pending",
  };
}

type Attempt = { id: string; jobId: string; owner: string | null; state: string };

function strictCasFixture(providerIds: string[] = ["fda-fsvp", "fda-vqip"]) {
  let databaseJob: InternalJobRow = {
    id: "job", batch_id: "batch", workspace_id: "workspace", candidate_id: "candidate",
    product_id: "guntur-dry-red-chilli", country_code: "US", status: "queued",
    stage: "preparing_identity", revision: 0, lease_owner: null,
  };
  let claimed = false;
  let loseOnHeartbeat = false;
  const attempts = new Map<string, Attempt>();
  const calls = {
    heartbeatExpected: [] as number[], advanceExpected: [] as number[], releaseExpected: [] as number[],
    finalizeExpected: [] as number[], startAttemptExpected: [] as number[], finishAttemptExpected: [] as number[],
    reconcileExpected: [] as number[], recover: 0,
  };

  function assertOwner(row: InternalJobRow, worker: string, statuses = ["running", "cancel_requested"]): void {
    if (row.id !== databaseJob.id
      || row.revision !== databaseJob.revision
      || databaseJob.lease_owner !== worker
      || !statuses.includes(databaseJob.status)) {
      throw new TradeResearchLeaseLostError();
    }
  }

  function revised(patch: Partial<InternalJobRow>): InternalJobRow {
    databaseJob = { ...databaseJob, ...patch, revision: databaseJob.revision + 1 };
    return { ...databaseJob };
  }

  const writer = {
    claim: vi.fn(async (worker: string) => {
      if (claimed) return undefined;
      claimed = true;
      databaseJob = { ...databaseJob, status: "running", lease_owner: worker, revision: databaseJob.revision + 1 };
      return { ...databaseJob };
    }),
    heartbeat: vi.fn(async (row: InternalJobRow, worker: string) => {
      calls.heartbeatExpected.push(row.revision);
      if (loseOnHeartbeat) {
        loseOnHeartbeat = false;
        revised({ lease_owner: "worker-b", status: "running" });
      }
      assertOwner(row, worker);
      return revised({});
    }),
    advance: vi.fn(async (row: InternalJobRow, worker: string, stage: InternalJobRow["stage"]) => {
      calls.advanceExpected.push(row.revision);
      assertOwner(row, worker, ["running"]);
      return revised({ stage });
    }),
    release: vi.fn(async (row: InternalJobRow, worker: string) => {
      calls.releaseExpected.push(row.revision);
      assertOwner(row, worker, ["running"]);
      return revised({ lease_owner: null });
    }),
    finalize: vi.fn(async (row: InternalJobRow, worker: string, status: InternalJobRow["status"], outcome: string, result: { automaticSpendRupees: number }) => {
      calls.finalizeExpected.push(row.revision);
      assertOwner(row, worker);
      if (result.automaticSpendRupees !== 0) throw new Error("AUTOMATIC_SPEND_MUST_REMAIN_ZERO");
      return revised({ status, stage: "complete", outcome, lease_owner: null });
    }),
    getEligiblePlan: vi.fn(async () => ({ id: `plan-${providerIds[0]}`, provider_id: providerIds[0], cost_class: "free", automatic_spend_rupees: 0 })),
    getEligiblePlans: vi.fn(async () => providerIds.map((providerId, index) => ({
      id: `plan-${providerId}`, provider_id: providerId, sequence: index + 1,
      cost_class: "free", automatic_spend_rupees: 0,
    }))),
    latestAttempt: vi.fn(async () => undefined),
    startAttempt: vi.fn(async (row: InternalJobRow, planId: string, attemptNumber: number, worker: string) => {
      calls.startAttemptExpected.push(row.revision);
      assertOwner(row, worker, ["running"]);
      const attempt = { id: `attempt-${planId}-${attemptNumber}`, jobId: row.id, owner: worker, state: "running" };
      attempts.set(attempt.id, attempt);
      return { id: attempt.id, attempt_number: attemptNumber };
    }),
    finishAttempt: vi.fn(async (row: InternalJobRow, worker: string, id: string, patch: Record<string, unknown>) => {
      calls.finishAttemptExpected.push(row.revision);
      assertOwner(row, worker);
      const attempt = attempts.get(id);
      if (!attempt || attempt.jobId !== row.id || attempt.owner !== worker || attempt.state !== "running") {
        throw new TradeResearchLeaseLostError();
      }
      attempt.state = String(patch.state);
      attempt.owner = null;
    }),
    reconcileStaleAttempt: vi.fn(async (row: InternalJobRow, worker: string, id: string) => {
      calls.reconcileExpected.push(row.revision);
      assertOwner(row, worker, ["running"]);
      const attempt = attempts.get(id);
      if (attempt?.state === "running") {
        attempt.state = "failed_retryable";
        attempt.owner = null;
      }
    }),
    appendEvent: vi.fn(async (row: InternalJobRow) => {
      assertOwner(row, String(databaseJob.lease_owner));
    }),
    isCancellationRequested: vi.fn(async () => false),
    getFreshSnapshot: vi.fn(async () => undefined),
    getLatestSnapshot: vi.fn(async () => undefined),
    getFreshSnapshotByProvider: vi.fn(async () => undefined),
    getLatestSnapshotByProvider: vi.fn(async () => undefined),
    saveSnapshot: vi.fn(async (input: Record<string, unknown>) => ({ id: `snapshot-${String(input.provider_id)}`, ...input } as SnapshotRow)),
    refreshSnapshotExpiry: vi.fn(async () => { throw new Error("unexpected refresh"); }),
    getCandidate: vi.fn(async () => candidate()),
    recoverClaimedJob: vi.fn(async () => { calls.recover += 1; return "lease_lost" as const; }),
  };

  return {
    writer: writer as unknown as TradeResearchWriter,
    calls,
    attempts,
    currentJob: () => ({ ...databaseJob }),
    reclaim(worker = "worker-b") { return revised({ lease_owner: worker, status: "running" }); },
    loseNextHeartbeat() { loseOnHeartbeat = true; },
  };
}

function providerFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("vqip")) return new Response(vqipHtml(), { status: 200, headers: { "content-type": "text/html" } });
    return new Response(fsvpXlsx(), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  }) as unknown as typeof fetch;
}

afterEach(() => { vi.useRealTimers(); });

describe("T02 strict revision-CAS worker contract", () => {
  it("finalize uses the current revision, increments it, and rejects wrong owner or stale revision", async () => {
    const fixture = strictCasFixture(["fda-fsvp"]);
    const owned = await fixture.writer.claim("worker-a");
    const finalized = await fixture.writer.finalize(owned!, "worker-a", "completed", "no_verified_evidence", {
      officialProgramEvidence: "not_checked", productEvidence: "not_available", indiaOrigin: "not_verified",
      originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0, automaticSpendRupees: 0,
    });
    expect(finalized.revision).toBe(2);

    const wrongOwner = strictCasFixture(["fda-fsvp"]);
    const wrongOwned = await wrongOwner.writer.claim("worker-a");
    await expect(wrongOwner.writer.finalize(wrongOwned!, "worker-b", "completed", "no_verified_evidence", {
      officialProgramEvidence: "not_checked", productEvidence: "not_available", indiaOrigin: "not_verified",
      originEvidence: "not_available", shipmentEvidence: "not_verified", sourcesChecked: 0, automaticSpendRupees: 0,
    })).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
  });

  it("fences every old-worker mutation after another worker reclaims the job", async () => {
    const fixture = strictCasFixture(["fda-fsvp"]);
    const revision1 = (await fixture.writer.claim("worker-a"))!;
    const attempt = await fixture.writer.startAttempt(revision1, "plan-fsvp", 1, "worker-a");
    const revision2 = await fixture.writer.heartbeat(revision1, "worker-a");
    fixture.reclaim("worker-b");

    const result = {
      officialProgramEvidence: "not_checked" as const, productEvidence: "not_available" as const,
      indiaOrigin: "not_verified" as const, originEvidence: "not_available" as const,
      shipmentEvidence: "not_verified" as const, sourcesChecked: 0, automaticSpendRupees: 0 as const,
    };
    await expect(fixture.writer.heartbeat(revision2, "worker-a")).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    await expect(fixture.writer.advance(revision2, "worker-a", "planning_sources")).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    await expect(fixture.writer.release(revision2, "worker-a", NOW.toISOString())).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    await expect(fixture.writer.finalize(revision2, "worker-a", "completed", "no_verified_evidence", result)).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    await expect(fixture.writer.finishAttempt(revision2, "worker-a", String(attempt.id), { state: "completed" })).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    await expect(fixture.writer.reconcileStaleAttempt(revision2, "worker-a", String(attempt.id), "STALE_LEASE_RECOVERED")).rejects.toBeInstanceOf(TradeResearchLeaseLostError);
    expect(fixture.attempts.get(String(attempt.id))?.state).toBe("running");
  });

  it("carries authoritative heartbeat revisions from FSVP into VQIP and terminal finalization", async () => {
    const fixture = strictCasFixture();
    const claimed = (await fixture.writer.claim("worker-a"))!;
    await expect(processTradeResearchJob(fixture.writer, claimed, "worker-a", () => NOW, providerFetch()))
      .resolves.toBe("completed");

    expect(fixture.calls.startAttemptExpected).toEqual([3, 4]);
    expect(fixture.calls.heartbeatExpected).toEqual([3, 4]);
    expect(fixture.calls.finishAttemptExpected).toEqual([4, 5]);
    expect(fixture.calls.finalizeExpected).toEqual([6]);
    expect(fixture.currentJob()).toMatchObject({ status: "completed", revision: 7, lease_owner: null });
  });

  it("runtime-budget release uses the final heartbeat revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    const fixture = strictCasFixture(["fda-fsvp"]);
    const claimed = (await fixture.writer.claim("worker-a"))!;
    const started = Date.now();
    const fetchImpl = vi.fn(async () => {
      vi.setSystemTime(started + 40_000);
      return new Response(fsvpXlsx(), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }) as unknown as typeof fetch;

    await expect(processTradeResearchJob(
      fixture.writer, claimed, "worker-a", () => new Date(Date.now()), fetchImpl, undefined, started + 50_000,
    )).resolves.toBe("retry");
    expect(fixture.calls.heartbeatExpected).toEqual([3]);
    expect(fixture.calls.releaseExpected).toEqual([4]);
    expect(fixture.currentJob()).toMatchObject({ revision: 5, lease_owner: null });
  });

  it("heartbeat lease loss stops the drain without attempt completion, release, finalize, or recovery", async () => {
    const fixture = strictCasFixture(["fda-fsvp"]);
    fixture.loseNextHeartbeat();
    const result = await drainTradeResearch({
      writer: fixture.writer, workerId: "worker-a", maxJobs: 1, now: () => NOW, fetchImpl: providerFetch(),
    });
    expect(result).toMatchObject({ claimed: 1, processed: 0, completed: 0, requeued: 0, failed: 0 });
    expect(fixture.calls.finishAttemptExpected).toEqual([]);
    expect(fixture.calls.releaseExpected).toEqual([]);
    expect(fixture.calls.finalizeExpected).toEqual([]);
    expect(fixture.calls.recover).toBe(0);
  });
});
