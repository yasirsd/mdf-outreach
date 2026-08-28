import Link from "next/link";
import { MapPin, UsersRound } from "lucide-react";
import type {
  BuyerCandidate,
  BuyerCandidateProductMatch,
} from "@/lib/buyerFinder/types";
import { REVIEW_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { findBusinessProductById } from "@/lib/buyerFinder/businessCatalogue";
import { productMatchStrengthLabel } from "@/lib/buyerFinder/scorePresentation";
import { ScoreBadge } from "./ScoreBadge";

function productDisplay(id: string): string {
  return findBusinessProductById(id)?.displayName ?? id;
}

export interface CandidateCardInput {
  candidate: BuyerCandidate;
  productMatches: BuyerCandidateProductMatch[];
  /** Number of persisted contacts; may be 0 for BF2 Hunter candidates. */
  contactCount: number;
}

export function CandidateCard({ record }: { record: CandidateCardInput }) {
  const { candidate, productMatches, contactCount } = record;

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
          <ScoreBadge value={candidate.companyScore ?? 0} label="Overall" />
          <span className="text-[11px] text-text-muted">
            {REVIEW_STATUS_LABELS[candidate.reviewStatus]}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--app-border)" }}>
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-2">
          Product matches
        </div>
        {productMatches.length === 0 ? (
          <div className="text-[12.5px] text-text-muted">No product match recorded.</div>
        ) : (
          <ul className="space-y-1.5">
            {productMatches.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-text-primary">{productDisplay(m.productId)}</span>
                <span className="tabular-nums text-text-secondary">
                  {productMatchStrengthLabel(m)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 pt-4 flex items-center gap-2 text-[12.5px] text-text-muted" style={{ borderTop: "1px solid var(--app-border)" }}>
        <UsersRound size={13} />
        {contactCount === 0 ? (
          <span>Contact enrichment not run yet</span>
        ) : (
          <span>
            {contactCount} contact{contactCount === 1 ? "" : "s"} on file
          </span>
        )}
      </div>

      <div className="mt-5">
        <Link href={`/buyer-finder/candidate/${candidate.id}`} className="btn-secondary">
          View candidate
        </Link>
      </div>
    </article>
  );
}
