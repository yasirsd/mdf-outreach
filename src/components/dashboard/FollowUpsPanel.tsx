import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { OverviewFollowUpRow } from "@/lib/dashboard/loadOverviewDashboard";
import { formatFollowUpDate } from "@/lib/dates/followUp";

interface Props {
  rows: OverviewFollowUpRow[];
}

export function FollowUpsPanel({ rows }: Props) {
  return (
    <section
      aria-labelledby="follow-ups-heading"
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2
            id="follow-ups-heading"
            className="text-[13px] font-semibold tracking-tight text-text-primary"
          >
            Follow-ups
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            {rows.length === 0
              ? "No scheduled follow-ups"
              : `${rows.length} upcoming`}
          </p>
        </div>
        <Link
          href="/buyers"
          className="text-[11.5px] text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1"
        >
          Open buyers <ArrowUpRight size={11} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="text-[12.5px] text-text-muted leading-relaxed">
          Set a next follow-up date on a buyer to see it here.
        </div>
      ) : (
        <ul>
          {rows.map((r, i) => {
            const name =
              r.buyer.company ||
              `${r.buyer.firstName} ${r.buyer.lastName}`.trim() ||
              r.buyer.email;
            const meta = [r.buyer.country || null, r.buyer.productInterest || null]
              .filter(Boolean)
              .join(" · ");
            const color = r.overdue ? "#EF6C5C" : r.today ? "var(--brand-orange)" : "var(--text-muted)";
            const dateLabel = formatFollowUpDate(r.buyer.nextFollowUpAt);
            const suffix = r.overdue ? " · overdue" : r.today ? " · today" : "";
            return (
              <li
                key={r.buyer.id}
                className="py-2 flex items-center justify-between gap-4"
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--app-border)",
                }}
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] text-text-primary font-medium truncate">
                    {name}
                  </div>
                  {meta && (
                    <div className="text-[11px] text-text-muted truncate">{meta}</div>
                  )}
                </div>
                <div
                  className="text-[11.5px] tabular-nums shrink-0"
                  style={{ color }}
                >
                  {dateLabel}
                  {suffix}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
