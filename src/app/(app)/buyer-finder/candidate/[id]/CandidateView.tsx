"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Archive,
  Building2,
  Globe,
  MapPin,
  UsersRound,
} from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { ContactBlock } from "@/components/buyerFinder/ContactBlock";
import { EvidenceList } from "@/components/buyerFinder/EvidenceList";
import { ScoreBadge } from "@/components/buyerFinder/ScoreBadge";
import {
  DISCOVERY_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  type BuyerCandidateRecord,
} from "@/lib/buyerFinder/types";
import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";
import { productMatchStrengthLabel } from "@/lib/buyerFinder/scorePresentation";
import {
  COMPANY_FIT_MAX,
  COMPLETENESS_MAX,
  scoreBuyerCandidate,
} from "@/lib/buyerFinder/scoring";
import { candidateSourceLabel } from "@/lib/buyerFinder/source";
import {
  approveCandidateAction,
  archiveCandidateAction,
  rejectCandidateAction,
} from "@/app/(app)/buyer-finder/actions";

function productName(id: string): string {
  return findBusinessProductById(id)?.displayName ?? id;
}

export function CandidateView({ record }: { record: BuyerCandidateRecord }) {
  const router = useRouter();
  const { candidate, contacts, productMatches } = record;
  const primary = contacts.find((c) => c.isPrimary);
  const others = contacts.filter((c) => !c.isPrimary);
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
    <PageContainer>
      <PageHeader
        title={candidate.companyName}
        subtitle="Approve to queue this candidate for a later manual Buyer conversion. Approving does NOT create a Buyer."
        actions={
          <Link href="/buyer-finder" className="btn-ghost">
            <ArrowLeft size={13} /> Queue
          </Link>
        }
      />

      <div className={`flex flex-wrap items-center gap-2 ${hasContacts ? "mb-6" : "mb-2"}`}>
        <ScoreBadge value={candidate.companyScore ?? scored.total} label="Overall" />
        {!hasContacts && (
          <ScoreBadge value={companySide} label="Company" max={companySideMax} />
        )}
        <span className="chip">{DISCOVERY_STATUS_LABELS[candidate.discoveryStatus]}</span>
        <span className="chip">{REVIEW_STATUS_LABELS[candidate.reviewStatus]}</span>
        {sourceLabel && <span className="chip">Source · {sourceLabel}</span>}
      </div>
      {!hasContacts && (
        <p className="text-[12px] text-text-muted mb-6">Contact quality not evaluated</p>
      )}

      <div className="grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
        <section
          className="rounded-[12px] p-5"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-4">
            Company
          </div>
          <dl className="space-y-3.5 text-[13px]">
            <Row icon={<Building2 size={13} />} label="Industry">
              {candidate.industry || "—"}
            </Row>
            <Row icon={<Building2 size={13} />} label="Buyer type">
              {candidate.buyerType || "—"}
            </Row>
            <Row icon={<MapPin size={13} />} label="Location">
              {[candidate.city, candidate.country].filter(Boolean).join(", ") || "—"}
            </Row>
            <Row icon={<Globe size={13} />} label="Website">
              {candidate.website ? (
                <a
                  href={candidate.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-primary hover:text-brand-orange transition-colors"
                >
                  {candidate.website.replace(/^https?:\/\//, "")} ↗
                </a>
              ) : (
                "—"
              )}
            </Row>
          </dl>
          {candidate.companyLinkedinUrl && (
            <a
              href={candidate.companyLinkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex text-[13px] text-text-secondary hover:text-brand-orange transition-colors"
            >
              Open LinkedIn ↗
            </a>
          )}
        </section>

        <section
          className="rounded-[12px] p-5"
          style={{
            backgroundColor: "var(--app-surface)",
            border: "1px solid var(--app-border)",
          }}
        >
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-3">
            Why this company matched
          </div>
          {productMatches.length === 0 ? (
            <p className="text-[13px] text-text-muted">No product match recorded.</p>
          ) : (
            <div className="space-y-5">
              {productMatches.map((m) => (
                <div key={m.id}>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <div className="text-[13.5px] font-medium text-text-primary">
                      {productName(m.productId)}
                    </div>
                    <div className="text-[12.5px] tabular-nums text-text-secondary">
                      {productMatchStrengthLabel(m)}
                    </div>
                  </div>
                  <EvidenceList evidence={m.evidence} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-4">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-3">
          Contacts
        </div>
        {!hasContacts ? (
          <div
            className="rounded-[12px] p-5 flex items-center gap-3 text-[12.5px] text-text-muted"
            style={{
              backgroundColor: "var(--app-surface)",
              border: "1px solid var(--app-border)",
            }}
          >
            <UsersRound size={14} />
            <span>
              Contact enrichment has not been run for this candidate yet.
              MDF Outreach never fabricates contacts for real companies.
            </span>
          </div>
        ) : (
          <>
            {primary && <ContactBlock contact={primary} recommended />}
            {others.length > 0 && (
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                {others.map((c) => (
                  <ContactBlock key={c.id} contact={c} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <div
        className="mt-8 rounded-[12px] p-5 flex flex-wrap items-center justify-between gap-3"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
      >
        <p className="text-[12.5px] text-text-muted max-w-xl leading-relaxed">
          Approving does NOT create a Buyer. Buyer conversion will be a separate manual action in a
          future phase.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
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
          {!showRejectInput ? (
            <button
              type="button"
              className="btn-danger"
              disabled={pending || candidate.reviewStatus === "rejected"}
              onClick={() => setShowRejectInput(true)}
            >
              Reject
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="input h-9 w-[200px]"
                placeholder="Reason (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value.slice(0, 500))}
              />
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
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={pending || isFinal || candidate.reviewStatus === "approved"}
            onClick={() =>
              run(
                () => approveCandidateAction(candidate.id),
                "Candidate approved",
              )
            }
          >
            Approve
          </button>
        </div>
      </div>
    </PageContainer>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-text-muted">{icon}</div>
      <div className="min-w-0">
        <dt className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
          {label}
        </dt>
        <dd className="mt-0.5 text-text-primary">{children}</dd>
      </div>
    </div>
  );
}
