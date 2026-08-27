import Link from "next/link";
import { ArrowUpRight, UserPlus, Mail, MailX, Megaphone, Zap, Settings2 } from "lucide-react";
import type { OverviewActivityRow } from "@/lib/dashboard/activityCuration";
import { formatRelative } from "@/lib/utils";

interface Props {
  rows: OverviewActivityRow[];
}

/**
 * Recent activity feed. Content-sized (does NOT stretch to match its
 * grid neighbour). Only scrolls internally when the curated slice
 * naturally overflows the panel — i.e. never on typical dashboards.
 */
export function RecentActivityPanel({ rows }: Props) {
  const showScroll = rows.length >= 7;
  return (
    <section
      aria-labelledby="recent-activity-heading"
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <h2
          id="recent-activity-heading"
          className="text-[13px] font-semibold tracking-tight text-text-primary"
        >
          Recent activity
        </h2>
        <Link
          href="/activity"
          className="text-[11.5px] text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1"
        >
          View all <ArrowUpRight size={11} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="text-[12.5px] text-text-muted leading-relaxed">
          Actions you take will appear here.
        </div>
      ) : (
        <ul
          className={showScroll ? "overflow-y-auto -mr-2 pr-2" : ""}
          style={showScroll ? { maxHeight: 320 } : undefined}
        >
          {rows.map((r, i) => (
            <ActivityRow key={r.id} row={r} isFirst={i === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ row, isFirst }: { row: OverviewActivityRow; isFirst: boolean }) {
  const { Icon, color, bg } = toneStyle(row.tone);
  return (
    <li
      className="flex items-start gap-3 py-2"
      style={{
        borderTop: isFirst ? "none" : "1px solid var(--app-border)",
      }}
    >
      <span
        aria-hidden
        className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded-md"
        style={{ width: 22, height: 22, backgroundColor: bg, color }}
      >
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-text-primary leading-snug">{row.message}</div>
      </div>
      <div className="text-[11px] text-text-muted shrink-0 mt-1 tabular-nums whitespace-nowrap">
        {formatRelative(row.at)}
      </div>
    </li>
  );
}

function toneStyle(tone: OverviewActivityRow["tone"]) {
  switch (tone) {
    case "buyer":
      return { Icon: UserPlus, color: "var(--brand-orange)", bg: "rgba(243,107,33,0.12)" };
    case "campaign":
      return { Icon: Megaphone, color: "#B8A48B", bg: "rgba(184,164,139,0.12)" };
    case "email":
      return { Icon: Mail, color: "var(--brand-orange)", bg: "rgba(243,107,33,0.12)" };
    case "email-fail":
      return { Icon: MailX, color: "#EF6C5C", bg: "rgba(239,108,92,0.14)" };
    case "gmail":
      return { Icon: Zap, color: "#EFC26C", bg: "rgba(239,194,108,0.12)" };
    default:
      return { Icon: Settings2, color: "var(--text-muted)", bg: "var(--app-elevated)" };
  }
}
