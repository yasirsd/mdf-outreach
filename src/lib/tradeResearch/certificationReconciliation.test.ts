import { describe, expect, it, vi } from "vitest";

import {
  reconcilePendingResearchCertifications,
  type CertificationReconciliationWriter,
} from "./certification";

/**
 * T12 reliability — the post-finalize certification hook is
 * best-effort. When a transient DB failure prevents the initial
 * insert, this reconciliation service picks up the finalized job on
 * the next drain and certifies it without touching providers or the
 * terminal job.
 */

function baseJob(id: string): { id: string } & Record<string, unknown> {
  return {
    id,
    workspace_id: "11111111-1111-4111-8111-111111111111",
    candidate_id: "22222222-2222-4222-8222-222222222222",
    product_id: "guntur-dry-red-chilli",
    country_code: "US",
    requested_goal: "screen_trade_activity",
    status: "completed",
    stage: "complete",
    revision: 5,
    outcome: "official_importer_program_corroboration",
    research_context: {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      candidateId: "22222222-2222-4222-8222-222222222222",
      marketCountryCode: "US",
      productId: "guntur-dry-red-chilli",
      productForm: null,
      researchGoal: "screen_trade_activity",
      providerPlanVersion: "trade-planner-v1",
      interpretationVersion: "trade-interpretation-v1",
    },
    result_summary: {
      officialProgramEvidence: "verified",
      productEvidence: "not_available",
      originEvidence: "not_available",
      indiaOrigin: "not_verified",
      shipmentEvidence: "not_verified",
      sourcesChecked: 1,
      automaticSpendRupees: 0,
    },
  };
}

