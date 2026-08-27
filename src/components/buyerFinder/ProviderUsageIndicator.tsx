"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  formatUsageResetDate,
  primaryUsageBucket,
  usageLevel,
  type ProviderUsage,
  type UsageLevel,
} from "@/lib/buyerFinder/usage";
import { ProviderUsageDetails } from "./ProviderUsageDetails";

const LEVEL_BAR: Record<UsageLevel, string> = {
  normal: "#86EFAC",
  attention: "#EBC275",
  low: "var(--brand-orange)",
  critical: "#F08B7E",
};

export function ProviderUsageIndicator({ usage }: { usage: ProviderUsage }) {
  const [open, setOpen] = useState(false);
  const primary = primaryUsageBucket(usage);
  const remaining = primary?.bucket.remaining ?? 0;
  const percent = primary?.bucket.percentUsed ?? 0;
  const level = usageLevel(percent);
  const resetLabel = formatUsageResetDate(usage.resetDate);
  const label = `Hunter usage, ${remaining} remaining${resetLabel ? `, resets ${resetLabel}` : ""}. Open details.`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left hover:bg-app-hover focus-ring-quiet"
        style={{ border: "1px solid var(--app-border)" }}
      >
        <span className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
          Hunter
        </span>
        <span
          role="progressbar"
          aria-hidden
          className="hidden sm:block w-[52px] h-1.5 rounded-full overflow-hidden shrink-0"
          style={{ backgroundColor: "var(--app-hover)" }}
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${percent}%`, backgroundColor: LEVEL_BAR[level] }}
          />
        </span>
        <span className="text-[12px] tabular-nums text-text-secondary whitespace-nowrap">
          {remaining} remaining
        </span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Hunter usage"
        subtitle="Plan quota for Buyer Finder. Mock data until the provider is connected."
        size="sm"
        actions={
          <button
            type="button"
            disabled
            className="btn-secondary"
            title="Live usage will be enabled with provider connection."
          >
            Refresh usage
          </button>
        }
      >
        {open ? <ProviderUsageDetails usage={usage} /> : null}
      </Modal>
    </>
  );
}
