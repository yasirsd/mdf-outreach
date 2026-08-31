"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  formatUsageResetDate,
  primaryUsageBucket,
  type ProviderUsage,
} from "@/lib/buyerFinder/usage";
import { ProviderUsageDetails } from "./ProviderUsageDetails";
import type { HunterRevealAvailability } from "@/lib/buyerFinder/hunterRevealAvailability";

export type UsageIndicatorState = "ok" | "not_configured" | "unavailable" | "disabled" | null;

/**
 * Hunter usage indicator.
 *
 * Company discovery and masked people discovery are free whenever
 * Hunter is configured. There is no operator enable switch.
 * Contact/email credits are a separate personal-reveal concern.
 */
export function ProviderUsageIndicator({
  usage,
  state,
  hunterReveal = "disabled",
}: {
  usage: ProviderUsage | null;
  state: UsageIndicatorState;
  hunterReveal?: HunterRevealAvailability;
}) {
  const [open, setOpen] = useState(false);
  const primary = usage ? primaryUsageBucket(usage) : undefined;
  const remaining = primary?.bucket.remaining ?? 0;
  const resetLabel = usage ? formatUsageResetDate(usage.resetDate) : null;
  const configured = state !== "not_configured" && state !== "disabled";

  const discoveryLabel = configured ? "People · Free" : "Not configured";

  const trailing =
    !configured
      ? null
      : state === "unavailable"
        ? "Usage unavailable"
        : primary
          ? `Personal reveal · ${remaining} credits`
          : "No personal reveal credits reported";

  const aria = `Hunter · ${discoveryLabel}${trailing ? ` · ${trailing}` : ""}${resetLabel ? `, resets ${resetLabel}` : ""}. Open details.`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={aria}
        className="inline-flex items-center gap-2 text-left focus-ring-quiet rounded-sm"
      >
        <span className="text-[11.5px] font-medium text-text-secondary whitespace-nowrap">
          Hunter
        </span>
        <span className="text-[11.5px] text-text-muted whitespace-nowrap">
          {discoveryLabel}
        </span>
        {state === "ok" && primary && (
          <>
            <span aria-hidden className="text-text-muted/35">
              |
            </span>
            <span className="text-[11.5px] tabular-nums text-text-muted whitespace-nowrap">
              Personal reveal · {remaining} credits
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
          configured
            ? "Company discovery and decision-maker discovery are free. Contact / email credits are a separate Hunter plan concern."
            : "Hunter is not configured on this server."
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
                {configured
                  ? "Free — no credits consumed for the Hunter Discover endpoint."
                  : "Not configured. Add a Hunter API key to enable company discovery."}
              </div>
            </div>
            <div
              className="rounded-[10px] p-3.5 text-[12.5px]"
              style={{
                backgroundColor: "var(--app-surface)",
                border: "1px solid var(--app-border)",
              }}
            >
              <div className="font-medium text-text-primary mb-1">Decision-maker discovery</div>
              <div className="text-text-secondary">
                {configured
                  ? "Free — masked professional records. No contact credits are used."
                  : "Not configured. Add a Hunter API key to enable people discovery."}
              </div>
            </div>
            <div
              className="rounded-[10px] p-3.5 text-[12.5px]"
              style={{
                backgroundColor: "var(--app-surface)",
                border: "1px solid var(--app-border)",
              }}
            >
              <div className="font-medium text-text-primary mb-1">
                {hunterReveal === "ready" ? "Personal contact reveal" : "Email/contact reveal"}
              </div>
              <div className="text-text-secondary">
                {hunterReveal === "ready"
                  ? "Up to 1 Hunter Search credit per person. Already-revealed rows in the current billing period may cost 0."
                  : "Locked. Reveal is not available on this server."}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] tracking-[0.16em] uppercase text-text-muted font-medium mb-2">
                Contact / email credits
              </div>
              {!configured && (
                <p className="text-[12.5px] text-text-muted">
                  Hunter is not configured on this server. Contact MDF admin.
                </p>
              )}
              {state === "unavailable" && (
                <p className="text-[12.5px] text-text-muted">
                  Usage information is currently unavailable. Discovery is not affected.
                </p>
              )}
              {state === "ok" && usage && (
                <ProviderUsageDetails usage={usage} hunterReveal={hunterReveal} />
              )}
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
