"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { useWorkspace } from "./WorkspaceProvider";
import { toast } from "./ui/Toast";

export function Onboarding() {
  const { seedDemo, seedEmpty } = useWorkspace();
  const [busy, setBusy] = useState<"demo" | "empty" | null>(null);

  async function choose(kind: "demo" | "empty") {
    setBusy(kind);
    try {
      if (kind === "demo") {
        await seedDemo();
        toast.success("Demo workspace ready");
      } else {
        await seedEmpty();
        toast.success("Empty workspace ready");
      }
    } catch (e) {
      toast.error("Something went wrong. Please try again.");
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ivory">
      <div className="max-w-2xl w-full mx-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.18em] text-brand-orange uppercase mb-4">
            <Sparkles size={12} /> Welcome
          </div>
          <h1 className="text-display-lg font-serif font-medium text-brand-charcoal leading-tight">
            Welcome to MDF Outreach.
          </h1>
          <p className="mt-4 text-brand-muted text-base leading-relaxed">
            Your export outreach, kept local — designed for MDF Exports &amp; Imports.
            <br />
            Start with a demo workspace or begin empty.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <button
            onClick={() => choose("demo")}
            disabled={!!busy}
            className="group text-left rounded-2xl border border-brand-border bg-white p-6 hover:border-brand-charcoal/30 hover:shadow-card transition-all disabled:opacity-60"
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] tracking-[0.16em] uppercase text-brand-orange">Recommended</div>
              {busy === "demo" && <Loader2 size={16} className="animate-spin text-brand-muted" />}
            </div>
            <div className="mt-4 text-[19px] font-medium text-brand-charcoal tracking-tight">
              Start with Demo Workspace
            </div>
            <p className="mt-2 text-[13.5px] text-brand-muted leading-relaxed">
              A Thailand campaign, sample buyers, and the Guntur Chilli master template — ready to explore.
            </p>
          </button>

          <button
            onClick={() => choose("empty")}
            disabled={!!busy}
            className="group text-left rounded-2xl border border-brand-border bg-white p-6 hover:border-brand-charcoal/30 hover:shadow-card transition-all disabled:opacity-60"
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] tracking-[0.16em] uppercase text-brand-muted">Clean slate</div>
              {busy === "empty" && <Loader2 size={16} className="animate-spin text-brand-muted" />}
            </div>
            <div className="mt-4 text-[19px] font-medium text-brand-charcoal tracking-tight">
              Start Empty
            </div>
            <p className="mt-2 text-[13.5px] text-brand-muted leading-relaxed">
              No sample data. Add buyers, create your first campaign, and go.
            </p>
          </button>
        </div>

        <div className="mt-6 text-center text-xs text-brand-muted">
          Your data stays in this browser. You can back it up any time from Settings.
        </div>
      </div>
    </div>
  );
}
