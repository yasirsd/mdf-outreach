import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTradeResearchPolling } from "./useTradeResearchPolling";

afterEach(() => { vi.useRealTimers(); });

describe("useTradeResearchPolling", () => {
  it("recovers after a transient read failure", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ revision: 2 });
    const onSnapshot = vi.fn();
    const hook = renderHook(() => useTradeResearchPolling({ enabled: true, fetchSnapshot, onSnapshot }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenCalledWith({ revision: 2 });
    hook.unmount();
  });

  it("never overlaps requests", async () => {
    vi.useFakeTimers();
    let resolve!: (value: { revision: number }) => void;
    const fetchSnapshot = vi.fn(() => new Promise<{ revision: number }>((done) => { resolve = done; }));
    const onSnapshot = vi.fn();
    const hook = renderHook(() => useTradeResearchPolling({ enabled: true, fetchSnapshot, onSnapshot }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ revision: 1 }); await Promise.resolve(); });
    hook.unmount();
  });
});

