import { BUYER_STATUS_LABELS, type BuyerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<BuyerStatus, string> = {
  new: "bg-brand-canvas text-brand-charcoal/80 border-brand-border",
  qualified: "bg-white text-brand-charcoal/85 border-brand-border",
  ready: "bg-white text-brand-orange border-brand-orange/25",
  contacted: "bg-white text-brand-charcoal/85 border-brand-charcoal/25",
  replied: "bg-white text-blue-700 border-blue-200",
  interested: "bg-white text-emerald-700 border-emerald-200",
  "quotation-sent": "bg-white text-amber-700 border-amber-200",
  negotiating: "bg-white text-amber-700 border-amber-200",
  converted: "bg-emerald-50 text-emerald-800 border-emerald-200",
  "not-interested": "bg-white text-brand-muted border-brand-border",
};

export function StatusPill({ status, small = false }: { status: BuyerStatus; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium tracking-tight",
        small ? "text-[10.5px] px-1.5 py-0.5" : "text-[11.5px] px-2 py-1",
        STYLES[status],
      )}
    >
      <span className={cn("w-1 h-1 rounded-full", dotColor(status))} />
      {BUYER_STATUS_LABELS[status]}
    </span>
  );
}

function dotColor(s: BuyerStatus) {
  switch (s) {
    case "interested":
    case "converted":
      return "bg-emerald-500";
    case "replied":
      return "bg-blue-500";
    case "quotation-sent":
    case "negotiating":
      return "bg-amber-500";
    case "ready":
      return "bg-brand-orange";
    case "contacted":
      return "bg-brand-charcoal";
    case "not-interested":
      return "bg-brand-muted";
    default:
      return "bg-brand-charcoal/40";
  }
}
