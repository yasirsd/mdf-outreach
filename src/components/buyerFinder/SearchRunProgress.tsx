"use client";

import { useId, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SafeSearchRunSnapshot } from "@/lib/buyerFinder/searchRun";
import {
  deriveSearchRunView,
  type ProgressStep,
  type ProgressStepState,
} from "@/lib/buyerFinder/searchRunPresentation";
import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";

export function SearchRunProgressSurface({
  run,
  now,
  onViewCandidates,
  onFindMore,
  onStartNew,
}: {
  run: SafeSearchRunSnapshot;
  now?: Date;
  onViewCandidates: () => void;
  onFindMore: () => void;
  onStartNew: () => void;
}) {
  const product = findBusinessProductById(run.businessProductId);
  const view = deriveSearchRunView(run, now ?? new Date(), {
    productDisplayName: product?.displayName,
  });

  if (view.kind === "complete" || view.kind === "partial") {
    return (
      <CompletionCard
        kind={view.kind}
        run={run}
        message={view.message}
        onViewCandidates={onViewCandidates}
        onFindMore={onFindMore}
      />
    );
  }

  if (view.kind === "failed" || view.kind === "interrupted") {
    return (
      <TerminalNotice
        title={view.title}
        message={view.message ?? "Search could not complete."}
        onStartNew={onStartNew}
      />
    );
  }

  return (
    <div
      className="rounded-[12px] p-5 sm:p-6 space-y-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-text-primary">
          {view.title}
        </h2>
        {view.subtitle && (
          <p className="mt-1 text-[13px] text-text-secondary">{view.subtitle}</p>
        )}
      </div>

      <ol className="space-y-3" aria-label="Search progress">
        {view.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>

      {view.bar && (
        <DeterminateBar processed={view.bar.processed} total={view.bar.total} />
      )}

      <DetailsBlock rows={view.details} />
    </div>
  );
}

function StepRow({ step }: { step: ProgressStep }) {
  return (
    <li className="flex items-start gap-3 min-w-0">
      <StepGlyph state={step.state} />
      <div className="min-w-0 pt-px">
        <div
          className={cn(
            "text-[13px] leading-snug",
            step.state === "waiting" ? "text-text-muted" : "text-text-primary",
            step.state === "active" && "font-medium",
          )}
        >
          {step.label}
        </div>
        {step.detail && (
          <div className="mt-0.5 text-[12px] text-text-muted">{step.detail}</div>
        )}
      </div>
    </li>
  );
}

function StepGlyph({ state }: { state: ProgressStepState }) {
  if (state === "completed") {
    return (
      <span
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(243,107,33,0.18)", color: "var(--brand-orange)" }}
        aria-label="Completed"
      >
        <Check size={10} strokeWidth={3} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center"
        aria-label="In progress"
        aria-current="step"
      >
        <span
          className="h-2.5 w-2.5 rounded-full motion-safe:animate-pulse"
          style={{ backgroundColor: "var(--brand-orange)" }}
        />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#F08B7E]" aria-label="Failed">
        <AlertTriangle size={14} />
      </span>
    );
  }
  if (state === "warning") {
    return (
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center" style={{ color: "#EBC275" }} aria-label="Warning">
        <AlertTriangle size={14} />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-text-faint" aria-label="Waiting">
      <Circle size={12} strokeWidth={1.75} />
    </span>
  );
}

function DeterminateBar({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const label = `${processed} / ${total} checked`;
  return (
    <div>
      <div className="flex items-center justify-between text-[11.5px] text-text-muted mb-1.5">
        <span>Progress</span>
        <span>{label}</span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
        role="progressbar"
        aria-valuenow={processed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, backgroundColor: "var(--brand-orange)" }}
        />
      </div>
    </div>
  );
}

function DetailsBlock({ rows }: { rows: Array<{ label: string; value: string }> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-1">
      <button
        type="button"
        className="flex items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary focus-ring-quiet rounded-[6px] px-0.5 py-0.5"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          size={12}
          className={cn("transition-transform", open && "rotate-180")}
        />
        View details
      </button>
      {open && (
        <dl id={id} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 min-w-0">
              <dt className="text-text-muted shrink-0">{row.label}</dt>
              <dd className="text-text-secondary truncate text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function CompletionCard({
  kind,
  run,
  message,
  onViewCandidates,
  onFindMore,
}: {
  kind: "complete" | "partial";
  run: SafeSearchRunSnapshot;
  message?: string;
  onViewCandidates: () => void;
  onFindMore: () => void;
}) {
  const title = kind === "partial" ? "Search partially completed" : "Search complete";
  const rows = [
    { label: "Companies discovered", value: run.discoveredCount },
    { label: "Usable companies", value: run.usableCount },
    { label: "New candidates", value: run.createdCount },
    { label: "Existing candidates updated", value: run.enrichedExistingCount },
    { label: "Duplicates skipped", value: run.duplicateCount },
    { label: "Product matches added", value: run.productMatchesAdded },
    { label: "Failures", value: run.failureCount },
    { label: "Credits used", value: run.creditsUsed },
  ];
  return (
    <div
      className="rounded-[12px] p-5 sm:p-6 space-y-4"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: kind === "partial" ? "rgba(240,180,90,0.12)" : "rgba(243,107,33,0.18)",
            color: kind === "partial" ? "#EBC275" : "var(--brand-orange)",
          }}
        >
          {kind === "partial" ? <AlertTriangle size={12} /> : <Check size={12} strokeWidth={3} />}
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight text-text-primary">{title}</h2>
          {kind === "partial" && (
            <p className="mt-1 text-[13px] text-text-secondary">
              {run.createdCount} new candidates saved · {run.enrichedExistingCount} existing
              candidates updated · {run.failureCount} failures
            </p>
          )}
          {message && <p className="mt-1 text-[13px] text-text-secondary">{message}</p>}
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-text-muted">{row.label}</dt>
            <dd className="text-text-secondary tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-primary min-h-9" onClick={onViewCandidates}>
          View candidates
        </button>
        <button type="button" className="btn-secondary min-h-9" onClick={onFindMore}>
          {kind === "partial" ? "Start another search" : "Find more companies"}
        </button>
      </div>
    </div>
  );
}

function TerminalNotice({
  title,
  message,
  onStartNew,
}: {
  title: string;
  message: string;
  onStartNew: () => void;
}) {
  return (
    <div
      className="rounded-[12px] p-5 sm:p-6 space-y-4"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "#F08B7E" }} />
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight text-text-primary">{title}</h2>
          <p className="mt-1 text-[13px] text-text-secondary">{message}</p>
        </div>
      </div>
      <button type="button" className="btn-primary min-h-9" onClick={onStartNew}>
        Start a new search
      </button>
    </div>
  );
}
