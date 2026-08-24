"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const TOUCH_MIN_INTERVAL_MS = 60 * 1000;

// Tracks meaningful user activity and periodically pings the server to bump
// last_activity_at. If the browser detects >30min of local silence, it
// initiates a real sign-out. The SERVER remains the authority — this only
// improves UX responsiveness.
export function AppSessionMonitor() {
  const pathname = usePathname();
  const lastActivityRef = useRef<number>(Date.now());
  const lastTouchRef = useRef<number>(Date.now());
  const signingOutRef = useRef(false);

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    function onActivity() {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastTouchRef.current >= TOUCH_MIN_INTERVAL_MS) {
        lastTouchRef.current = now;
        void fetch("/api/app-session/touch", {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
        }).catch(() => {
          // Silent — middleware handles the auth cookie; a failed ping is not fatal.
        });
      }
    }

    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("mousemove", onActivity, opts);
    window.addEventListener("mousedown", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("touchstart", onActivity, opts);
    window.addEventListener("scroll", onActivity, opts);
    window.addEventListener("focus", onActivity);

    const interval = window.setInterval(() => {
      const now = Date.now();
      if (signingOutRef.current) return;
      if (now - lastActivityRef.current > IDLE_TIMEOUT_MS) {
        signingOutRef.current = true;
        window.location.assign("/api/auth/sign-out?reason=expired");
      }
    }, 15 * 1000);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("focus", onActivity);
    };
  }, []);

  return null;
}
