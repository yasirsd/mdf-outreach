"use client";

/**
 * BI3 — small research trigger for the Buyer Intelligence panel.
 *
 * Manual only. Renders as a compact action; while a run is in flight it
 * shows a truthful "Researching public website…" state without a fake
 * progress bar. On completion it surfaces the outcome message returned
 * by the server action, then routes a refresh so the panel updates
 * from the persisted BI2 assessment (no browser-side scoring).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import {
  researchCandidateWebsiteAction,
  type WebsiteResearchSummary,
} from "@/app/(app)/buyer-finder/websiteIntelligenceActions";

export function BuyerIntelligenceWebsiteResearch({
  candidateId,
  canResearch,
}: {
  candidateId: string;
  /**
   * Optional gate that hides the action when the candidate has no
   * usable website/domain. Defaults to `true` so the server action
   * remains the authority — an invalid candidate simply returns
   * `invalid_input` and the UI reports a truthful message.
   */
  canResearch?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lastSummary, setLastSummary] = useState<WebsiteResearchSummary | undefined>();
  const enabled = canResearch !== false;

  function run() {
    if (pending || !enabled) return;
    startTransition(async () => {
      try {
        const summary = await researchCandidateWebsiteAction(candidateId);
        setLastSummary(summary);
        if (summary.outcome === "researched" || summary.outcome === "partial") {
          const total = summary.claimsCreated + summary.claimsExisting;
          toast.success(
            `Website research complete · ${total} business fact${total === 1 ? "" : "s"} recorded · ${summary.pagesFetched} page${summary.pagesFetched === 1 ? "" : "s"} checked`,
          );
          router.refresh();
          return;
        }
        if (summary.outcome === "no_evidence") {
          toast.info(summary.message ?? "No qualifying business evidence found.");
          router.refresh();
          return;
        }
        toast.error(summary.message ?? "Could not research website.");
      } catch {
        toast.error("Could not research website.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        className="btn-secondary"
        onClick={run}
        disabled={pending || !enabled}
        aria-live="polite"
      >
        {pending ? "Researching public website…" : "Research company website · Free"}
      </button>
      {!pending && lastSummary ? (
        <p className="text-[12px] text-text-muted leading-relaxed">
          {researchResultLine(lastSummary)}
        </p>
      ) : null}
      {!pending ? (
        <p className="text-[11.5px] text-text-muted leading-relaxed">
          Manual only. Reads only this company&apos;s own public website. No paid providers.
        </p>
      ) : null}
    </div>
  );
}

function researchResultLine(summary: WebsiteResearchSummary): string {
  const parts: string[] = [];
  const total = summary.claimsCreated + summary.claimsExisting;
  if (summary.outcome === "researched" || summary.outcome === "partial") {
    parts.push(`${total} business fact${total === 1 ? "" : "s"} recorded`);
    parts.push(`${summary.pagesFetched} page${summary.pagesFetched === 1 ? "" : "s"} checked`);
    parts.push("No verified trade evidence found");
    return parts.join(" · ");
  }
  if (summary.outcome === "no_evidence") return "No qualifying business evidence found.";
  return summary.message ?? "Website research did not complete.";
}
