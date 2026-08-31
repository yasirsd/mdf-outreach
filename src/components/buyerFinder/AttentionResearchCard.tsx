"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, RotateCw } from "lucide-react";
import { REVIEW_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { countryScanLabel } from "@/lib/buyerFinder/scanPresentation";
import { jobStatusLabel } from "@/lib/buyerFinder/freeEnrichmentSummary";
import { findCandidatePublicCompanyContactsAction } from "@/app/(app)/buyer-finder/publicContactActions";
import { findCandidateDecisionMakersAction } from "@/app/(app)/buyer-finder/personActions";
import { toast } from "@/components/ui/Toast";
import type { CandidateCardInput } from "./CandidateCard";
import { PriorityBadge, ReviewLink, surfaceStyle } from "./workspaceChrome";

export function AttentionResearchCard({ record }: { record: CandidateCardInput }) {
  const { candidate, contactCount, publicJobStatus, peopleJobStatus } = record;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const websiteFailed = publicJobStatus === "failed";
  const peopleFailed = peopleJobStatus === "failed";
  const href = `/buyer-finder/candidate/${candidate.id}`;

  function retryWebsite() {
    startTransition(async () => {
      const result = await findCandidatePublicCompanyContactsAction(candidate.id);
      if (
        result.outcome === "success" ||
        result.outcome === "ok" ||
        result.outcome === "no_result" ||
        result.outcome === "already_running"
      ) {
        toast.success(result.message ?? "Website research updated.");
        router.refresh();
        return;
      }
      toast.error(result.message ?? "Could not retry website research.");
    });
  }

  function retryPeople() {
    startTransition(async () => {
      const result = await findCandidateDecisionMakersAction(candidate.id);
      if (
        result.outcome === "success" ||
        result.outcome === "ok" ||
        result.outcome === "no_result" ||
        result.outcome === "already_running"
      ) {
        toast.success(result.message ?? "People research updated.");
        router.refresh();
        return;
      }
      toast.error(result.message ?? "Could not retry people research.");
    });
  }

  return (
    <article
      className="rounded-[12px] p-4 duration-150 motion-reduce:transition-none hover:bg-app-hover/50"
      style={surfaceStyle()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15.5px] font-semibold tracking-tight text-text-primary truncate">
            {candidate.companyName}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            {countryScanLabel(candidate.country)}
            <span className="text-text-muted"> · {REVIEW_STATUS_LABELS[candidate.reviewStatus]}</span>
            {record.convertedBuyerId ? <span className="text-text-muted"> · Buyer created</span> : null}
          </p>
        </div>
        <PriorityBadge tier="attention" />
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        <Capability
          title="Website research"
          failed={websiteFailed}
          okLabel={jobStatusLabel(publicJobStatus)}
          failLabel="Unavailable"
          failHint="Automatic retries exhausted"
        />
        <Capability
          title="People research"
          failed={peopleFailed}
          okLabel={
            contactCount > 0
              ? `${contactCount} ${contactCount === 1 ? "person" : "people"} found`
              : peopleJobStatus === "no_result"
                ? "No decision makers found"
                : jobStatusLabel(peopleJobStatus)
          }
          failLabel="Needs attention"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {websiteFailed && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={retryWebsite}>
              <RotateCw size={13} /> Retry website
            </button>
          )}
          {peopleFailed && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={retryPeople}>
              <RotateCw size={13} /> Retry people
            </button>
          )}
        </div>
        <ReviewLink href={href} />
      </div>
    </article>
  );
}

function Capability({
  title,
  failed,
  okLabel,
  failLabel,
  failHint,
}: {
  title: string;
  failed: boolean;
  okLabel: string;
  failLabel: string;
  failHint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-text-muted mb-1">{title}</div>
      <div className="flex items-start gap-2 text-[13px]">
        {failed ? (
          <AlertTriangle size={14} className="mt-0.5 text-text-secondary shrink-0" aria-hidden />
        ) : (
          <Check size={14} className="mt-0.5 text-text-muted shrink-0" aria-hidden />
        )}
        <div>
          <div className="text-text-primary">{failed ? failLabel : okLabel}</div>
          {failed && failHint && <div className="mt-0.5 text-[12px] text-text-muted">{failHint}</div>}
        </div>
      </div>
    </div>
  );
}
