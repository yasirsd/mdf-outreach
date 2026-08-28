import { describe, expect, it } from "vitest";
import {
  createCoalescedSearchRunReporter,
  PROGRESS_BATCH_SIZE,
} from "./searchRunProgress";
import type { SearchRunPatch } from "./searchRun";

describe("coalesced Search Run progress reporter", () => {
  it("flushes stage boundaries immediately", async () => {
    const writes: SearchRunPatch[] = [];
    const reporter = createCoalescedSearchRunReporter({
      persist: async (p) => {
        writes.push(p);
      },
      now: () => 0,
    });
    await reporter.discoveryStarted?.({ provider: "hunter" });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.stage).toBe("discovering");
    await reporter.discoveryCompleted?.({ discovered: 10, usable: 8 });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.stage).toBe("processing_candidates");
    expect(writes[1]?.discoveredCount).toBe(10);
    expect(writes[1]?.usableCount).toBe(8);
  });

  it("skips processing_candidates when usable is 0", async () => {
    const writes: SearchRunPatch[] = [];
    const reporter = createCoalescedSearchRunReporter({
      persist: async (p) => {
        writes.push(p);
      },
    });
    await reporter.discoveryStarted?.({ provider: "hunter" });
    await reporter.discoveryCompleted?.({ discovered: 3, usable: 0 });
    expect(writes.at(-1)?.stage).toBe("finalizing");
  });

  it("coalesces candidateProcessed: first, every 5, and last", async () => {
    const writes: SearchRunPatch[] = [];
    let t = 0;
    const reporter = createCoalescedSearchRunReporter({
      persist: async (p) => {
        writes.push(p);
      },
      now: () => t,
      minIntervalMs: 10_000,
    });
    await reporter.discoveryStarted?.({ provider: "hunter" });
    await reporter.discoveryCompleted?.({ discovered: 12, usable: 12 });
    const before = writes.length;
    for (let i = 1; i <= 12; i++) {
      await reporter.candidateProcessed?.({ processed: i, total: 12 });
    }
    const processingWrites = writes.slice(before);
    const processedValues = processingWrites.map((w) => w.processedCount);
    expect(processedValues).toEqual([1, 5, 10, 12]);
    expect(PROGRESS_BATCH_SIZE).toBe(5);
  });

  it("100 fast candidates produce 21 processing writes (1, 5…100)", async () => {
    const writes: SearchRunPatch[] = [];
    const reporter = createCoalescedSearchRunReporter({
      persist: async (p) => {
        writes.push(p);
      },
      now: () => 0,
      minIntervalMs: 10_000,
    });
    await reporter.discoveryStarted?.({ provider: "hunter" });
    await reporter.discoveryCompleted?.({ discovered: 100, usable: 100 });
    const before = writes.length;
    for (let i = 1; i <= 100; i++) {
      await reporter.candidateProcessed?.({ processed: i, total: 100 });
    }
    expect(writes.length - before).toBe(21);
    await reporter.complete?.({
      summary: {
        discovered: 100,
        usable: 100,
        created: 90,
        enrichedExisting: 5,
        skippedExactDuplicates: 5,
        possibleDuplicates: [],
        contactsAdded: 0,
        productMatchesAdded: 90,
        failures: [],
        buyerDuplicateFindings: [],
      },
    });
    expect(writes.at(-1)?.processedCount).toBe(100);
    expect(writes.at(-1)?.createdCount).toBe(90);
    expect(writes.at(-1)?.stage).toBe("finalizing");
    // claim (1) + reporter writes. Stage+processing+complete:
    // 1 discovering + 1 discoveryCompleted + 21 processing + 1 complete = 24
    expect(writes.length).toBe(24);
  });

  it("never regresses stage", async () => {
    const writes: SearchRunPatch[] = [];
    const reporter = createCoalescedSearchRunReporter({
      persist: async (p) => {
        writes.push(p);
      },
    });
    await reporter.discoveryStarted?.({ provider: "hunter" });
    await reporter.discoveryCompleted?.({ discovered: 1, usable: 1 });
    await reporter.complete?.({
      summary: {
        discovered: 1,
        usable: 1,
        created: 1,
        enrichedExisting: 0,
        skippedExactDuplicates: 0,
        possibleDuplicates: [],
        contactsAdded: 0,
        productMatchesAdded: 1,
        failures: [],
        buyerDuplicateFindings: [],
      },
    });
    const stages = writes.map((w) => w.stage).filter(Boolean);
    expect(stages).toEqual(["discovering", "processing_candidates", "finalizing"]);
  });

  it("never writes credits or cost class", async () => {
    const writes: SearchRunPatch[] = [];
    const reporter = createCoalescedSearchRunReporter({
      persist: async (p) => {
        writes.push(p);
      },
    });
    await reporter.discoveryStarted?.({ provider: "hunter" });
    for (const w of writes) {
      expect(w).not.toHaveProperty("creditsUsed");
      expect(w).not.toHaveProperty("costClass");
    }
  });
});
