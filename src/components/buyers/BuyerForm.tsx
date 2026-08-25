"use client";

import { useEffect, useState } from "react";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { isValidEmail, uid } from "@/lib/utils";

function blankBuyer(): Buyer {
  const now = new Date().toISOString();
  return {
    id: uid("buy"),
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    country: "",
    status: "new",
    createdAt: now,
    updatedAt: now,
  };
}

interface Props {
  initial?: Buyer;
  onSubmit: (b: Buyer) => Promise<void> | void;
  onCancel: () => void;
}

export function BuyerForm({ initial, onSubmit, onCancel }: Props) {
  const [b, setB] = useState<Buyer>(initial ?? blankBuyer());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Re-initialize when the parent hands us a different buyer while the form
  // is already mounted (guards against React's useState-captures-initial-once
  // behavior, which was the root cause of the edit pre-population regression).
  useEffect(() => {
    if (initial) {
      setB(initial);
      setErrors({});
    }
  }, [initial?.id]);

  function set<K extends keyof Buyer>(k: K, v: Buyer[K]) {
    setB((prev) => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!b.email.trim()) errs.email = "Email required";
    else if (!isValidEmail(b.email)) errs.email = "Invalid email";
    if (!b.firstName && !b.lastName && !b.company) errs.firstName = "Add a name or company";
    if (!b.country.trim()) errs.country = "Country required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    await onSubmit({
      ...b,
      email: b.email.trim().toLowerCase(),
      updatedAt: new Date().toISOString(),
    });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="divide-y" style={{ borderColor: "var(--app-border)" }}>
      <Section title="Identity">
        <TwoCol>
          <Field label="First name" error={errors.firstName}>
            <input
              className="input"
              value={b.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Last name">
            <input
              className="input"
              value={b.lastName}
              onChange={(e) => set("lastName", e.target.value)}
            />
          </Field>
        </TwoCol>
        <Field label="Company">
          <input
            className="input"
            value={b.company}
            onChange={(e) => set("company", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Contact">
        <TwoCol>
          <Field label="Email" error={errors.email}>
            <input
              className="input"
              type="email"
              value={b.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={b.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
        </TwoCol>
        <TwoCol>
          <Field label="WhatsApp">
            <input
              className="input"
              value={b.whatsapp ?? ""}
              onChange={(e) => set("whatsapp", e.target.value)}
            />
          </Field>
          <Field label="Website">
            <input
              className="input"
              value={b.website ?? ""}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://"
            />
          </Field>
        </TwoCol>
      </Section>

      <Section title="Trade profile">
        <TwoCol>
          <Field label="Country" error={errors.country}>
            <input
              className="input"
              value={b.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </Field>
          <Field label="City">
            <input
              className="input"
              value={b.city ?? ""}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
        </TwoCol>
        <TwoCol>
          <Field label="Buyer type">
            <input
              className="input"
              placeholder="Importer, Distributor…"
              value={b.buyerType ?? ""}
              onChange={(e) => set("buyerType", e.target.value)}
            />
          </Field>
          <Field label="Product interest">
            <input
              className="input"
              placeholder="Dry Red Chilli"
              value={b.productInterest ?? ""}
              onChange={(e) => set("productInterest", e.target.value)}
            />
          </Field>
        </TwoCol>
        <Field label="Source">
          <input
            className="input"
            placeholder="Trade fair, referral, LinkedIn…"
            value={b.source ?? ""}
            onChange={(e) => set("source", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Relationship">
        <TwoCol>
          <Field label="Status">
            <select
              className="input"
              value={b.status}
              onChange={(e) => set("status", e.target.value as BuyerStatus)}
            >
              {BUYER_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {BUYER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Next follow-up">
            <input
              className="input"
              type="date"
              value={toDateInput(b.nextFollowUpAt)}
              onChange={(e) => set("nextFollowUpAt", fromDateInput(e.target.value))}
            />
          </Field>
        </TwoCol>
        <Field label="Notes">
          <textarea
            className="textarea"
            rows={3}
            value={b.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </Section>

      <div
        className="px-6 py-4 flex items-center justify-end gap-2"
        style={{ backgroundColor: "var(--app-sidebar)" }}
      >
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save buyer"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-6 py-5">
      <div className="text-[10.5px] tracking-[0.14em] uppercase text-text-muted font-medium mb-3">
        {title}
      </div>
      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error && <div className="mt-1 text-[11px]" style={{ color: "#F08B7E" }}>{error}</div>}
    </label>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3.5">{children}</div>;
}

function toDateInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T09:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
