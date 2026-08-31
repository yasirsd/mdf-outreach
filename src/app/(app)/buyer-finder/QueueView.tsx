"use client";

import { useMemo, useState } from "react";
import { CandidateCard, type CandidateCardInput } from "@/components/buyerFinder/CandidateCard";
import { revealPriorityTierRank } from "@/lib/buyerFinder/revealPriority";

export type QueueRowInput = CandidateCardInput;

export type QueueFilter = "all" | "priority" | "attention";

function isAttention(row: QueueRowInput): boolean {
  return row.publicJobStatus === "failed" || row.peopleJobStatus === "failed";
}

function comparePriority(a: QueueRowInput, b: QueueRowInput): number {
  const tierDelta =
    revealPriorityTierRank(b.revealPriority ?? "none") -
    revealPriorityTierRank(a.revealPriority ?? "none");
  if (tierDelta !== 0) return tierDelta;
  const roleDelta = (b.roleRelevance ?? 0) - (a.roleRelevance ?? 0);
  if (roleDelta !== 0) return roleDelta;
  return (b.candidate.companyScore ?? 0) - (a.candidate.companyScore ?? 0);
}

export function QueueView({
  rows,
  filter = "all",
  onFilterChange,
}: {
  rows: QueueRowInput[];
  filter?: QueueFilter;
  onFilterChange?: (filter: QueueFilter) => void;
}) {
  const [localFilter, setLocalFilter] = useState<QueueFilter>(filter);
  const active = onFilterChange ? filter : localFilter;
  const setFilter = onFilterChange ?? setLocalFilter;

  const visible = useMemo(() => {
    if (active === "attention") return rows.filter(isAttention);
    if (active === "priority") {
      return rows
        .filter((r) => r.revealPriority === "high" || r.revealPriority === "medium")
        .slice()
        .sort(comparePriority);
    }
    return rows;
  }, [rows, active]);

  const high = visible.filter((r) => r.revealPriority === "high");
  const medium = visible.filter((r) => r.revealPriority === "medium");

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1" role="tablist" aria-label="Review workspace">
        <FilterChip label="All companies" active={active === "all"} onClick={() => setFilter("all")} />
        <FilterChip
          label="Priority contacts"
          active={active === "priority"}
          onClick={() => setFilter("priority")}
        />
        <FilterChip
          label="Needs attention"
          active={active === "attention"}
          onClick={() => setFilter("attention")}
        />
      </div>
      {visible.length === 0 ? (
        <EmptyState filter={active} hasRows={rows.length > 0} onViewAll={() => setFilter("all")} />
      ) : active === "priority" ? (
        <div className="space-y-7">
          {high.length > 0 && (
            <section>
              <h2 className="text-[11px] font-medium text-text-muted mb-2">High priority</h2>
              <div className="space-y-2">
                {high.map((row, i) => (
                  <CandidateCard key={row.candidate.id} record={row} layout="priority" index={i} />
                ))}
              </div>
            </section>
          )}
          {medium.length > 0 && (
            <section>
              <h2 className="text-[11px] font-medium text-text-muted mb-2">Medium priority</h2>
              <div className="space-y-2">
                {medium.map((row, i) => (
                  <CandidateCard
                    key={row.candidate.id}
                    record={row}
                    layout="priority"
                    index={high.length + i}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : active === "attention" ? (
        <div className="space-y-2 w-full">
          {visible.map((row) => (
            <CandidateCard key={row.candidate.id} record={row} layout="attention" />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3 items-start content-start">
          {visible.map((row) => (
            <div key={row.candidate.id} className="min-w-0 h-fit">
              <CandidateCard record={row} layout="default" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  filter,
  hasRows,
  onViewAll,
}: {
  filter: QueueFilter;
  hasRows: boolean;
  onViewAll: () => void;
}) {
  if (!hasRows) {
    return (
      <div className="rounded-[12px] px-8 py-12 text-center" style={{ backgroundColor: "var(--app-surface)" }}>
        <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">No companies yet</h2>
        <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed max-w-md mx-auto">
          Use Search to discover companies. Candidates stay here for research and review.
        </p>
      </div>
    );
  }
  if (filter === "priority") {
    return (
      <div className="rounded-[12px] px-8 py-12 text-center" style={{ backgroundColor: "var(--app-surface)" }}>
        <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">
          No priority contacts yet
        </h2>
        <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed max-w-md mx-auto">
          Free research has not found a strong purchasing, sourcing, import, trading, or executive
          contact yet.
        </p>
        <button type="button" className="btn-secondary mt-5" onClick={onViewAll}>
          View all companies
        </button>
      </div>
    );
  }
  if (filter === "attention") {
    return (
      <div className="rounded-[12px] px-8 py-12 text-center" style={{ backgroundColor: "var(--app-surface)" }}>
        <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">Everything looks good</h2>
        <p className="mt-2 text-[13.5px] text-text-secondary">No research jobs need attention.</p>
      </div>
    );
  }
  return (
    <div className="rounded-[12px] px-8 py-12 text-center" style={{ backgroundColor: "var(--app-surface)" }}>
      <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">No companies in this view</h2>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="relative px-3 py-2 text-[13px] font-medium focus-ring-quiet rounded-sm duration-150"
      style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full"
          style={{ backgroundColor: "var(--brand-orange)" }}
        />
      )}
    </button>
  );
}
