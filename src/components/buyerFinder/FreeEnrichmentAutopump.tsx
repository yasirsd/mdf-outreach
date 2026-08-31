"use client";

import { useEffect, useRef } from "react";
import { nextDrainDelayMs } from "@/lib/buyerFinder/freeEnrichmentDrainSchedule";

/**
 * App-shell autopump. The durable queue is the source of truth.
 * This only asks the server to claim due jobs while the app is open.
 *
 * When a drain claims work, poll quickly. When claimed === 0, back off
 * so idle workspaces do not POST drain forever every 2.5s.
 */
export function FreeEnrichmentAutopump() {
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    async function tick() {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      let claimed = 0;
      try {
        const res = await fetch("/api/buyer-finder/free-enrichment/drain", {
          method: "POST",
          credentials: "same-origin",
        });
        const json = (await res.json()) as { claimed?: unknown };
        claimed = typeof json.claimed === "number" ? json.claimed : 0;
      } catch {
        claimed = 0;
      } finally {
        inFlight.current = false;
      }
      if (cancelled) return;
      const delay = nextDrainDelayMs(claimed, document.visibilityState === "hidden");
      timeoutId = window.setTimeout(() => {
        void tick();
      }, delay);
    }

    function onVisibility() {
      if (document.visibilityState !== "visible" || inFlight.current) return;
      window.clearTimeout(timeoutId);
      void tick();
    }

    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
