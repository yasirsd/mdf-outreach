import { Mail, Star } from "lucide-react";
import type { BuyerCandidateContact } from "@/lib/buyerFinder/types";
import { EMAIL_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { ScoreBadge } from "./ScoreBadge";

export function ContactBlock({
  contact,
  recommended = false,
}: {
  contact: BuyerCandidateContact;
  recommended?: boolean;
}) {
  return (
    <div
      className="rounded-[12px] p-4"
      style={{
        backgroundColor: "var(--app-elevated)",
        border: recommended
          ? "1px solid rgba(243,107,33,0.28)"
          : "1px solid var(--app-border)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-text-primary">
            {recommended && (
              <Star size={12} className="text-brand-orange fill-brand-orange shrink-0" />
            )}
            <span className="truncate">{contact.fullName || "Unnamed contact"}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-text-secondary">{contact.jobTitle}</div>
        </div>
        <ScoreBadge value={contact.contactScore ?? 0} label="Contact" compact />
      </div>

      <div className="mt-3 flex items-start gap-2 text-[13px]">
        <Mail size={13} className="mt-0.5 text-text-muted shrink-0" />
        <div className="min-w-0">
          <div className="text-text-primary truncate">{contact.businessEmail}</div>
          <div className="mt-0.5 text-[11.5px] text-text-muted">
            {contact.emailStatus ? EMAIL_STATUS_LABELS[contact.emailStatus] : "Unverified"}
            <span className="tabular-nums"> · {contact.emailConfidence ?? 0}% confidence</span>
          </div>
        </div>
      </div>

      {contact.linkedinUrl && (
        <a
          href={contact.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex text-[12.5px] text-text-secondary hover:text-brand-orange transition-colors"
        >
          Open LinkedIn ↗
        </a>
      )}
    </div>
  );
}
