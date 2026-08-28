import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { useSearchRunPolling } from "./useSearchRunPolling";
import type { SafeSearchRunSnapshot } from "./searchRun";

afterEach(() => cleanup());

function snap(over: Partial<SafeSearchRunSnapshot> = {}): SafeSearchRunSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "running",
    stage: "discovering",
    provider: "hunter",
    country: "Thailand",
    businessProductId: "guntur-dry-red-chilli",
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
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...over,
  };
}

describe("useSearchRunPolling", () => {
  it("does not overlap poll requests and stops at terminal state", async () => {
    vi.useFakeTimers();
    let inflight = 0;
    let maxInflight = 0;
    let calls = 0;
    const fetchRun = vi.fn(async (): Promise<SafeSearchRunSnapshot | null> => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      calls += 1;
      await Promise.resolve();
      inflight -= 1;
      if (calls >= 2) return snap({ status: "completed", stage: "complete" });
      return snap({ status: "running", stage: "discovering" });
    });
    const onSnapshot = vi.fn();

    renderHook(() =>
      useSearchRunPolling({
        runId: "00000000-0000-4000-8000-000000000001",
        enabled: true,
        fetchRun,
        onSnapshot,
      }),
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(maxInflight).toBe(1);
    expect(onSnapshot).toHaveBeenCalled();
    expect(onSnapshot.mock.calls.some((c) => c[0].status === "completed")).toBe(true);
    const after = fetchRun.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchRun.mock.calls.length).toBe(after);

    vi.useRealTimers();
  });

  it("uses a longer delay when the document is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const fetchRun = vi.fn(async () => snap());
    renderHook(() =>
      useSearchRunPolling({
        runId: "00000000-0000-4000-8000-000000000001",
        enabled: true,
        fetchRun,
        onSnapshot: () => undefined,
      }),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchRun).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchRun).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchRun.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
});
