"use client";

import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Users } from "lucide-react";
import { buildBuyerFinderHandoffHref } from "@/lib/marketIntelligence/buyerFinderHandoff";
import { cn } from "@/lib/utils";

export function BuyerFinderHandoffLink({
  productId,
  countryAlpha2,
  countryName,
  returnComparison,
  compact = false,
}: {
  productId: string;
  countryAlpha2: string;
  countryName: string;
  returnComparison?: readonly string[];
  compact?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const href = buildBuyerFinderHandoffHref({ productId, countryAlpha2, returnComparison });
  if (!href) return null;
  return (
    <Link
      href={href}
      onClick={() => setOpening(true)}
      aria-busy={opening || undefined}
      className={cn(
        "focus-ring inline-flex items-center justify-center gap-1.5 rounded-[8px] font-medium transition-colors motion-reduce:transition-none",
        compact
          ? "min-h-7 px-2 text-[10.5px] text-brand-orange hover:bg-white/[0.035]"
          : "min-h-9 px-3 text-[11.5px]",
      )}
      style={compact ? { border: "1px solid var(--app-border-strong)" } : {
        backgroundColor: "var(--brand-orange)",
        color: "var(--app-bg)",
      }}
    >
      {opening
        ? <LoaderCircle size={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
        : <Users size={12} aria-hidden />}
      {opening ? "Opening Buyer Finder…" : `Find buyers in ${countryName}`}
    </Link>
  );
}
