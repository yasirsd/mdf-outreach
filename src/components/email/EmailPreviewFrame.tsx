"use client";

import { useEffect, useRef } from "react";

export function EmailPreviewFrame({
  html,
  width = "100%",
  minHeight = 900,
}: {
  html: string;
  width?: number | string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    // Write full HTML into srcdoc — Next.js CSS won't apply, preserving email-only styling.
    iframe.srcdoc = html;
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Email preview"
      className="w-full bg-white border-0"
      style={{ width, minHeight }}
    />
  );
}
