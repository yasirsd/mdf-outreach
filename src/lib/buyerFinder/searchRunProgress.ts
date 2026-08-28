import type { IngestionProgressReporter, IngestionBatchResult } from "./ingestion";
import {
  canTransitionStage,
  type SearchRunPatch,
  type SearchRunStage,
} from "./searchRun";

export const PROGRESS_BATCH_SIZE = 5;
export const PROGRESS_MIN_INTERVAL_MS = 800;

export interface CoalescedProgressOptions {
  persist: (patch: SearchRunPatch) => Promise<void>;
  now?: () => number;
  batchSize?: number;
  minIntervalMs?: number;
  initialStage?: SearchRunStage;
}

/**
 * BF2.2 — coalesces Search Run progress writes.
 *
 * Rules:
 *   • stage-boundary events flush immediately
 *   • first candidate flushes immediately
 *   • then every `batchSize` processed candidates OR every
 *     `minIntervalMs` (default 800ms), whichever fires first
 *   • the last candidate and the complete() summary always flush
 *     exact counts
 *
 * Credits / cost class are never written here.
 */
export function createCoalescedSearchRunReporter(
  options: CoalescedProgressOptions,
): IngestionProgressReporter & { writeCount: number; flush: () => Promise<void> } {
  const now = options.now ?? Date.now;
  const batchSize = options.batchSize ?? PROGRESS_BATCH_SIZE;
  const minIntervalMs = options.minIntervalMs ?? PROGRESS_MIN_INTERVAL_MS;
  let stage: SearchRunStage = options.initialStage ?? "preparing";
  let pending: SearchRunPatch = {};
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let writeCount = 0;
  let persistChain: Promise<void> = Promise.resolve();

  function enqueue(patch: SearchRunPatch) {
    if (patch.stage) {
      if (!canTransitionStage(stage, patch.stage)) {
        const { stage: _ignored, ...rest } = patch;
        patch = rest;
      } else {
        stage = patch.stage;
      }
    }
    pending = { ...pending, ...patch };
  }

  async function flushNow(): Promise<void> {
    const payload = pending;
    pending = {};
    if (Object.keys(payload).length === 0) return;
    await options.persist(payload);
    writeCount += 1;
    lastFlushAt = now();
  }

  function flush(): Promise<void> {
    persistChain = persistChain.then(flushNow, flushNow);
    return persistChain;
  }

  async function flushImmediate(patch: SearchRunPatch): Promise<void> {
    enqueue(patch);
    await flush();
  }

  const reporter: IngestionProgressReporter & { writeCount: number; flush: () => Promise<void> } = {
    get writeCount() {
      return writeCount;
    },
    flush,
    async discoveryStarted() {
      await flushImmediate({ status: "running", stage: "discovering" });
    },
    async discoveryCompleted(info) {
      const nextStage: SearchRunStage =
        info.usable > 0 ? "processing_candidates" : "finalizing";
      await flushImmediate({
        discoveredCount: info.discovered,
        usableCount: info.usable,
        processedCount: 0,
        stage: nextStage,
      });
    },
    async candidateProcessed(info) {
      enqueue({ processedCount: info.processed });
      const isFirst = info.processed === 1;
      const isBatch = info.processed % batchSize === 0;
      const isLast = info.processed === info.total;
      const timedOut = now() - lastFlushAt >= minIntervalMs;
      if (isFirst || isBatch || isLast || timedOut) {
        await flush();
      }
    },
    async complete(info: { summary: IngestionBatchResult }) {
      const s = info.summary;
      await flushImmediate({
        stage: "finalizing",
        discoveredCount: s.discovered,
        usableCount: s.usable,
        processedCount: s.usable,
        createdCount: s.created,
        enrichedExistingCount: s.enrichedExisting,
        duplicateCount: s.skippedExactDuplicates,
        productMatchesAdded: s.productMatchesAdded,
        failureCount: s.failures.length,
      });
    },
  };

  return reporter;
}
