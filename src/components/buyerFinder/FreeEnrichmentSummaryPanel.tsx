import { Mail, UsersRound, Star } from "lucide-react";
import type { FreeEnrichmentSummary } from "@/lib/buyerFinder/freeEnrichmentSummary";
import { researchFeedbackCopy } from "@/lib/buyerFinder/researchPresentation";

export function FreeEnrichmentSummaryPanel({
  summary,
  paused = false,
  pausedReason,
}: {
  summary: FreeEnrichmentSummary;
  paused?: boolean;
  pausedReason?: string;
}) {
  const ready = summary.ready ?? summary.complete;
  const researching =
    summary.researching ?? summary.inProgress + summary.retrying + summary.queued;
  const companiesWithEmail = summary.companiesWithPublicEmail ?? summary.publicEmailsFound;
  const people = summary.peopleFound ?? summary.decisionMakersFound;
  const checksRemaining = summary.checksRemaining ?? researching;
  const feedback = researchFeedbackCopy({
    researching,
    needsAttention: summary.needsAttention,
    ready,
    companies: summary.companies,
    checksRemaining,
    paused,
    pausedReason,
  });
  const readyShare = summary.companies > 0 ? (ready / summary.companies) * 100 : 0;
  const attentionShare =
    summary.companies > 0 ? (summary.needsAttention / summary.companies) * 100 : 0;

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="text-[11px] font-medium text-text-muted">Free research</div>
        <p className="text-[13px] text-text-secondary">{feedback}</p>
      </div>

      {summary.companies > 0 && (
        <div className="mb-4">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-[12.5px] text-text-secondary">
              Ready <span className="tabular-nums font-semibold text-text-primary">{ready}</span>
            </span>
            <span className="text-[12px] text-text-muted tabular-nums">
              {summary.companies} companies
            </span>
            <span className="text-[12.5px] text-text-secondary">
              Need attention{" "}
              <span className="tabular-nums font-semibold text-text-primary">
                {summary.needsAttention}
              </span>
            </span>
          </div>
          <div
            className="flex h-2 gap-0.5 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--app-hover)" }}
            role="img"
            aria-label={`${ready} ready and ${summary.needsAttention} need attention of ${summary.companies} companies`}
          >
            {readyShare > 0 && (
              <span
                className="h-full rounded-sm bg-zinc-300"
                style={{ width: `${readyShare}%` }}
              />
            )}
            {attentionShare > 0 && (
              <span
                className="h-full rounded-sm bg-zinc-600"
                style={{ width: `${attentionShare}%` }}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <Mail size={13} className="text-text-muted" aria-hidden />
          <span className="tabular-nums font-medium text-text-primary">{companiesWithEmail}</span>
          with email
          <span className="sr-only">Companies with public email</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <UsersRound size={13} className="text-text-muted" aria-hidden />
          <span className="tabular-nums font-medium text-text-primary">{people}</span>
          people
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Star size={13} className="text-text-muted" aria-hidden />
          <span className="tabular-nums font-medium text-text-primary">{summary.highRevealPriority}</span>
          priority contacts
          <span className="sr-only">High-priority contacts</span>
        </span>
      </div>
    </section>
  );
}