describe("T12 reliability — reconciliation of missing certifications", () => {
  it("inserts a missing certification without opening any provider fetch", async () => {
    const list = vi.fn(async () => [{ job: baseJob("job-1"), resultSummary: baseJob("job-1").result_summary }]);
    const certify = vi.fn(async () => ({ outcome: "inserted" as const, status: "certified" as const, snapshotFingerprint: "trcert-v1:aaa" }));
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const writer: CertificationReconciliationWriter = {
        listTerminalJobsMissingCertification: list,
        certifyResearchJob: certify,
      };
      const report = await reconcilePendingResearchCertifications(writer);
      expect(report.inspected).toBe(1);
      expect(report.inserted).toBe(1);
      expect(report.alreadyCertified).toBe(0);
      expect(report.transientFailures).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("is idempotent — a second reconcile pass returns already_certified for the same job", async () => {
    const job = baseJob("job-idem");
    const list = vi.fn(async () => [{ job, resultSummary: job.result_summary }]);
    let calls = 0;
    const certify = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { outcome: "inserted" as const, status: "certified" as const, snapshotFingerprint: "trcert-v1:idem" }
        : { outcome: "already_certified" as const, status: "certified" as const, snapshotFingerprint: "trcert-v1:idem" };
    });
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: list,
      certifyResearchJob: certify,
    };
    const first = await reconcilePendingResearchCertifications(writer);
    expect(first.inserted).toBe(1);
    expect(first.alreadyCertified).toBe(0);
    const second = await reconcilePendingResearchCertifications(writer);
    expect(second.inserted).toBe(0);
    expect(second.alreadyCertified).toBe(1);
  });

  it("classifies deterministic failures as legacy/quarantined (INSERTS row) — NEVER retries them infinitely", async () => {
    const job = baseJob("job-quar");
    const list = vi.fn(async () => [{ job, resultSummary: job.result_summary }]);
    const certify = vi.fn(async () => ({
      outcome: "inserted" as const,
      status: "quarantined" as const,
      snapshotFingerprint: "trcert-v1:quar",
    }));
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: list,
      certifyResearchJob: certify,
    };
    const report = await reconcilePendingResearchCertifications(writer);
    expect(report.quarantined).toBe(1);
    expect(report.inserted).toBe(1);
    // A subsequent reconcile pass sees NO missing certification for
    // this job because the quarantined row exists.
    const emptyList = vi.fn(async () => []);
    const followup = await reconcilePendingResearchCertifications({
      listTerminalJobsMissingCertification: emptyList,
      certifyResearchJob: certify,
    });
    expect(followup.inspected).toBe(0);
    expect(certify).toHaveBeenCalledTimes(1); // Not retried.
  });

  it("legacy_unverified rows are also written on the first pass and never retried", async () => {
    const job = baseJob("job-legacy");
    const list = vi.fn(async () => [{ job, resultSummary: job.result_summary }]);
    const certify = vi.fn(async () => ({
      outcome: "inserted" as const,
      status: "legacy_unverified" as const,
      snapshotFingerprint: "trcert-v1:legacy",
    }));
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: list,
      certifyResearchJob: certify,
    };
    const report = await reconcilePendingResearchCertifications(writer);
    expect(report.legacyUnverified).toBe(1);
    expect(report.inserted).toBe(1);
  });

  it("transient CERTIFY failure is captured in the report and does NOT abort the whole pass", async () => {
    const jobA = baseJob("job-a");
    const jobB = baseJob("job-b");
    const list = vi.fn(async () => [
      { job: jobA, resultSummary: jobA.result_summary },
      { job: jobB, resultSummary: jobB.result_summary },
    ]);
    const certify = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("db down"), { code: "PGRST_TRANSIENT" }))
      .mockResolvedValueOnce({ outcome: "inserted", status: "certified", snapshotFingerprint: "trcert-v1:b" });
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: list,
      certifyResearchJob: certify,
    };
    const report = await reconcilePendingResearchCertifications(writer);
    expect(report.inspected).toBe(2);
    expect(report.inserted).toBe(1); // jobB succeeded
    expect(report.transientFailures).toBe(1); // jobA failed
    expect(report.errors[0]).toEqual({ jobId: "job-a", safeErrorCode: "PGRST_TRANSIENT" });
  });

  it("READER failure is reported as a transient failure and does NOT throw", async () => {
    const list = vi.fn(async () => { throw Object.assign(new Error("db reader"), { code: "PGRST_READ" }); });
    const certify = vi.fn();
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: list,
      certifyResearchJob: certify,
    };
    const report = await reconcilePendingResearchCertifications(writer);
    expect(report.transientFailures).toBe(1);
    expect(report.errors[0].jobId).toBe("<reader>");
    expect(certify).not.toHaveBeenCalled();
  });

  it("bounded — limit clamps the number of jobs inspected per pass", async () => {
    let requestedLimit = 0;
    const list = vi.fn(async (n: number) => { requestedLimit = n; return []; });
    const certify = vi.fn();
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: list,
      certifyResearchJob: certify,
    };
    await reconcilePendingResearchCertifications(writer, { limit: 3 });
    expect(requestedLimit).toBe(3);
    // Excessive limits are clamped to 50.
    await reconcilePendingResearchCertifications(writer, { limit: 500 });
    expect(requestedLimit).toBe(50);
    // Missing/zero limit defaults to 5.
    await reconcilePendingResearchCertifications(writer);
    expect(requestedLimit).toBe(5);
  });

  it("terminal job is NEVER mutated — reconciliation calls only listing + certify; it does not touch job state", async () => {
    const job = baseJob("job-immut");
    const listRead = vi.fn(async () => [{ job, resultSummary: job.result_summary }]);
    const certify = vi.fn(async () => ({ outcome: "inserted" as const, status: "certified" as const, snapshotFingerprint: "trcert-v1:x" }));
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: listRead,
      certifyResearchJob: certify,
    };
    await reconcilePendingResearchCertifications(writer);
    // The mock writer exposes ONLY these two methods; any accidental
    // finalize / release / advance / update call would 'is not a
    // function' — the test would fail. Verify both calls used a
    // read-only pattern.
    expect(listRead).toHaveBeenCalledTimes(1);
    expect(certify).toHaveBeenCalledTimes(1);
  });

  it("automatic spend remains ₹0 — reconciliation opens no network connection at all", async () => {
    const fetchSpy = vi.fn(() => { throw new Error("network prohibited"); });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const job = baseJob("job-zero");
      const writer: CertificationReconciliationWriter = {
        listTerminalJobsMissingCertification: async () => [{ job, resultSummary: job.result_summary }],
        certifyResearchJob: async () => ({ outcome: "inserted", status: "certified", snapshotFingerprint: "trcert-v1:zero" }),
      };
      const report = await reconcilePendingResearchCertifications(writer);
      expect(report.inserted).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("BACKLOG DRAINAGE: 12 missing certs, limit 5 → 5, 5, 2, 0 across four passes", async () => {
    // The mock 'DB' — start with 12 missing terminal jobs, and drain
    // them across repeated passes as if the drain were re-invoked.
    const remaining = Array.from({ length: 12 }, (_, i) => ({
      job: baseJob(`bl-${i + 1}`),
      resultSummary: baseJob(`bl-${i + 1}`).result_summary,
    }));
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: async (limit) => remaining.slice(0, limit),
      certifyResearchJob: async (job) => {
        // Drain: certifying removes it from the remaining set.
        const idx = remaining.findIndex((r) => r.job.id === job.id);
        if (idx >= 0) remaining.splice(idx, 1);
        return { outcome: "inserted", status: "certified", snapshotFingerprint: `trcert-v1:${job.id}` };
      },
    };
    const drained: number[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      const report = await reconcilePendingResearchCertifications(writer, { limit: 5 });
      drained.push(report.inserted);
    }
    expect(drained).toEqual([5, 5, 2, 0]);
    expect(remaining).toEqual([]);
  });

  it("WORKSPACE ISOLATION: reconciliation for workspace A cannot inspect, certify, or be affected by workspace B rows", async () => {
    // The reader's contract already excludes B's already-certified
    // jobs. This test proves the SERVICE layer does not leak B state
    // into A processing: only rows the reader returns are certified,
    // and each cert is written with the JOB's own workspace_id.
    const jobA: { id: string } & Record<string, unknown> = { ...baseJob("wsA-missing"), workspace_id: "wsA" };
    // If the reader mistakenly surfaced a B job here, the certify
    // spy would receive it — the test asserts it does not.
    const seenWorkspaceIds: string[] = [];
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: async () => [{ job: jobA, resultSummary: jobA.result_summary }],
      certifyResearchJob: async (job) => {
        seenWorkspaceIds.push(String((job as unknown as { workspace_id: string }).workspace_id));
        return {
          outcome: "inserted",
          status: "certified",
          snapshotFingerprint: `trcert-v1:${job.id}`,
        };
      },
    };
    const report = await reconcilePendingResearchCertifications(writer);
    expect(report.inserted).toBe(1);
    // The certification write only ever saw workspace A's id.
    expect(seenWorkspaceIds).toEqual(["wsA"]);
  });

  it("onEvent callback fires for inserted / already_certified / error kinds", async () => {
    const jobA = baseJob("evt-a");
    const jobB = baseJob("evt-b");
    const events: Array<{ kind: string; jobId: string }> = [];
    const writer: CertificationReconciliationWriter = {
      listTerminalJobsMissingCertification: async () => [
        { job: jobA, resultSummary: jobA.result_summary },
        { job: jobB, resultSummary: jobB.result_summary },
      ],
      certifyResearchJob: vi.fn()
        .mockResolvedValueOnce({ outcome: "inserted", status: "certified", snapshotFingerprint: "trcert-v1:a" })
        .mockRejectedValueOnce(Object.assign(new Error("db"), { code: "PGRST_TRANSIENT" })),
    };
    await reconcilePendingResearchCertifications(writer, {
      onEvent: (event) => events.push({ kind: event.kind, jobId: event.jobId }),
    });
    expect(events).toEqual([
      { kind: "inserted", jobId: "evt-a" },
      { kind: "error", jobId: "evt-b" },
    ]);
  });
});
