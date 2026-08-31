import { Check } from "lucide-react";
import { REVIEW_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";
import { countryScanLabel, productMatchScanLabel } from "@/lib/buyerFinder/scanPresentation";
import { revealPriorityReason } from "@/lib/buyerFinder/revealPriorityPresentation";
import type { CandidateCardInput } from "./CandidateCard";
import { PriorityBadge, ReviewLink, surfaceStyle } from "./workspaceChrome";

function productDisplay(id: string): string {
  return findBusinessProductById(id)?.displayName ?? id;
}

export function PriorityContactRow({
  record,
  index,
}: {
  record: CandidateCardInput;
  index: number;
}) {
  const {
    candidate,
    productMatches,
    contactCount,
    bestContactTitle,
    bestContactName,
    bestHasLinkedin,
    priorityReason,
    publicCompanyEmail,
    revealPriority,
  } = record;
  const tier = revealPriority === "high" || revealPriority === "medium" ? revealPriority : "medium";
  const reason = priorityReason || revealPriorityReason(bestContactTitle, tier);
  const href = `/buyer-finder/candidate/${candidate.id}`;
  const rank = String(index + 1).padStart(2, "0");

  return (
    <article
      className="rounded-[12px] px-4 py-3.5 duration-150 motion-reduce:transition-none hover:bg-app-hover/50"
      style={surfaceStyle(tier === "high")}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="min-w-0 flex gap-3">
          <span className="tabular-nums text-[12px] text-text-muted pt-1">{rank}</span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-text-primary truncate">
              {bestContactName || "Unnamed contact"}
            </div>
            <div className="mt-0.5 text-[13px] text-text-secondary">{bestContactTitle || "—"}</div>
            <div className="mt-1 text-[12.5px] text-text-muted">
              {candidate.companyName} · {countryScanLabel(candidate.country)}
              <span className="text-text-muted/80"> · {REVIEW_STATUS_LABELS[candidate.reviewStatus]}</span>
              {record.convertedBuyerId ? (
                <span className="text-text-muted/80"> · Buyer created</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <PriorityBadge tier={tier} />
          {reason && <p className="mt-2 text-[13px] text-text-secondary">{reason}</p>}
        </div>

        <div className="min-w-0 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between lg:flex-col lg:items-stretch xl:flex-row xl:items-end">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-text-secondary">
            <span>
              Company email {publicCompanyEmail ? <Check className="inline" size={12} aria-label="available" /> : "—"}
            </span>
            <span>
              LinkedIn {bestHasLinkedin ? <Check className="inline" size={12} aria-label="available" /> : "—"}
            </span>
            <span>
              {contactCount} {contactCount === 1 ? "person" : "people"} found
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            {productMatches[0] && (
              <span className="text-[12px] text-text-muted truncate">
                {productDisplay(productMatches[0].productId)}
                <span className="sr-only"> · {productMatchScanLabel(productMatches[0])}</span>
              </span>
            )}
            <ReviewLink href={href} />
          </div>
        </div>
      </div>
    </article>
  );
}
