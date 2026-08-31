import { Check, Mail, UsersRound } from "lucide-react";
import { REVIEW_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";
import { countryScanLabel, productMatchScanLabel } from "@/lib/buyerFinder/scanPresentation";
import { jobStatusLabel } from "@/lib/buyerFinder/freeEnrichmentSummary";
import { revealPriorityReason } from "@/lib/buyerFinder/revealPriorityPresentation";
import type { CandidateCardInput } from "./CandidateCard";
import { PriorityBadge, ReviewLink, surfaceStyle } from "./workspaceChrome";

function productDisplay(id: string): string {
  return findBusinessProductById(id)?.displayName ?? id;
}

export function CompanyIntelligenceCard({ record }: { record: CandidateCardInput }) {
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
    publicJobStatus,
    peopleJobStatus,
    convertedBuyerId,
  } = record;
  const priority = revealPriority === "high" || revealPriority === "medium" ? revealPriority : undefined;
  const reason =
    priorityReason ||
    (priority ? revealPriorityReason(bestContactTitle, priority) : undefined);
  const hasPerson = Boolean(bestContactName || bestContactTitle);
  const href = `/buyer-finder/candidate/${candidate.id}`;
  const websiteFailed = publicJobStatus === "failed";

  return (
    <article
      className="block h-fit w-full rounded-[12px] p-3.5 duration-150 motion-reduce:transition-none hover:bg-app-hover/50"
      style={surfaceStyle(priority === "high")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15.5px] font-semibold tracking-tight text-text-primary truncate">
            {candidate.companyName}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            {countryScanLabel(candidate.country)}
            <span className="text-text-muted"> · {REVIEW_STATUS_LABELS[candidate.reviewStatus]}</span>
            {convertedBuyerId ? <span className="text-text-muted"> · Buyer created</span> : null}
          </p>
        </div>
        {priority && <PriorityBadge tier={priority} />}
      </div>

      {hasPerson ? (
        <div className="mt-2.5">
          {bestContactName && (
            <div className="text-[14px] font-medium text-text-primary">{bestContactName}</div>
          )}
          {bestContactTitle && (
            <div className="mt-0.5 text-[13px] text-text-secondary">{bestContactTitle}</div>
          )}
          {reason && <p className="mt-0.5 text-[12.5px] text-text-muted">{reason}</p>}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-text-secondary">
        <span className="inline-flex items-center gap-1">
          {publicCompanyEmail ? (
            <Check size={12} aria-hidden />
          ) : (
            <Mail size={12} className="text-text-muted" aria-hidden />
          )}
          {publicCompanyEmail
            ? "Company email"
            : websiteFailed
              ? "Website research needs attention"
              : publicJobStatus === "no_result"
                ? "No company email found"
                : `Website · ${jobStatusLabel(publicJobStatus)}`}
        </span>
        {hasPerson && bestHasLinkedin && (
          <span className="inline-flex items-center gap-1">
            <Check size={12} aria-hidden /> LinkedIn
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <UsersRound size={12} className="text-text-muted" aria-hidden />
          {contactCount > 0
            ? `${contactCount} ${contactCount === 1 ? "person" : "people"} found`
            : peopleJobStatus === "no_result" || peopleJobStatus === "succeeded"
              ? "No decision makers found"
              : peopleJobStatus
                ? `People · ${jobStatusLabel(peopleJobStatus)}`
                : "Decision makers not searched yet"}
        </span>
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0 text-[12px] text-text-muted truncate">
          {productMatches.length > 0
            ? productMatches.map((m) => (
                <span key={m.id} className="mr-3">
                  {productDisplay(m.productId)} · {productMatchScanLabel(m)}
                </span>
              ))
            : null}
        </div>
        <ReviewLink href={href} className="shrink-0" />
      </div>
    </article>
  );
}
