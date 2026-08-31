"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { AsyncButton } from "@/components/ui/AsyncButton";
import { Modal } from "@/components/ui/Modal";
import {
  previewCandidateConversionAction,
  convertCandidateToBuyerAction,
} from "@/app/(app)/buyer-finder/conversionActions";
import type { ConversionPreviewResult } from "@/app/(app)/buyer-finder/conversionActions";
import type { ConversionOption, ConversionSelectionInput } from "@/lib/buyerFinder/conversion";
import { buyerOpenHref } from "@/lib/buyerFinder/conversion";

export function CandidateConversionPanel({
  candidateId,
  companyName,
  approved,
  convertedBuyer,
}: {
  candidateId: string;
  companyName: string;
  approved: boolean;
  convertedBuyer?: { id: string; email: string; company: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ConversionPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  if (convertedBuyer) {
    const href = buyerOpenHref(convertedBuyer);
    return (
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--app-border)" }}>
        <div className="text-[11px] font-medium text-text-muted mb-1">CONVERTED TO BUYER</div>
        <p className="text-[13px] text-text-primary leading-relaxed">
          {companyName} is now available in Buyers.
        </p>
        <Link href={href} className="btn-secondary mt-3 inline-flex">
          Open Buyer
        </Link>
      </div>
    );
  }

  if (!approved) return null;

  async function openPreview(selection?: ConversionSelectionInput) {
    setLoading(true);
    try {
      const next = await previewCandidateConversionAction({
        candidateId,
        contactId: selection?.contactId,
        publicEmailId: selection?.publicEmailId,
        companyOnly: selection?.kind === "company_only" ? true : undefined,
      });
      setPreview(next);
      setOpen(true);
    } catch {
      toast.error("Could not load conversion preview.");
    } finally {
      setLoading(false);
    }
  }

  async function changeSelection(option: ConversionOption) {
    if (!option.selectable) return;
    const selection: ConversionSelectionInput =
      option.kind === "revealed_personal_contact"
        ? { kind: "revealed_personal_contact", contactId: option.contactId }
        : option.kind === "public_company_email"
          ? { kind: "public_company_email", publicEmailId: option.publicEmailId }
          : { kind: "company_only" };
    await openPreview(selection);
  }

  async function createBuyer() {
    if (!preview || preview.createBlocked || creating) return;
    setCreating(true);
    try {
      const result = await convertCandidateToBuyerAction({
        candidateId,
        contactId: preview.selected.contactId,
        publicEmailId: preview.selected.publicEmailId,
        companyOnly: preview.sourceKind === "company_only" ? true : undefined,
      });
      if (result.outcome === "created") {
        toast.success("Buyer created.");
        setOpen(false);
        router.refresh();
        return;
      }
      if (result.outcome === "already_converted") {
        toast.success(result.message ?? "This candidate is already a Buyer.");
        setOpen(false);
        router.refresh();
        return;
      }
      if (result.outcome === "duplicate") {
        const next = await previewCandidateConversionAction({
          candidateId,
          contactId: preview.selected.contactId,
          publicEmailId: preview.selected.publicEmailId,
          companyOnly: preview.sourceKind === "company_only" ? true : undefined,
        });
        setPreview(next);
        toast.error(result.message ?? "A matching Buyer already exists.");
        return;
      }
      toast.error(result.message ?? "Could not create Buyer.");
    } catch {
      toast.error("Could not create Buyer.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="px-4 py-3" style={{ borderTop: "1px solid var(--app-border)" }}>
      <div className="text-[11px] font-medium text-text-muted mb-1">READY FOR BUYER CONVERSION</div>
      <p className="text-[12.5px] text-text-muted leading-relaxed">
        Research is preserved. Converting creates a Buyer in Outreach. It does not send any email.
      </p>
      <button
        type="button"
        className="btn-primary mt-3 w-auto"
        disabled={loading}
        onClick={() => openPreview()}
      >
        Convert to Buyer
      </button>
      <ConversionPreviewModal
        companyName={companyName}
        preview={preview}
        open={open}
        busy={loading || creating}
        creating={creating}
        onClose={() => {
          if (!creating) setOpen(false);
        }}
        onSelect={changeSelection}
        onCreate={createBuyer}
      />
    </div>
  );
}

function ConversionPreviewModal({
  companyName,
  preview,
  open,
  busy,
  creating,
  onClose,
  onSelect,
  onCreate,
}: {
  companyName: string;
  preview: ConversionPreviewResult | null;
  open: boolean;
  busy: boolean;
  creating: boolean;
  onClose: () => void;
  onSelect: (option: ConversionOption) => void;
  onCreate: () => void;
}) {
  const blocked = !preview || preview.createBlocked;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Convert ${companyName} to Buyer`}
      busy={busy}
      size="md"
      actions={
        <>
          <button type="button" className="btn-ghost" disabled={creating} onClick={onClose}>
            Cancel
          </button>
          <AsyncButton
            variant="primary"
            pending={creating}
            pendingLabel="Creating…"
            disabled={blocked}
            onClick={onCreate}
          >
            Create Buyer
          </AsyncButton>
        </>
      }
    >
      {preview ? <PreviewBody preview={preview} onSelect={onSelect} /> : null}
    </Modal>
  );
}

function PreviewBody({
  preview,
  onSelect,
}: {
  preview: ConversionPreviewResult;
  onSelect: (option: ConversionOption) => void;
}) {
  const mapping = preview.mapping;
  return (
    <div className="space-y-4 text-[13px] text-text-secondary leading-relaxed">
      <section>
        <div className="text-[11px] font-medium text-text-muted mb-1">COMPANY</div>
        <p className="text-text-primary">{mapping.company || preview.companyName}</p>
        <p>{preview.country}</p>
        {preview.websiteLabel ? <p>{preview.websiteLabel}</p> : null}
      </section>

      <section>
        <div className="text-[11px] font-medium text-text-muted mb-2">Contact for Buyer</div>
        <div className="space-y-2">
          {preview.options.map((option, index) => (
            <ContactChoice
              key={optionKey(option, index)}
              option={option}
              selected={isSelected(option, preview.selected)}
              hasPublicEmail={preview.options.some((o) => o.kind === "public_company_email")}
              onSelect={() => onSelect(option)}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="text-[11px] font-medium text-text-muted mb-1">PRODUCT INTEREST</div>
        <p className="text-text-primary">{mapping.productInterest || "—"}</p>
      </section>

      <section>
        <div className="text-[11px] font-medium text-text-muted mb-1">SOURCE</div>
        <p className="text-text-primary">{mapping.source}</p>
      </section>

      <DuplicateState preview={preview} />

      {preview.missingEmail && preview.duplicate === "none" && preview.eligibility === "ok" ? (
        <p>
          No contact email selected. This Buyer will require contact enrichment before email outreach.
        </p>
      ) : null}

      <p className="text-[12.5px] text-text-muted">
        Creates one Buyer in MDF Outreach. No email will be sent.
      </p>
    </div>
  );
}

function DuplicateState({ preview }: { preview: ConversionPreviewResult }) {
  if (preview.duplicate === "none") {
    return <p className="text-text-primary">✓ No matching Buyer found</p>;
  }
  const match = preview.duplicateMatch;
  return (
    <section>
      <div className="text-[11px] font-medium text-text-muted mb-1">POSSIBLE EXISTING BUYER</div>
      {match ? (
        <>
          <p className="text-text-primary">{match.company}</p>
          {match.email ? <p>{match.email}</p> : null}
          {preview.buyerHref ? (
            <Link href={preview.buyerHref} className="btn-secondary mt-2 inline-flex">
              View Buyer
            </Link>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ContactChoice({
  option,
  selected,
  hasPublicEmail,
  onSelect,
}: {
  option: ConversionOption;
  selected: boolean;
  hasPublicEmail: boolean;
  onSelect: () => void;
}) {
  const disabled = !option.selectable;
  return (
    <label
      className={`flex items-start gap-2 rounded-[8px] px-2 py-1.5 ${disabled ? "opacity-60" : "cursor-pointer"}`}
    >
      <input
        type="radio"
        name="conversion-contact"
        className="mt-1"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
      <span className="min-w-0">
        {option.kind === "revealed_personal_contact" && (
          <>
            <span className="block text-text-primary">{option.label}</span>
            {option.title ? <span className="block">{option.title}</span> : null}
            <span className="block">{option.email}</span>
            <span className="block text-[12px] text-text-muted">Personal contact · revealed</span>
          </>
        )}
        {option.kind === "masked_person" && (
          <>
            <span className="block text-text-primary">{option.label}</span>
            {option.title ? <span className="block">{option.title}</span> : null}
            <span className="block">Personal email not revealed</span>
            <span className="block text-[12px] text-text-muted">NOT selectable as personal email source</span>
          </>
        )}
        {option.kind === "public_company_email" && (
          <>
            <span className="block text-text-primary">{option.email}</span>
            <span className="block text-[12px] text-text-muted">Company email · Free</span>
          </>
        )}
        {option.kind === "company_only" && (
          <>
            <span className="block text-text-primary">Company only</span>
            {!hasPublicEmail ? (
              <span className="block text-[12px] text-text-muted">No company email available</span>
            ) : null}
          </>
        )}
      </span>
    </label>
  );
}

function optionKey(option: ConversionOption, index: number): string {
  if (option.kind === "revealed_personal_contact" || option.kind === "masked_person") {
    return option.contactId;
  }
  if (option.kind === "public_company_email") return option.publicEmailId;
  return `company-only-${index}`;
}

function isSelected(option: ConversionOption, selected: ConversionSelectionInput): boolean {
  if (option.kind === "revealed_personal_contact") {
    return selected.kind === "revealed_personal_contact" && selected.contactId === option.contactId;
  }
  if (option.kind === "public_company_email") {
    return selected.kind === "public_company_email" && selected.publicEmailId === option.publicEmailId;
  }
  if (option.kind === "company_only") {
    return selected.kind === "company_only";
  }
  return false;
}
