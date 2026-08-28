"use client";

import { useEffect, useRef } from "react";
import { isTerminal, type SafeSearchRunSnapshot, type SearchRunStatus } from "@/lib/buyerFinder/searchRun";

export const POLL_INTERVAL_MS = 1000;
export const POLL_HIDDEN_INTERVAL_MS = 4000;

export function nextPollDelay(visibilityState: DocumentVisibilityState | string): number {
  return visibilityState === "hidden" ? POLL_HIDDEN_INTERVAL_MS : POLL_INTERVAL_MS;
}

export function shouldStopPolling(status: SearchRunStatus): boolean {
  return isTerminal(status);
}

/**
 * Sequential poll: await response, then schedule the next timeout.
 * Never overlaps. Pauses/slows when the document is hidden.
 * Cleans up on unmount or run id change.
 */
export function useSearchRunPolling(options: {
  runId: string | null;
  enabled: boolean;
  fetchRun: (runId: string) => Promise<SafeSearchRunSnapshot | null>;
  onSnapshot: (run: SafeSearchRunSnapshot) => void;
  isStale?: (run: SafeSearchRunSnapshot) => boolean;
}): void {
  const fetchRunRef = useRef(options.fetchRun);
  const onSnapshotRef = useRef(options.onSnapshot);
  const isStaleRef = useRef(options.isStale);
  fetchRunRef.current = options.fetchRun;
  onSnapshotRef.current = options.onSnapshot;
  isStaleRef.current = options.isStale;

  useEffect(() => {
    if (!options.enabled || !options.runId) return;
    const runId = options.runId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    async function tick() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const snap = await fetchRunRef.current(runId);
        if (cancelled || !snap) return;
        onSnapshotRef.current(snap);
        if (shouldStopPolling(snap.status)) return;
        if (isStaleRef.current?.(snap)) return;
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      const delay = nextPollDelay(
        typeof document === "undefined" ? "visible" : document.visibilityState,
      );
      timer = setTimeout(tick, delay);
    }

    function onVisibility() {
      if (cancelled) return;
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!inFlight) void tick();
    }

    timer = setTimeout(tick, 0);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [options.enabled, options.runId]);
}
