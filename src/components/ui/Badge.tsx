import { cn } from "@/lib/utils";

/**
 * MDF Outreach — canonical Badge / StatusBadge.
 *
 * A single dark-token badge shell with a small tone vocabulary. Never
 * relies on color alone for status — every consumer passes an icon
 * or text label so screen readers + colour-blind users still identify
 * the meaning.
 */

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

const TONE: Record<BadgeTone, { bg: string; fg: string; border?: string }> = {
  neutral: {
    bg: "rgba(255,255,255,0.06)",
    fg: "var(--text-secondary)",
    border: "var(--app-border)",
  },
  accent: {
    bg: "rgba(243,107,33,0.10)",
    fg: "var(--brand-orange)",
    border: "rgba(243,107,33,0.28)",
  },
  success: {
    bg: "rgba(74,222,128,0.10)",
    fg: "#86EFAC",
    border: "rgba(74,222,128,0.24)",
  },
  warning: {
    bg: "rgba(240,180,90,0.10)",
    fg: "#EBC275",
    border: "rgba(240,180,90,0.24)",
  },
  danger: {
    bg: "rgba(239,108,92,0.12)",
    fg: "#F08B7E",
    border: "rgba(239,108,92,0.32)",
  },
  info: {
    bg: "rgba(120,140,170,0.14)",
    fg: "#B2C0D6",
    border: "rgba(120,140,170,0.30)",
  },
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  size = "sm",
  title,
}: {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
  title?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium tracking-[0.01em] whitespace-nowrap",
        size === "sm"
          ? "text-[11px] h-6 px-2.5"
          : "text-[12px] h-7 px-3",
        className,
      )}
      style={{
        backgroundColor: t.bg,
        color: t.fg,
        border: t.border ? `1px solid ${t.border}` : "1px solid transparent",
      }}
    >
      {icon ? (
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
