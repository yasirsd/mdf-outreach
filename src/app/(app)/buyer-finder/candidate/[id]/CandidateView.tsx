"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Archive,
  Check,
  Linkedin,
  Lock,
  Search,
} from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { AsyncButton } from "@/components/ui/AsyncButton";
import { PageContainer } from "@/components/ui/Page";
import { CompanyPublicContactPanel } from "@/components/buyerFinder/CompanyPublicContactPanel";
import { EvidenceList } from "@/components/buyerFinder/EvidenceList";
import { SecondaryPersonRow } from "@/components/buyerFinder/SecondaryPersonRow";
import { ScoreBadge } from "@/components/buyerFinder/ScoreBadge";
import {
  DISCOVERY_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  type BuyerCandidateContact,
} from "@/lib/buyerFinder/types";
import type { FreeEnrichmentJobStatus } from "@/lib/buyerFinder/freeEnrichmentJob";
import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";
import { productMatchScanLabel } from "@/lib/buyerFinder/scanPresentation";
import {
  COMPANY_FIT_MAX,
  COMPLETENESS_MAX,
  CONTACT_QUALITY_MAX,
  scoreBuyerCandidate,
} from "@/lib/buyerFinder/scoring";
import { candidateSourceLabel } from "@/lib/buyerFinder/source";
import { candidateWebsiteLabel, safeCandidateWebsiteHref } from "@/lib/buyerFinder/websiteDisplay";
import type { HunterDiscoveryAvailability } from "@/lib/buyerFinder/hunterAvailability";
import type { HunterRevealAvailability } from "@/lib/buyerFinder/hunterRevealAvailability";
import type { PublicWebsiteAvailability } from "@/lib/buyerFinder/publicWebsiteAvailability";
import {
  assessRevealPriority,
  compareRevealPriorityContacts,
} from "@/lib/buyerFinder/revealPriority";
import {
  revealPriorityBadgeLabel,
  revealPriorityReason,
} from "@/lib/buyerFinder/revealPriorityPresentation";
import { researchJobLabel } from "@/lib/buyerFinder/researchPresentation";
import { revealCandidatePersonalContactAction } from "@/app/(app)/buyer-finder/revealActions";
import {
  approveCandidateAction,
  archiveCandidateAction,
  rejectCandidateAction,
} from "@/app/(app)/buyer-finder/actions";
import type { CandidateDetailRecord } from "@/app/(app)/buyer-finder/actions";
import { findCandidateDecisionMakersAction } from "@/app/(app)/buyer-finder/personActions";
import { Modal } from "@/components/ui/Modal";
import { CandidateConversionPanel } from "@/components/buyerFinder/CandidateConversionPanel";

function productName(id: string): string {
  return findBusinessProductById(id)?.displayName ?? id;
}

