"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { Campaign } from "@/lib/types";
import { updateCampaignAction } from "@/app/(app)/campaigns/actions";
import { toast } from "@/components/ui/Toast";

export const SUBJECT_MAX = 200;
export const PREHEADER_MAX = 200;
export const FROM_NAME_MAX = 120;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = "subject" | "preheader" | "fromName" | "replyTo";

interface Props {
  campaign: Campaign;
  onSaved: (patch: Partial<Campaign>) => void;
}

export function EmailDetailsPanel({ campaign, onSaved }: Props) {
  const [subject, setSubject] = useState(campaign.subject ?? "");
  const [preheader, setPreheader] = useState(campaign.preheader ?? "");
  const [fromName, setFromName] = useState(campaign.fromName ?? "");
  const [replyTo, setReplyTo] = useState(campaign.replyTo ?? "");
  const [savingField, setSavingField] = useState<Field | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  function validate(field: Field, value: string): string | null {
    const v = value.trim();
    if (field === "subject") {
      if (!v) return "Subject is required before sending.";
      if (v.length > SUBJECT_MAX) return `Max ${SUBJECT_MAX} characters.`;
    }
    if (field === "preheader" && v.length > PREHEADER_MAX) {
      return `Max ${PREHEADER_MAX} characters.`;
    }
    if (field === "fromName" && v.length > FROM_NAME_MAX) {
      return `Max ${FROM_NAME_MAX} characters.`;
    }
    if (field === "replyTo" && v && !EMAIL_RE.test(v)) {
      return "Enter a valid email address (or leave blank).";
    }
    return null;
  }

  async function commit(field: Field, next: string, current: string) {
    const trimmed = next.trim();
    if (trimmed === (current ?? "")) return; // no-op
    const err = validate(field, trimmed);
    setErrors((e) => ({ ...e, [field]: err ?? undefined }));
    if (err) return;

    setSavingField(field);
    try {
      const patch: Partial<Campaign> = { [field]: trimmed } as Partial<Campaign>;
      await updateCampaignAction(campaign.id, patch);
      // Update the parent's local view so the preview header + send tab
      // reflect the new value immediately, before router.refresh() lands.
      onSaved(patch);
    } catch {
      toast.error(`Could not save ${label(field)}`);
    } finally {
      setSavingField(null);
    }
  }

  const subjectHint =
    !subject.trim() ? (
      <span style={{ color: "#F08B7E" }}>Required before sending.</span>
    ) : (
      <span className="text-text-muted">
        {SUBJECT_MAX - subject.trim().length} characters remaining.
      </span>
    );

  return (
    <section
      className="rounded-[12px] mb-5 px-5 py-4"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
      aria-label="Email details"
    >
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium">
          Email details
        </div>
        <div className="text-[11px] text-text-muted flex items-center gap-1.5">
          {savingField ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Saving {label(savingField)}…
            </>
          ) : (
            "Autosaves on blur"
          )}
        </div>
      </div>

      <div className="space-y-3">
        <FieldRow
          id="mdf-campaign-subject"
          label="Subject"
          required
          value={subject}
          onChange={setSubject}
          onBlur={() => commit("subject", subject, campaign.subject ?? "")}
          maxLength={SUBJECT_MAX}
          error={errors.subject}
          hint={subjectHint}
          prominent
          savedIndicator={savingField === null && !!subject.trim() && !errors.subject}
        />

        <FieldRow
          id="mdf-campaign-preheader"
          label="Preheader"
          value={preheader}
          onChange={setPreheader}
          onBlur={() => commit("preheader", preheader, campaign.preheader ?? "")}
          maxLength={PREHEADER_MAX}
          error={errors.preheader}
          hint={
            <span className="text-text-muted">
              Shown beside or below the subject in many inboxes.
            </span>
          }
        />

        <div className="grid md:grid-cols-2 gap-3">
          <FieldRow
            id="mdf-campaign-from-name"
            label="From name"
            value={fromName}
            onChange={setFromName}
            onBlur={() => commit("fromName", fromName, campaign.fromName ?? "")}
            maxLength={FROM_NAME_MAX}
            error={errors.fromName}
            hint={
              <span className="text-text-muted">
                Display name shown to recipients. The sender address itself is the
                connected Gmail account.
              </span>
            }
          />
          <FieldRow
            id="mdf-campaign-reply-to"
            label="Reply-to"
            value={replyTo}
            onChange={setReplyTo}
            onBlur={() => commit("replyTo", replyTo, campaign.replyTo ?? "")}
            type="email"
            placeholder="e.g. contact@mdfexport.com"
            error={errors.replyTo}
            hint={
              <span className="text-text-muted">
                Optional. Replies from the recipient go here instead of the sender.
              </span>
            }
          />
        </div>
      </div>
    </section>
  );
}

function FieldRow({
  id,
  label,
  required,
  value,
  onChange,
  onBlur,
  maxLength,
  error,
  hint,
  type = "text",
  placeholder,
  prominent,
  savedIndicator,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  maxLength?: number;
  error?: string;
  hint?: React.ReactNode;
  type?: "text" | "email";
  placeholder?: string;
  prominent?: boolean;
  savedIndicator?: boolean;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="label flex items-center gap-1">
        {label}
        {required && <span aria-hidden style={{ color: "var(--brand-orange)" }}>*</span>}
        {savedIndicator && (
          <Check size={11} className="ml-1 text-emerald-400" aria-label="Saved" />
        )}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        className="input"
        style={
          prominent
            ? {
                fontSize: 15,
                height: 42,
                fontWeight: 500,
              }
            : undefined
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
      />
      <div className="mt-1 text-[11.5px] leading-tight">
        {error ? <span style={{ color: "#F08B7E" }}>{error}</span> : hint}
      </div>
    </label>
  );
}

function label(f: Field): string {
  return f === "fromName" ? "from name" : f === "replyTo" ? "reply-to" : f;
}
