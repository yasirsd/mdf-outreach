"use client";

import Link from "next/link";
import { ArrowLeft, Building2, Globe, MapPin } from "lucide-react";
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
import { PRODUCT_CATALOGUE } from "@/lib/email/themes/catalogue";
import { otherContacts, primaryContact } from "@/lib/buyerFinder/mock/candidates";

function productName(key: string): string {
  return PRODUCT_CATALOGUE.find((p) => p.key === key)?.name ?? key;
}

export function CandidateView({ record }: { record: BuyerCandidateRecord }) {
  const { candidate, productMatches } = record;
  const primary = primaryContact(record);
  const others = otherContacts(record);

  function rejectUiOnly() {
    toast.info("Rejection is UI-only in Phase 1. Nothing is saved.");
  }

  return (
    <PageContainer>
      <PageHeader
        title={candidate.companyName}
        subtitle="Mock candidate — review only. Approval into Buyers is not enabled yet."
        actions={
          <Link href="/buyer-finder" className="btn-ghost">
            <ArrowLeft size={13} /> Queue
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <ScoreBadge value={candidate.companyScore ?? 0} label="Buyer" />
        <span className="chip">{DISCOVERY_STATUS_LABELS[candidate.discoveryStatus]}</span>
        <span className="chip">{REVIEW_STATUS_LABELS[candidate.reviewStatus]}</span>
      </div>

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
          <div className="space-y-5">
            {productMatches.map((m) => (
              <div key={m.id}>
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="text-[13.5px] font-medium text-text-primary">
                    {productName(m.productKey)}
                  </div>
                  <div className="text-[12.5px] tabular-nums text-text-secondary">
                    {m.relevance ?? 0}% relevance
                  </div>
                </div>
                <EvidenceList evidence={m.evidence} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-4">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-3">
          Recommended contact
        </div>
        {primary ? (
          <ContactBlock contact={primary} recommended />
        ) : (
          <p className="text-[13px] text-text-muted">No contact on this mock candidate.</p>
        )}
      </section>

      {others.length > 0 && (
        <section className="mt-6">
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-3">
            Other potential contacts
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {others.map((c) => (
              <ContactBlock key={c.id} contact={c} />
            ))}
          </div>
        </section>
      )}

      <div
        className="mt-8 rounded-[12px] p-5 flex flex-wrap items-center justify-between gap-3"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
      >
        <p className="text-[12.5px] text-text-muted max-w-xl leading-relaxed">
          Phase 1 is a visual shell. Approve is disabled so this candidate cannot enter Buyers.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-danger" onClick={rejectUiOnly}>
            Reject
          </button>
          <button type="button" className="btn-primary" disabled>
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
