"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone, Star } from "lucide-react";
import type { BuyerCandidateContact } from "@/lib/buyerFinder/types";
import { EMAIL_STATUS_LABELS } from "@/lib/buyerFinder/types";
import { CONTACT_QUALITY_MAX } from "@/lib/buyerFinder/scoring";
import { sanitizeLinkedinProfileUrl } from "@/lib/buyerFinder/linkedinUrl";
import type { HunterRevealAvailability } from "@/lib/buyerFinder/hunterRevealAvailability";
import { revealCandidatePersonalContactAction } from "@/app/(app)/buyer-finder/revealActions";
import { Modal } from "@/components/ui/Modal";
import { AsyncButton } from "@/components/ui/AsyncButton";
import { toast } from "@/components/ui/Toast";
import { ScoreBadge } from "./ScoreBadge";

function availabilityLabel(available: boolean | undefined): string {
  if (available === true) return "Available";
  if (available === false) return "Not available";
  return "Unknown";
}

function canRevealPersonal(
  contact: BuyerCandidateContact,
  hunterReveal: HunterRevealAvailability,
): boolean {
  if (hunterReveal !== "ready") return false;
  if ((contact.source ?? "").toLowerCase() !== "hunter") return false;
  if (contact.emailType !== "personal") return false;
  if (contact.businessEmail) return false;
  return true;
}

export function ContactBlock({
  contact,
  recommended = false,
  compact = false,
  hunterReveal = "disabled",
  generalEmail,
  searchCreditsRemaining,
}: {
  contact: BuyerCandidateContact;
  recommended?: boolean;
  compact?: boolean;
  hunterReveal?: HunterRevealAvailability;
  generalEmail?: string;
  searchCreditsRemaining?: number;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const masked = !contact.businessEmail;
  const meta = [contact.department, contact.seniority].filter(Boolean).join(" · ");
  const linkedinHref = sanitizeLinkedinProfileUrl(contact.linkedinUrl);
  const showReveal = !compact && canRevealPersonal(contact, hunterReveal);
  const revealed = Boolean(contact.revealedAt) || Boolean(contact.businessEmail && contact.source === "hunter");

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
    <div
      className={compact ? "rounded-[10px] px-3.5 py-3" : "rounded-[12px] p-4"}
      style={{
        backgroundColor: recommended ? "var(--app-elevated)" : "transparent",
        border: recommended
          ? "1px solid rgba(243,107,33,0.20)"
          : "1px solid color-mix(in srgb, var(--app-border) 70%, transparent)",
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
          <div className="mt-0.5 text-[12.5px] text-text-secondary">{contact.jobTitle || "—"}</div>
          {meta && <div className="mt-0.5 text-[11.5px] text-text-muted">{meta}</div>}
          {contact.isDecisionMaker && (
            <div className="mt-1.5 text-[12px] text-text-muted">
              Decision maker
            </div>
          )}
          {revealed && !masked && (
            <div className="mt-1.5 text-[11px] uppercase tracking-[0.08em] text-text-muted">
              Hunter · Revealed
            </div>
          )}
        </div>
        {!compact && (
          <ScoreBadge
            value={contact.contactScore ?? 0}
            label="Contact quality"
            compact
            quiet
            max={CONTACT_QUALITY_MAX}
          />
        )}
      </div>

      <div className="mt-3 flex items-start gap-2 text-[13px]">
        <Mail size={13} className="mt-0.5 text-text-muted shrink-0" />
        <div className="min-w-0">
          {masked ? (
            <>
              <div className="text-text-primary">Not revealed</div>
              <div className="mt-0.5 text-[11.5px] text-text-muted">
                {hunterReveal === "ready"
                  ? showReveal
                    ? "Personal email is hidden until you reveal it."
                    : "This contact cannot be revealed."
                  : "Email reveal is locked."}
              </div>
            </>
          ) : (
            <>
              <div className="text-text-primary truncate">{contact.businessEmail}</div>
              <div className="mt-0.5 text-[11.5px] text-text-muted">
                {contact.emailStatus ? EMAIL_STATUS_LABELS[contact.emailStatus] : "Unverified"}
                <span className="tabular-nums"> · {contact.emailConfidence ?? 0}% confidence</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 text-[12.5px] text-text-secondary">
        {linkedinHref ? (
          <a
            href={linkedinHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-primary hover:text-brand-orange transition-colors"
          >
            View profile ↗
          </a>
        ) : (
          <>LinkedIn {availabilityLabel(contact.linkedinAvailable)}</>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-text-secondary">
        <Phone size={12} className="text-text-muted" />
        {contact.phoneNumber ? contact.phoneNumber : `Phone ${availabilityLabel(contact.phoneAvailable)}`}
      </div>

      {showReveal && (
        <div className="mt-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
          >
            Review personal reveal
          </button>
        </div>
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
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <AsyncButton
              variant="primary"
              pending={pending}
              pendingLabel="Revealing…"
              onClick={confirmReveal}
            >
              Reveal contact · up to 1 credit
            </AsyncButton>
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-text-secondary leading-relaxed">
          <p>
            Hunter may use up to 1 Search credit to reveal this person&apos;s professional contact
            details.
          </p>
          <p>
            If Hunter already revealed this row during the current billing period, it may cost 0
            credits.
          </p>
          {typeof searchCreditsRemaining === "number" && (
            <p className="tabular-nums">Hunter Search credits: {searchCreditsRemaining} remaining</p>
          )}
          <p>
            {generalEmail
              ? `Free company email already available: ${generalEmail}`
              : "No free public company email found"}
          </p>
          <p>Potential details: personal email, full name, LinkedIn URL, and phone number, if Hunter has them.</p>
        </div>
      </Modal>
    </div>
  );
}
