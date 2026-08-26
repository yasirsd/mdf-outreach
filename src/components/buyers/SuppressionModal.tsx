"use client";

import { useMemo, useState } from "react";
import { ShieldOff, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Buyer, BuyerSuppressionReason } from "@/lib/types";
import { BUYER_SUPPRESSION_REASON_LABELS } from "@/lib/types";

const REASONS: BuyerSuppressionReason[] = ["manual", "opted_out", "invalid_email", "other"];

export function SuppressionModal({
  open,
  buyer,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  buyer: Pick<Buyer, "id" | "company" | "firstName" | "lastName" | "email">;
  onClose: () => void;
  onConfirm: (input: {
    reason: BuyerSuppressionReason;
    note?: string;
  }) => Promise<void> | void;
  busy?: boolean;
}) {
  const [reason, setReason] = useState<BuyerSuppressionReason>("manual");
  const [note, setNote] = useState("");
  const noteRequired = reason === "other";
  const canSubmit = useMemo(
    () => (!noteRequired || note.trim().length > 0) && !busy,
    [noteRequired, note, busy],
  );

  const label =
    buyer.company?.trim() ||
    [buyer.firstName, buyer.lastName].filter(Boolean).join(" ").trim() ||
    buyer.email;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="md"
      title="Do not contact this buyer?"
      subtitle={label}
      actions={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                reason,
                note: note.trim() ? note.trim() : undefined,
              })
            }
          >
            <ShieldOff size={13} /> Suppress buyer
          </button>
        </>
      }
    >
      <div className="px-6 py-5 space-y-5">
        <div>
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted mb-2">
            Reason
          </div>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => {
              const active = r === reason;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className="text-left rounded-[10px] px-3 py-2 transition-colors"
                  style={{
                    backgroundColor: active
                      ? "rgba(243,107,33,0.10)"
                      : "var(--app-surface)",
                    border: active
                      ? "1px solid var(--brand-orange)"
                      : "1px solid var(--app-border)",
                  }}
                >
                  <div className="text-[13px] text-text-primary font-medium">
                    {BUYER_SUPPRESSION_REASON_LABELS[r]}
                  </div>
                  <div className="text-[11.5px] text-text-muted mt-0.5">
                    {reasonHelp(r)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted">
            Note {noteRequired ? "(required)" : "(optional)"}
          </span>
          <textarea
            className="input mt-1.5 min-h-[68px] text-[13px] leading-relaxed"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            placeholder="Short context so the next operator understands why."
          />
          <div className="mt-1 text-[11.5px] text-text-muted">
            The note appears in the buyer activity log. Do not include personal data.
          </div>
        </label>

        <div
          className="rounded-[10px] px-3 py-3 text-[12.5px] leading-relaxed"
          style={{
            backgroundColor: "rgba(239,108,92,0.08)",
            border: "1px solid rgba(239,108,92,0.25)",
            color: "#F0A19A",
          }}
        >
          This buyer will be blocked from all future Buyer Send operations until suppression is removed.
        </div>
      </div>
    </Modal>
  );
}

export function UnsuppressionModal({
  open,
  buyer,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  buyer: Pick<Buyer, "company" | "firstName" | "lastName" | "email">;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  busy?: boolean;
}) {
  const label =
    buyer.company?.trim() ||
    [buyer.firstName, buyer.lastName].filter(Boolean).join(" ").trim() ||
    buyer.email;
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="md"
      title="Remove suppression?"
      subtitle={label}
      actions={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onConfirm()} disabled={busy}>
            <ShieldCheck size={13} /> Remove suppression
          </button>
        </>
      }
    >
      <div className="px-6 py-5 text-[13px] leading-relaxed text-text-secondary">
        This buyer will become eligible for production Buyer Send again. The previous
        suppression event remains in the activity log for audit.
      </div>
    </Modal>
  );
}

function reasonHelp(r: BuyerSuppressionReason): string {
  if (r === "manual") return "Operator-initiated hold on outreach.";
  if (r === "opted_out") return "Recipient explicitly asked not to be contacted.";
  if (r === "invalid_email") return "The email address is wrong or unreachable.";
  return "Free-form reason — a short note is required.";
}
