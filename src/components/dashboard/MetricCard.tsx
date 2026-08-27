import type { ReactNode } from "react";
import type { TrendInfo } from "@/lib/dashboard/timeSeries";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Sparkline } from "./Sparkline";

interface Props {
  label: string;
  value: number;
  detail?: string;
  icon?: ReactNode;
  trend?: TrendInfo;
  /** When provided, renders a tiny sparkline aligned right of the number. */
  sparkline?: number[];
  /**
   * Accent tone. "primary" = MDF orange emphasis (used for the "hero"
   * card — Emails sent). Others use neutral text.
   */
  tone?: "primary" | "neutral";
  href?: string;
}

/**
 * Compact metric card. Sparkline is inline with the number instead of
 * on its own row so the card stays around ~90px tall instead of ~130px.
 */
export function MetricCard({
  label,
  value,
  detail,
  icon,
  trend,
  sparkline,
  tone = "neutral",
  href,
}: Props) {
  const numberColor = tone === "primary" ? "var(--brand-orange)" : "var(--text-primary)";
  const content = (
    <div
      className="rounded-[12px] px-4 py-3.5 transition-colors"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
          {label}
        </div>
        {icon && <div className="text-text-muted opacity-80 shrink-0">{icon}</div>}
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <div
            className="text-[26px] font-semibold leading-none tabular-nums tracking-tight"
            style={{ color: numberColor }}
          >
            {value.toLocaleString()}
          </div>
          {trend && <TrendPill info={trend} />}
        </div>
        {sparkline && sparkline.length > 0 && (
          <div className="shrink-0 -mb-0.5">
            <Sparkline
              values={sparkline}
              ariaLabel={`${label} trend`}
              tone={tone === "primary" ? "brand" : "muted"}
              width={80}
              height={22}
            />
          </div>
        )}
      </div>

      {detail && (
        <div className="mt-2 text-[11.5px] text-text-muted leading-snug">{detail}</div>
      )}
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block focus-ring-quiet rounded-[12px]"
        aria-label={`${label}: ${value}`}
      >
        {content}
      </a>
    );
  }
  return content;
}

function TrendPill({ info }: { info: TrendInfo }) {
  if (info.firstPeriod) {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.1em] text-text-muted">
        First period
      </span>
    );
  }
  if (info.pct === null || info.direction === "flat") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-text-muted">
        <Minus size={11} />
      </span>
    );
  }
  const isUp = info.direction === "up";
  const color = isUp ? "var(--brand-orange)" : "#EF6C5C";
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums"
      style={{ color }}
    >
      {isUp ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(info.pct)}%
    </span>
  );
}
