"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * MDF Outreach — subtle top navigation progress bar.
 *
 * App Router does not expose navigation events natively, so we detect
 * transitions in two ways:
 *   1. Intercept anchor clicks on internal <a href="/..."> links and
 *      start the bar immediately.
 *   2. Whenever the pathname or querystring changes, complete the bar
 *      once the new URL settles (React has committed the new tree, so
 *      loading.tsx boundaries are already displayed).
 *
 * We intentionally use plain DOM styling (translateX scale) instead of
 * setInterval — the CSS transitions carry the visual, we only toggle
 * start/finish states in React.
 *
 * A small delay before starting avoids flashing the bar on instant
 * transitions (cached pages, client-only tab switches inside Settings).
 */

const START_DELAY_MS = 80;
// Progress "peak" during navigation — never reaches 100 % until settled.
const PEAK_PCT = 78;
// Safety cap — if a navigation somehow never commits (cancelled, error,
// user clicked an intercepted anchor that ended up not navigating), we
// force the bar back to idle so it can never stay stuck on screen.
const SAFETY_TIMEOUT_MS = 8000;

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `${pathname}?${searchParams?.toString() ?? ""}`;

  // Click interception — starts the bar the moment the user commits.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only respond to unmodified primary clicks.
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = (e.target as HTMLElement | null)?.closest?.("a");
      if (!target) return;
      const anchor = target as HTMLAnchorElement;

      const href = anchor.getAttribute("href");
      if (!href) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      // Skip non-navigational schemes.
      if (
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#") ||
        href.startsWith("javascript:")
      ) {
        return;
      }

      // External URL — let the browser handle it.
      if (/^https?:\/\//i.test(href)) {
        const dest = new URL(href, window.location.href);
        if (dest.origin !== window.location.origin) return;
      }

      // Same-URL click — do nothing.
      const dest = new URL(href, window.location.href);
      if (
        dest.pathname === window.location.pathname &&
        dest.search === window.location.search
      ) {
        return;
      }

      begin();
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Whenever the route key changes, complete the bar.
  useEffect(() => {
    finish();
    // We intentionally re-run on pathname/searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function begin() {
    if (doneTimer.current) {
      clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
    if (startTimer.current) return;
    startTimer.current = setTimeout(() => {
      setState("loading");
      startTimer.current = null;
      // Arm the safety net so a navigation that never commits (route
      // guard, cancelled by browser, silently failed) cannot leave the
      // bar visible forever.
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => {
        setState("idle");
        safetyTimer.current = null;
      }, SAFETY_TIMEOUT_MS);
    }, START_DELAY_MS);
  }

  function finish() {
    if (startTimer.current) {
      clearTimeout(startTimer.current);
      startTimer.current = null;
    }
    if (safetyTimer.current) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
    if (state !== "loading") return;
    setState("done");
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => {
      setState("idle");
      doneTimer.current = null;
    }, 260);
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (startTimer.current) clearTimeout(startTimer.current);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
    };
  }, []);

  const pct =
    state === "loading" ? PEAK_PCT : state === "done" ? 100 : 0;
  const opacity = state === "idle" ? 0 : 1;

  return (
    <div
      className="mdf-navprogress"
      role="progressbar"
      aria-hidden={state === "idle"}
      aria-label="Navigation progress"
      aria-valuenow={state === "loading" ? undefined : 0}
      style={{
        transform: `translateX(${-100 + pct}%)`,
        opacity,
      }}
    />
  );
}
