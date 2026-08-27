"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { PageContainer } from "@/components/ui/Page";

/**
 * MDF Outreach — app-level error boundary.
 *
 * Never exposes raw Supabase / Postgres / stack traces to operators.
 * Presents a calm dark-themed retry surface. Logs the underlying error
 * to the console so it still shows in Vercel runtime logs / dev tools.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <PageContainer size="narrow">
      <div
        className="rounded-[14px] p-10 md:p-12 text-center"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
      >
        <div
          className="mx-auto w-11 h-11 rounded-full flex items-center justify-center mb-4"
          style={{
            backgroundColor: "rgba(239,108,92,0.10)",
            border: "1px solid rgba(239,108,92,0.28)",
            color: "#F0A19A",
          }}
        >
          <AlertTriangle size={18} />
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight text-text-primary">
          Something couldn&apos;t be loaded
        </h1>
        <p className="mt-2 text-[13px] text-text-secondary leading-relaxed max-w-md mx-auto">
          Try again in a moment. If the problem persists, sign out and back in, or contact
          your MDF administrator.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-text-muted">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <button className="btn-primary" onClick={() => reset()}>
            <RotateCcw size={13} /> Try again
          </button>
          <Link href="/" className="btn-secondary">
            Back to Overview
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
