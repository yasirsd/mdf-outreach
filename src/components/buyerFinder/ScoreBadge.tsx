import { cn } from "@/lib/utils";

export function ScoreBadge({
  value,
  label = "Score",
  compact = false,
  max = 100,
}: {
  value: number;
  label?: string;
  compact?: boolean;
  max?: number;
}) {
  const tone =
    value >= 80
      ? { fg: "#86EFAC", bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.28)" }
      : value >= 60
        ? { fg: "#F8894C", bg: "rgba(243,107,33,0.10)", border: "rgba(243,107,33,0.28)" }
        : { fg: "#A1A1AA", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.12)" };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium tabular-nums",
        compact ? "text-[10.5px] px-2 py-0.5" : "text-[11px] px-2.5 py-1",
      )}
      style={{ color: tone.fg, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}
    >
      {label} {value}
      <span className="text-text-muted font-normal">/ {max}</span>
    </span>
  );
}
