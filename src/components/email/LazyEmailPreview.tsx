"use client";

import { useEffect, useRef, useState } from "react";
import { EmailPreviewFrame } from "./EmailPreviewFrame";

/**
 * MDF Outreach — lazy email preview.
 *
 * Wraps <EmailPreviewFrame> so the iframe is NOT mounted until either:
 *   1. the card scrolls near the viewport (IntersectionObserver), or
 *   2. the caller sets `activate` to true (explicit user preview).
 *
 * The initial paint therefore mounts ZERO iframes for the Templates
 * gallery — even at 8 cards. Only the cards that are visible after
 * scroll (or explicitly opened) render their preview HTML.
 *
 * Fallbacks:
 *   • `IntersectionObserver` unavailable → mount immediately (safe
 *     downgrade for very old runtimes; the placeholder still appears
 *     briefly). All modern browsers support it.
 *   • SSR pass never mounts the iframe (the `mounted` state stays
 *     false on the server), avoiding hydration mismatch.
 */
export function LazyEmailPreview({
  html,
  width = "100%",
  minHeight = 560,
  rootMargin = "300px",
  activate,
  placeholder,
}: {
  /** Pre-rendered email HTML. Only read once mounted. */
  html: string;
  width?: number | string;
  minHeight?: number;
  /** Root margin passed to IntersectionObserver. */
  rootMargin?: string;
  /**
   * External trigger. When true, the iframe mounts immediately.
   * Used by "Preview" click actions that should show the full email
   * regardless of scroll position.
   */
  activate?: boolean;
  /**
   * Static thumbnail shown until the iframe mounts. Should reserve
   * the same box dimensions to avoid layout shift.
   */
  placeholder?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    if (activate) {
      setMounted(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old runtime — no observer available. Mount immediately
      // rather than never rendering the preview.
      setMounted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, activate, rootMargin]);

  return (
    <div ref={containerRef} style={{ width, minHeight }}>
      {mounted ? (
        <EmailPreviewFrame html={html} width={width} minHeight={minHeight} />
      ) : (
        placeholder ?? <DefaultPlaceholder minHeight={minHeight} />
      )}
    </div>
  );
}

function DefaultPlaceholder({ minHeight }: { minHeight: number }) {
  return (
    <div
      style={{
        minHeight,
        backgroundColor: "var(--app-elevated)",
        borderRadius: 16,
      }}
      role="presentation"
      aria-hidden
    />
  );
}
