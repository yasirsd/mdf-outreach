import { Linkedin, Lock } from "lucide-react";
import type { BuyerCandidateContact } from "@/lib/buyerFinder/types";
import { revealPriorityReason } from "@/lib/buyerFinder/revealPriorityPresentation";
import { revealPriorityTierForTitle } from "@/lib/buyerFinder/revealPriority";

export function SecondaryPersonRow({ contact }: { contact: BuyerCandidateContact }) {
  const tier = revealPriorityTierForTitle(contact.jobTitle);
  const reason = revealPriorityReason(contact.jobTitle, tier);
  const locked = !contact.businessEmail;
  const linkedin = Boolean(contact.linkedinAvailable || contact.linkedinUrl);
  const signals = [
    linkedin ? "LinkedIn" : null,
    locked ? "Email locked" : null,
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-1.5 border-b border-[color-mix(in_srgb,var(--app-border)_55%,transparent)] last:border-0">
      <div className="text-[13px] font-medium text-text-primary truncate">
        {contact.fullName || "Unnamed"}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] text-text-secondary truncate">{contact.jobTitle || "—"}</div>
        {reason && <div className="text-[12px] text-text-muted truncate">{reason}</div>}
      </div>
      <div className="flex items-center gap-1.5 text-[12px] text-text-muted whitespace-nowrap">
        {linkedin && <Linkedin size={11} aria-hidden />}
        {locked && !linkedin && <Lock size={11} aria-hidden />}
        {signals.join(" · ")}
      </div>
    </div>
  );
}
