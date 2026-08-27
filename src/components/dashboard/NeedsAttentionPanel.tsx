import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { AttentionItem } from "@/lib/dashboard/needsAttention";

interface Props {
  items: AttentionItem[];
}

export function NeedsAttentionPanel({ items }: Props) {
  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <h2
          id="needs-attention-heading"
          className="text-[13px] font-semibold tracking-tight text-text-primary"
        >
          Needs attention
        </h2>
        {items.length > 0 && (
          <span className="text-[11px] text-text-muted tabular-nums">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 text-[12.5px] text-text-secondary">
          <CheckCircle2 size={18} className="text-brand-orange" aria-hidden />
          <span>All clear. Nothing needs your attention.</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <AttentionRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { icon: Icon, color, bg } = severityStyle(item.severity);
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-start gap-3 rounded-[8px] p-3 transition-colors focus-ring-quiet"
        style={{
          border: "1px solid var(--app-border)",
          backgroundColor: "var(--app-elevated)",
        }}
      >
        <span
          aria-hidden
          className="shrink-0 inline-flex items-center justify-center rounded-md"
          style={{ width: 26, height: 26, backgroundColor: bg, color }}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-text-primary leading-snug">
            {item.title}
          </div>
          {item.detail && (
            <div className="mt-0.5 text-[11.5px] text-text-muted leading-snug">
              {item.detail}
            </div>
          )}
        </div>
        <span
          aria-hidden
          className="shrink-0 text-[11.5px] text-text-muted mt-0.5"
        >
          {item.actionLabel} →
        </span>
      </Link>
    </li>
  );
}

function severityStyle(sev: AttentionItem["severity"]) {
  if (sev === "danger") {
    return {
      icon: XCircle,
      color: "#EF6C5C",
      bg: "rgba(239,108,92,0.14)",
    };
  }
  if (sev === "warning") {
    return {
      icon: AlertTriangle,
      color: "#EFC26C",
      bg: "rgba(239,194,108,0.12)",
    };
  }
  return {
    icon: Info,
    color: "var(--brand-orange)",
    bg: "rgba(243,107,33,0.12)",
  };
}