export function CandidateView({
  record,
  hunterDiscovery = "ready",
  hunterReveal = "disabled",
  publicWebsite = "ready",
  publicJobStatus,
  peopleJobStatus,
}: {
  record: CandidateDetailRecord;
  hunterDiscovery?: HunterDiscoveryAvailability;
  hunterReveal?: HunterRevealAvailability;
  publicWebsite?: PublicWebsiteAvailability;
  publicJobStatus?: FreeEnrichmentJobStatus;
  peopleJobStatus?: FreeEnrichmentJobStatus;
}) {
  const router = useRouter();
  const { candidate, contacts, productMatches, publicEmails = [], conversion, convertedBuyer } = record;
  const priority = assessRevealPriority({ candidate, contacts, publicEmails });
  const best =
    contacts.find((c) => c.id === priority.bestPerson?.contactId) ??
    contacts.find((c) => c.isPrimary);
  const others = contacts
    .filter((c) => c.id !== best?.id)
    .slice()
    .sort(compareRevealPriorityContacts);
  const hasContacts = contacts.length > 0;
  const sourceLabel = candidateSourceLabel(candidate.source);
  const scored = scoreBuyerCandidate({
    candidate,
    contacts,
    productMatches,
    targetProductId: productMatches[0]?.productId,
    targetCountry: candidate.country,
  });
  const companySide = scored.companyFit + scored.completeness;
  const companySideMax = COMPANY_FIT_MAX + COMPLETENESS_MAX;
  const isFinal =
    candidate.reviewStatus === "approved" ||
    candidate.reviewStatus === "rejected" ||
    candidate.discoveryStatus === "archived";
  const websiteHref = safeCandidateWebsiteHref(candidate.website, candidate.domain);
  const whyBest =
    priority.tier !== "none"
      ? revealPriorityReason(priority.bestPerson?.jobTitle, priority.tier)
      : "";
  const freeEmail =
    priority.publicCompanyEmail ||
    publicEmails.find((e) => e.isPrimary)?.email ||
    publicEmails[0]?.email ||
    candidate.generalEmail;

  const [pending, startTransition] = useTransition();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  function run(action: () => Promise<void>, successLabel: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(successLabel);
        router.refresh();
      } catch {
        toast.error("Could not update candidate.");
      }
    });
  }

  return (
    <PageContainer size="wide" className="!py-6 md:!py-7">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">
            {candidate.companyName}
          </h1>
          <p className="mt-1 text-[13.5px] text-text-secondary">
            {candidate.country || "—"}
            {websiteHref ? (
              <>
                {" · "}
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-primary hover:text-text-secondary"
                >
                  {candidateWebsiteLabel(websiteHref)}
                </a>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-[12px] text-text-muted">
            {sourceLabel ? <span>Source · {sourceLabel}</span> : null}
            {sourceLabel ? " · " : null}
            {DISCOVERY_STATUS_LABELS[candidate.discoveryStatus]}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12.5px] text-text-secondary">
            {REVIEW_STATUS_LABELS[candidate.reviewStatus]}
          </span>
          <Link href="/buyer-finder" className="btn-ghost">
            <ArrowLeft size={13} /> Queue
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-x-8 gap-y-6 items-start">
        <div className="min-w-0 space-y-5">
          {best && (
            <BestContactHero
              contact={best}
              tier={priority.tier}
              reason={whyBest}
            />
          )}

          <section>
            <div className="text-[11px] font-medium text-text-muted mb-3">Why this company</div>
            {productMatches.length === 0 ? (
              <p className="text-[13px] text-text-muted">No product match recorded.</p>
            ) : (
              <div className="space-y-3">
                {productMatches.map((m) => (
                  <div key={m.id}>
                    <div className="grid sm:grid-cols-3 gap-3">
                      <FitCell label="Product" value={productName(m.productId)} />
                      <FitCell label="Market" value={candidate.country || "—"} />
                      <FitCell label="Evidence" value={productMatchScanLabel(m)} />
                    </div>
                    <p className="mt-2.5 text-[12.5px] text-text-muted">
                      Directory discovery is an initial signal, not proof of importing.
                    </p>
                    <details className="group mt-1.5">
                      <summary className="cursor-pointer text-[12.5px] text-text-secondary list-none focus-ring-quiet rounded-sm">
                        View discovery details
                      </summary>
                      <div className="mt-2">
                        <EvidenceList evidence={m.evidence} />
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </section>

          {others.length > 0 && (
            <section className="max-w-3xl">
              <div className="text-[11px] font-medium text-text-muted mb-1">Other people</div>
              <div className="hidden sm:grid grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)_auto] gap-x-4 pb-1 text-[11px] text-text-muted">
                <span>Name</span>
                <span>Title</span>
                <span>Signals</span>
              </div>
              {others.map((c) => (
                <SecondaryPersonRow key={c.id} contact={c} />
              ))}
            </section>
          )}

          <details>
            <summary className="cursor-pointer text-[12.5px] text-text-muted list-none focus-ring-quiet rounded-sm">
              Scoring details
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <ScoreBadge value={scored.total} label="Overall" quiet />
              <ScoreBadge value={companySide} label="Company fit" max={companySideMax} quiet />
              {hasContacts ? (
                <ScoreBadge
                  value={scored.contactQuality}
                  label="Candidate contact quality"
                  max={CONTACT_QUALITY_MAX}
                  quiet
                />
              ) : (
                <span className="text-[12px] text-text-muted">Contact quality not evaluated</span>
              )}
              {best && (
                <ScoreBadge
                  value={best.contactScore ?? 0}
                  label="Person contact quality"
                  compact
                  quiet
                  max={CONTACT_QUALITY_MAX}
                />
              )}
            </div>
          </details>
        </div>

        <aside
          className="min-w-0 self-start rounded-[12px]"
          style={{ backgroundColor: "var(--app-surface)" }}
        >
          <div className="px-4 py-3 text-[12.5px] text-text-secondary space-y-1.5">
            <StatusLine
              label="Website"
              status={publicJobStatus}
              ready={Boolean(freeEmail) || publicJobStatus === "succeeded" || publicJobStatus === "no_result"}
            />
            <StatusLine
              label="People"
              status={peopleJobStatus}
              ready={hasContacts || peopleJobStatus === "succeeded" || peopleJobStatus === "no_result"}
            />
          </div>

          <div style={{ borderTop: "1px solid var(--app-border)" }}>
            <CompanyPublicContactPanel
              candidateId={candidate.id}
              emails={publicEmails}
              searchedAt={candidate.publicContactsSearchedAt}
              publicWebsite={publicWebsite}
              canSearch={!isFinal}
              jobStatus={publicJobStatus}
              standalone={false}
              onComplete={(message) => {
                toast.success(message);
                router.refresh();
              }}
              onError={(message) => toast.error(message)}
            />
          </div>

          <PersonDiscoveryPanel
            candidateId={candidate.id}
            hasContacts={hasContacts}
            searched={Boolean(candidate.peopleSearchedAt)}
            hasMore={Boolean(candidate.peopleHasMore)}
            hunterDiscovery={hunterDiscovery}
            canSearch={!isFinal}
            jobStatus={peopleJobStatus}
            embedded
            onComplete={(message) => {
              toast.success(message);
              router.refresh();
            }}
            onError={(message) => toast.error(message)}
          />

          {best && (
            <PersonalContactPanel
              contact={best}
              hunterReveal={hunterReveal}
              freeEmail={freeEmail}
              embedded
            />
          )}

          <CandidateConversionPanel
            candidateId={candidate.id}
            companyName={candidate.companyName}
            approved={candidate.reviewStatus === "approved"}
            convertedBuyer={convertedBuyer ?? (conversion ? { id: conversion.buyerId, email: "", company: candidate.companyName } : undefined)}
          />

          <div className="px-4 py-3" style={{ borderTop: "1px solid var(--app-border)" }}>
            <p className="text-[12px] text-text-muted mb-2.5 leading-relaxed">
              Approving does NOT create a Buyer. Approve only marks this candidate for a later manual
              Buyer conversion.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              <button
                type="button"
                className="btn-primary w-auto"
                disabled={pending || isFinal || candidate.reviewStatus === "approved"}
                onClick={() =>
                  run(
                    () => approveCandidateAction(candidate.id),
                    "Candidate approved",
                  )
                }
              >
                Approve for Buyer review
              </button>
              {!showRejectInput ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={pending || candidate.reviewStatus === "rejected"}
                  onClick={() => setShowRejectInput(true)}
                >
                  Reject
                </button>
              ) : (
                <div className="space-y-2 w-full">
                  <input
                    className="input h-9 w-full"
                    placeholder="Reason (optional)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => rejectCandidateAction(candidate.id, rejectReason),
                          "Candidate rejected",
                        )
                      }
                    >
                      Confirm reject
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setShowRejectInput(false);
                        setRejectReason("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                className="btn-ghost"
                disabled={pending || candidate.discoveryStatus === "archived"}
                onClick={() =>
                  run(
                    () => archiveCandidateAction(candidate.id),
                    "Candidate archived",
                  )
                }
              >
                <Archive size={13} /> Archive
              </button>
            </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}

function StatusLine({
  label,
  status,
  ready,
}: {
  label: string;
  status?: FreeEnrichmentJobStatus;
  ready: boolean;
}) {
  const failed = status === "failed";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-text-primary">
        {failed ? "Needs attention" : ready ? <><Check size={12} aria-hidden /> Ready</> : researchJobLabel(status)}
      </span>
    </div>
  );
}

function BestContactHero({
  contact,
  tier,
  reason,
}: {
  contact: BuyerCandidateContact;
  tier: ReturnType<typeof assessRevealPriority>["tier"];
  reason: string;
}) {
  const badge = revealPriorityBadgeLabel(tier);
  const linkedin = Boolean(contact.linkedinAvailable || contact.linkedinUrl);
  const locked = !contact.businessEmail;
  const meta = [contact.department, contact.seniority]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" · ");
  return (
    <section>
      <div className="text-[11px] font-medium text-text-muted mb-2">Best contact</div>
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <div className="text-[20px] font-semibold tracking-tight text-text-primary">
            {contact.fullName || "Unnamed contact"}
          </div>
          <div className="mt-0.5 text-[14.5px] text-text-secondary">{contact.jobTitle || "—"}</div>
        </div>
        {badge && (
          <span
            className="shrink-0 text-[11px] font-medium pt-1.5"
            style={{ color: tier === "high" ? "var(--brand-orange)" : "var(--text-secondary)" }}
          >
            {badge}
          </span>
        )}
      </div>
      {reason && <p className="mt-2 text-[13.5px] text-text-secondary">{reason}</p>}
      <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-5 gap-y-1 text-[12.5px] text-text-secondary">
        {contact.isDecisionMaker && (
          <span>
            Decision maker
            {meta ? <span className="text-text-muted"> · {meta}</span> : null}
          </span>
        )}
        {linkedin && (
          <span className="inline-flex items-center gap-1">
            <Linkedin size={12} aria-hidden /> LinkedIn ✓
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-text-muted">
          <Lock size={12} aria-hidden />
          {locked ? "Personal email locked" : "Personal email revealed"}
        </span>
      </div>
    </section>
  );
}

function PersonalContactPanel({
  contact,
  hunterReveal,
  freeEmail,
  embedded = false,
}: {
  contact: BuyerCandidateContact;
  hunterReveal: HunterRevealAvailability;
  freeEmail?: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canReveal =
    hunterReveal === "ready" &&
    (contact.source ?? "").toLowerCase() === "hunter" &&
    contact.emailType === "personal" &&
    !contact.businessEmail;

  async function confirmReveal() {
    if (pending) return;
    setPending(true);
    try {
      const result = await revealCandidatePersonalContactAction(contact.id);
      if (result.outcome === "success") {
        toast.success(result.message ?? "Contact revealed.");
        setConfirmOpen(false);
        router.refresh();
        return;
      }
      toast.error(result.message ?? "Could not reveal this contact.");
    } catch {
      toast.error("Could not reveal this contact.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={embedded ? "px-4 py-3" : "rounded-[12px] p-4"}
      style={
        embedded
          ? { borderTop: "1px solid var(--app-border)" }
          : { backgroundColor: "var(--app-surface)" }
      }
    >
      <div className="text-[11px] font-medium text-text-muted mb-2">Personal contact</div>
      <p className="text-[13px] text-text-primary">
        {contact.businessEmail || "Email not revealed"}
      </p>
      {!contact.businessEmail && <p className="sr-only">Not revealed. Personal email is not revealed.</p>}
      <p className="mt-1 text-[12.5px] text-text-muted">Hunter personal reveal · Up to 1 Search credit</p>
      {freeEmail && (
        <p className="mt-1 text-[12.5px] text-text-muted">
          Free company contact available · {freeEmail}
        </p>
      )}
      {hunterReveal !== "ready" && (
        <p className="mt-2 text-[12.5px] text-text-muted">Reveal locked on this server</p>
      )}
      {canReveal && (
        <button type="button" className="btn-secondary mt-3" onClick={() => setConfirmOpen(true)}>
          Review personal reveal
        </button>
      )}
      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!pending) setConfirmOpen(false);
        }}
        title="Reveal personal contact"
        busy={pending}
        size="sm"
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <AsyncButton variant="primary" pending={pending} pendingLabel="Revealing…" onClick={confirmReveal}>
              Reveal contact · up to 1 credit
            </AsyncButton>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-text-secondary leading-relaxed">
          <p>Hunter may use up to 1 Search credit to reveal this person&apos;s professional contact details.</p>
          {freeEmail && <p>Free company email already available: {freeEmail}</p>}
        </div>
      </Modal>
    </section>
  );
}

function FitCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-medium text-text-primary">{value}</div>
    </div>
  );
}

function PersonDiscoveryPanel({
  candidateId,
  hasContacts,
  searched,
  hasMore,
  hunterDiscovery,
  canSearch,
  jobStatus,
  embedded = false,
  onComplete,
  onError,
}: {
  candidateId: string;
  hasContacts: boolean;
  searched: boolean;
  hasMore: boolean;
  hunterDiscovery: HunterDiscoveryAvailability;
  canSearch: boolean;
  jobStatus?: FreeEnrichmentJobStatus;
  embedded?: boolean;
  onComplete: (message: string) => void;
  onError: (message: string) => void;
}) {
  const gated = hunterDiscovery !== "ready";
  const disabledReason =
    hunterDiscovery === "not_configured" ? "Hunter is not configured on this server." : null;

  async function runSearch() {
    const result = await findCandidateDecisionMakersAction(candidateId);
    if (result.outcome === "success") {
      onComplete(
        result.hasMore
          ? "Decision makers saved. More people exist that were not fetched."
          : "Decision makers saved.",
      );
      return;
    }
    if (result.outcome === "no_result") {
      onComplete(result.message ?? "No matching people were found at this company domain.");
      return;
    }
    if (result.outcome === "already_running") {
      onComplete(result.message ?? "Lookup in progress.");
      return;
    }
    onError(result.message ?? "Could not search for decision makers.");
  }

  return (
    <section
      className={embedded ? "px-4 py-3" : "rounded-[12px] p-4"}
      style={
        embedded
          ? { borderTop: "1px solid var(--app-border)" }
          : { backgroundColor: "var(--app-surface)" }
      }
    >
      <div className="text-[11px] font-medium text-text-muted mb-2">People research</div>
      <span className="sr-only">Decision makers</span>
      {!hasContacts && !searched && (
        <p className="text-[13px] text-text-primary mb-2">
          Decision makers have not been searched yet.
        </p>
      )}
      {!hasContacts && searched && (
        <p className="text-[13px] text-text-primary mb-2">
          No matching people were found at this company domain.
        </p>
      )}
      {hasContacts && (
        <p className="text-[13px] text-text-primary mb-1">
          {jobStatus ? researchJobLabel(jobStatus) : "Ready"}
        </p>
      )}
      <p className="text-[12.5px] text-text-muted mb-3">
        Hunter masked professional data · Free. No contact credits are used.
      </p>
      <AsyncButton
        variant="secondary"
        icon={<Search size={13} />}
        pendingLabel="Searching…"
        disabled={!canSearch || gated}
        onClick={runSearch}
        onError={() => onError("Could not search for decision makers.")}
      >
        {jobStatus === "failed"
          ? "Retry now"
          : searched
            ? "Refresh decision makers · Free"
            : "Find decision makers · Free"}
      </AsyncButton>
      {disabledReason && <p className="mt-2 text-[12px] text-text-muted">{disabledReason}</p>}
      {hasMore && (
        <p className="mt-2 text-[12px] text-text-muted">
          More people may exist. This search does not load additional pages.
        </p>
      )}
    </section>
  );
}
