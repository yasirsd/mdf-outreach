import { BUYER_STATUS_LABELS, type BuyerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Tone {
  fg: string;
  bg: string;
  border: string;
  dot: string;
}

const TONES: Record<BuyerStatus, Tone> = {
  new: {
    fg: "#A1A1AA",
    bg: "rgba(255,255,255,0.03)",
    border: "rgba(255,255,255,0.10)",
    dot: "#71717A",
  },
  qualified: {
    fg: "#D4D4D8",
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.12)",
    dot: "#A1A1AA",
  },
  ready: {
    fg: "#F8894C",
    bg: "rgba(243,107,33,0.10)",
    border: "rgba(243,107,33,0.28)",
    dot: "#F36B21",
  },
  contacted: {
    fg: "#F5F5F4",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.18)",
    dot: "#F5F5F4",
  },
  replied: {
    fg: "#93C5FD",
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.28)",
    dot: "#60A5FA",
  },
  interested: {
    fg: "#86EFAC",
    bg: "rgba(34,197,94,0.10)",
    border: "rgba(34,197,94,0.28)",
    dot: "#4ADE80",
  },
  "quotation-sent": {
    fg: "#FCD34D",
    bg: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.28)",
    dot: "#FBBF24",
  },
  negotiating: {
    fg: "#FCD34D",
    bg: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.28)",
    dot: "#FBBF24",
  },
  converted: {
    fg: "#4ADE80",
    bg: "rgba(34,197,94,0.14)",
    border: "rgba(34,197,94,0.40)",
    dot: "#22C55E",
  },
  "not-interested": {
    fg: "#71717A",
    bg: "rgba(255,255,255,0.02)",
    border: "rgba(255,255,255,0.08)",
    dot: "#52525B",
  },
};

export function StatusPill({ status, small = false }: { status: BuyerStatus; small?: boolean }) {
  const tone = TONES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium tracking-tight",
        small ? "text-[10.5px] px-2 py-0.5" : "text-[11px] px-2.5 py-1",
      )}
      style={{ color: tone.fg, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <span
        className="rounded-full"
        style={{ width: 6, height: 6, backgroundColor: tone.dot }}
      />
      {BUYER_STATUS_LABELS[status]}
    </span>
  );
}
