import Link from "next/link";
import { MapPin } from "lucide-react";
import type { BuyerCandidateRecord } from "@/lib/buyerFinder/types";
import { REVIEW_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { PRODUCT_CATALOGUE } from "@/lib/email/themes/catalogue";
import { otherContacts, primaryContact } from "@/lib/buyerFinder/mock/candidates";
import { ScoreBadge } from "./ScoreBadge";

function productName(key: string): string {
  return PRODUCT_CATALOGUE.find((p) => p.key === key)?.name ?? key;
}

export function CandidateCard({ record }: { record: BuyerCandidateRecord }) {
  const { candidate, productMatches } = record;
  const primary = primaryContact(record);
  const others = otherContacts(record);

  return (
    <article
      className="rounded-[12px] p-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15.5px] font-semibold tracking-tight text-text-primary truncate">
            {candidate.companyName}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-text-secondary">
            <MapPin size={12} className="text-text-muted shrink-0" />
            {[candidate.city, candidate.country].filter(Boolean).join(", ")}
          </div>
          <div className="mt-1.5 text-[12.5px] text-text-muted">
            {candidate.buyerType || "—"}
            {candidate.industry ? ` · ${candidate.industry}` : ""}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <ScoreBadge value={candidate.companyScore ?? 0} label="Buyer" />
          <span className="text-[11px] text-text-muted">
            {REVIEW_STATUS_LABELS[candidate.reviewStatus]}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--app-border)" }}>
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-2">
          Product matches
        </div>
        <ul className="space-y-1.5">
          {productMatches.map((m) => (
            <li key={m.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-text-primary">{productName(m.productKey)}</span>
              <span className="tabular-nums text-text-secondary">{m.relevance ?? 0}% relevance</span>
            </li>
          ))}
        </ul>
      </div>

      {primary && (
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--app-border)" }}>
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-2">
            Contacts
          </div>
          <div className="text-[13.5px] font-medium text-text-primary">
            ★ {primary.fullName}
          </div>
          <div className="text-[12.5px] text-text-secondary">{primary.jobTitle}</div>
          <div className="mt-0.5 text-[12.5px] text-text-muted truncate">
            {primary.businessEmail}
          </div>
          {others.length > 0 && (
            <div className="mt-2 text-[12px] text-text-muted">
              Other contacts: {others.map((c) => c.jobTitle).join(" · ")}
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <Link href={`/buyer-finder/candidate/${candidate.id}`} className="btn-secondary">
          View candidate
        </Link>
      </div>
    </article>
  );
}
