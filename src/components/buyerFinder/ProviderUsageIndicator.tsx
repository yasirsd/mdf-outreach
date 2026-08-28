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

export type UsageIndicatorState = "ok" | "not_configured" | "unavailable" | "disabled" | null;

/**
 * BF2 — Hunter usage indicator.
 *
 * Semantics (from BF2 brief):
 *   • Hunter Discover is FREE and NOT gated by the 50-credit contact/email
 *     bucket. The trigger row always displays "Discovery · Free" and the
 *     modal shows credits as a SEPARATE contact/email concern.
 *   • When Hunter is not configured, or when the usage endpoint fails,
 *     the row still renders — with a quiet informational state — because
 *     Discover itself is still usable when the operator has the key
 *     configured.
 */
export function ProviderUsageIndicator({
  usage,
  state,
}: {
  usage: ProviderUsage | null;
  state: UsageIndicatorState;
}) {
  const [open, setOpen] = useState(false);
  const primary = usage ? primaryUsageBucket(usage) : undefined;
  const remaining = primary?.bucket.remaining ?? 0;
  const percent = primary?.bucket.percentUsed ?? 0;
  const level = usageLevel(percent);
  const resetLabel = usage ? formatUsageResetDate(usage.resetDate) : null;

  const discoveryLabel = state === "disabled" ? "Discovery · Disabled" : "Discovery · Free";

  const trailing =
    state === "disabled"
      ? null
      : state === "not_configured"
        ? "Not configured"
        : state === "unavailable"
          ? "Usage unavailable"
          : primary
            ? `${remaining} contact credits`
            : "No contact credits reported";

  const aria = `Hunter · ${discoveryLabel}${trailing ? ` · ${trailing}` : ""}${resetLabel ? `, resets ${resetLabel}` : ""}. Open details.`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={aria}
        className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left hover:bg-app-hover focus-ring-quiet"
        style={{ border: "1px solid var(--app-border)" }}
      >
        <span className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium">
          Hunter
        </span>
        <span className="text-[11.5px] text-text-secondary whitespace-nowrap">
          {discoveryLabel}
        </span>
        {state === "ok" && primary && (
          <>
            <span
              role="presentation"
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
              {remaining} credits
            </span>
          </>
        )}
        {state !== "ok" && trailing && (
          <span className="text-[11.5px] text-text-muted whitespace-nowrap">
            · {trailing}
          </span>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Hunter"
        subtitle={
          state === "disabled"
            ? "Hunter company discovery is disabled on this server."
            : "Company discovery is free. Contact / email credits are a separate Hunter plan concern."
        }
        size="sm"
      >
        {open ? (
          <div className="space-y-4">
            <div
              className="rounded-[10px] p-3.5 text-[12.5px]"
              style={{
                backgroundColor: "var(--app-surface)",
                border: "1px solid var(--app-border)",
              }}
            >
              <div className="font-medium text-text-primary mb-1">Company discovery</div>
              <div className="text-text-secondary">
                {state === "disabled"
                  ? "Disabled on this server. No Discover request is sent."
                  : "Free — no credits consumed for the Hunter Discover endpoint."}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted font-medium mb-2">
                Contact / email credits
              </div>
              {state === "disabled" && (
                <p className="text-[12.5px] text-text-muted">
                  Hunter company discovery is disabled. Contact / email credits are not fetched.
                </p>
              )}
              {state === "not_configured" && (
                <p className="text-[12.5px] text-text-muted">
                  Hunter is not configured on this server. Contact MDF admin.
                </p>
              )}
              {state === "unavailable" && (
                <p className="text-[12.5px] text-text-muted">
                  Usage information is currently unavailable. Discovery is not affected.
                </p>
              )}
              {state === "ok" && usage && <ProviderUsageDetails usage={usage} />}
              {state === "ok" && usage && !primary && (
                <p className="mt-2 text-[12.5px] text-text-muted">
                  Contact credits are not reported by Hunter for this key.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
