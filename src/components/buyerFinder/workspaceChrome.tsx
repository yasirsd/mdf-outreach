import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { RevealPriorityTier } from "@/lib/buyerFinder/revealPriority";
import { revealPriorityBadgeLabel } from "@/lib/buyerFinder/revealPriorityPresentation";

export function PriorityBadge({
  tier,
}: {
  tier: Exclude<RevealPriorityTier, "none"> | "attention";
}) {
  if (tier === "attention") {
    return (
      <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-text-secondary bg-white/[0.05]">
        Needs attention
      </span>
    );
  }
  const label = revealPriorityBadgeLabel(tier);
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        tier === "high"
          ? { color: "var(--brand-orange)", backgroundColor: "rgba(243,107,33,0.10)" }
          : { color: "var(--text-secondary)", backgroundColor: "rgba(255,255,255,0.05)" }
      }
    >
      {label}
    </span>
  );
}

export function ReviewLink({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center text-[13px] font-medium text-text-primary hover:text-brand-orange transition-colors duration-150 focus-ring-quiet rounded-sm",
        className,
      )}
    >
      Review →
    </Link>
  );
}

export function surfaceStyle(high = false): CSSProperties {
  return {
    backgroundColor: "var(--app-surface)",
    boxShadow: high ? "inset 3px 0 0 var(--brand-orange)" : undefined,
  };
}

export function ResearchServicesCluster({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] min-w-0">
      <div className="text-[11px] text-text-muted mb-1">Research services</div>
      <div
        className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[10px] px-2.5 py-1.5 max-w-full"
        style={{ border: "1px solid var(--app-border)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function ResearchServicesSep() {
  return (
    <span aria-hidden className="text-text-muted/35 select-none">
      |
    </span>
  );
}
