import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CampaignProgressRow } from "@/lib/dashboard/campaignProgress";
import { formatRelative } from "@/lib/utils";

interface Props {
  rows: CampaignProgressRow[];
}

export function CampaignProgressPanel({ rows }: Props) {
  return (
    <section
      aria-labelledby="campaign-progress-heading"
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2
            id="campaign-progress-heading"
            className="text-[13px] font-semibold tracking-tight text-text-primary"
          >
            Campaign progress
          </h2>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            {rows.length === 0
              ? "No campaigns yet"
              : `${rows.length} recent campaign${rows.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link
          href="/campaigns"
          className="text-[11.5px] text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1"
        >
          View all <ArrowUpRight size={11} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="text-[12.5px] text-text-muted leading-relaxed">
          Campaigns you create will show delivery progress here.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <CampaignRow key={r.campaign.id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CampaignRow({ row }: { row: CampaignProgressRow }) {
  const { campaign: c, totalRecipients, delivered, suppressed, remaining, progressPct, lastDeliveryAt } = row;
  const barColor = row.statusTone === "attention" ? "#EFC26C" : "var(--brand-orange)";
  const barBg = row.statusTone === "attention" ? "rgba(239,194,108,0.14)" : "var(--app-elevated)";
  const statusLabel = statusToneLabel(row.statusTone);

  return (
    <li>
      <Link
        href={`/campaigns/${c.id}`}
        className="block rounded-[8px] p-3.5 transition-colors focus-ring-quiet"
        style={{
          border: "1px solid var(--app-border)",
          backgroundColor: "var(--app-elevated)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[13px] font-medium text-text-primary truncate">{c.name}</div>
              <span
                className="text-[10px] tracking-[0.08em] uppercase font-medium px-1.5 py-0.5 rounded"
                style={statusChipStyle(row.statusTone)}
              >
                {statusLabel}
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-text-muted truncate">
              {c.country || "—"} · {c.product || "—"} · {campaignStatusLabel(c.status)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[13px] font-semibold text-text-primary tabular-nums leading-none">
              {delivered}
              <span className="text-text-muted font-normal"> / {totalRecipients}</span>
            </div>
            <div className="mt-1 text-[10.5px] text-text-muted tabular-nums">
              {progressPct}% delivered
            </div>
          </div>
        </div>

        <div
          className="mt-3 h-1.5 w-full rounded-full overflow-hidden"
          style={{ backgroundColor: barBg }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          aria-label={`${c.name} delivery`}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progressPct))}%`,
              height: "100%",
              backgroundColor: barColor,
              transition: "width 220ms ease",
            }}
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-muted">
          <div className="flex items-center gap-3 tabular-nums">
            <span>Remaining {remaining}</span>
            {suppressed > 0 && <span style={{ color: "#EFC26C" }}>Suppressed {suppressed}</span>}
          </div>
          <div className="tabular-nums">
            {lastDeliveryAt
              ? `Last delivery ${formatRelative(lastDeliveryAt)}`
              : totalRecipients === 0
                ? "No recipients yet"
                : "No delivery yet"}
          </div>
        </div>
      </Link>
    </li>
  );
}

function statusToneLabel(tone: CampaignProgressRow["statusTone"]): string {
  switch (tone) {
    case "delivered":
      return "Delivered";
    case "in_progress":
      return "Sending";
    case "attention":
      return "Attention";
    case "healthy":
      return "Undelivered";
    default:
      return "Quiet";
  }
}

function statusChipStyle(tone: CampaignProgressRow["statusTone"]): React.CSSProperties {
  if (tone === "attention") {
    return {
      backgroundColor: "rgba(239,194,108,0.14)",
      color: "#EFC26C",
      border: "1px solid rgba(239,194,108,0.3)",
    };
  }
  if (tone === "delivered") {
    return {
      backgroundColor: "rgba(243,107,33,0.14)",
      color: "var(--brand-orange)",
      border: "1px solid rgba(243,107,33,0.3)",
    };
  }
  return {
    backgroundColor: "var(--app-elevated)",
    color: "var(--text-muted)",
    border: "1px solid var(--app-border-strong)",
  };
}

function campaignStatusLabel(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase());
}
