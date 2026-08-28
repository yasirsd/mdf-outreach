import { describe, expect, it } from "vitest";
import {
  BUYER_FINDER_PROCESS_CAP,
  canTransitionStage,
  isRunStale,
  isTerminal,
  resolveBuyerFinderProcessCap,
  stageIndex,
  STALE_THRESHOLD_MS,
  TERMINAL_STATUSES,
  toSnapshot,
  type BuyerFinderSearchRun,
} from "./searchRun";

const now = new Date("2026-08-28T12:00:00.000Z");

function baseRun(): BuyerFinderSearchRun {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    workspaceId: "ws-1",
    country: "UAE",
    businessProductId: "guntur-dry-red-chilli",
    desiredBuyerTypes: [],
    contactPriorities: [],
    provider: "hunter",
    providerStatus: null,
    status: "running",
    stage: "preparing",
    discoveredCount: 0,
    usableCount: 0,
    processedCount: 0,
    createdCount: 0,
    enrichedExistingCount: 0,
    duplicateCount: 0,
    productMatchesAdded: 0,
    failureCount: 0,
    creditsUsed: 0,
    costClass: "free",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("BF2.1 search-run state contract", () => {
  it("terminal statuses stop progression", () => {
    for (const s of TERMINAL_STATUSES) expect(isTerminal(s)).toBe(true);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("running")).toBe(false);
  });

  it("stage transitions only move forward — and end at 'complete'", () => {
    expect(stageIndex("preparing")).toBe(0);
    expect(stageIndex("complete")).toBe(4);
    expect(canTransitionStage("preparing", "discovering")).toBe(true);
    expect(canTransitionStage("processing_candidates", "processing_candidates")).toBe(true);
    expect(canTransitionStage("finalizing", "processing_candidates")).toBe(false);
    expect(canTransitionStage("complete", "discovering")).toBe(false);
  });

  it("isRunStale reports true only for non-terminal runs older than the threshold", () => {
    const run = baseRun();
    // Fresh — not stale.
    expect(isRunStale(run, now)).toBe(false);
    // Slightly stale but under threshold — still not stale.
    const later = new Date(now.getTime() + STALE_THRESHOLD_MS - 1_000);
    expect(isRunStale(run, later)).toBe(false);
    // Past threshold — stale.
    const way = new Date(now.getTime() + STALE_THRESHOLD_MS + 1);
    expect(isRunStale(run, way)).toBe(true);
    // Terminal runs are never stale.
    expect(isRunStale({ ...run, status: "completed" }, way)).toBe(false);
    expect(isRunStale({ ...run, status: "failed" }, way)).toBe(false);
  });

  it("toSnapshot never leaks workspaceId or internal identifiers", () => {
    const snap = toSnapshot(baseRun());
    expect(snap).not.toHaveProperty("workspaceId");
    expect(snap).not.toHaveProperty("provider" as never, "hunter-api-key");
    expect(snap.provider).toBe("hunter");
    expect(snap.costClass).toBe("free");
    expect(snap.creditsUsed).toBe(0);
    expect(JSON.stringify(snap)).not.toMatch(/api[_-]?key/i);
  });

  it("process cap is 20 and cannot be raised by a requested limit", () => {
    expect(BUYER_FINDER_PROCESS_CAP).toBe(20);
    expect(resolveBuyerFinderProcessCap()).toBe(20);
    expect(resolveBuyerFinderProcessCap(1)).toBe(1);
    expect(resolveBuyerFinderProcessCap(999)).toBe(20);
  });
});
