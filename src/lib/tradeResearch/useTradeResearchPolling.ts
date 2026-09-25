"use client";

import { useEffect, useRef } from "react";

export function useTradeResearchPolling<T>(input: {
  enabled: boolean;
  fetchSnapshot: () => Promise<T | null>;
  onSnapshot: (snapshot: T) => void;
}): void {
  const fetchRef = useRef(input.fetchSnapshot);
  const updateRef = useRef(input.onSnapshot);
  fetchRef.current = input.fetchSnapshot;
  updateRef.current = input.onSnapshot;
  useEffect(() => {
    if (!input.enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let transientFailures = 0;
    const schedule = () => {
      if (stopped) return;
      const base = document.visibilityState === "hidden" ? 5_000 : 1_500;
      const delay = Math.min(15_000, base * Math.max(1, 2 ** Math.min(transientFailures, 3)));
      timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (stopped || inFlight) return schedule();
      inFlight = true;
      try {
        const next = await fetchRef.current();
        if (next) updateRef.current(next);
        transientFailures = 0;
      } catch { transientFailures += 1; }
      finally { inFlight = false; schedule(); }
    };
    schedule();
    const visible = () => { if (!stopped && document.visibilityState === "visible") { if (timer) clearTimeout(timer); timer = setTimeout(tick, 0); } };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [input.enabled]);
}

