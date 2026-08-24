"use client";

import { useState } from "react";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { isValidEmail, uid } from "@/lib/utils";

interface Props {
  initial?: Buyer;
  onSubmit: (b: Buyer) => Promise<void> | void;
  onCancel: () => void;
}

export function BuyerForm({ initial, onSubmit, onCancel }: Props) {
  const [b, setB] = useState<Buyer>(
    initial ?? {
      id: uid("buy"),
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      country: "",
      status: "new",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
    await onSubmit({ ...b, email: b.email.trim().toLowerCase(), updatedAt: new Date().toISOString() });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} className="p-6 space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name" error={errors.firstName}>
          <input className="input" value={b.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </Field>
        <Field label="Last name">
          <input className="input" value={b.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </Field>
      </div>
      <Field label="Company">
        <input className="input" value={b.company} onChange={(e) => set("company", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Email" error={errors.email}>
          <input
            className="input"
            type="email"
            value={b.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label="Country" error={errors.country}>
          <input className="input" value={b.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="City">
          <input className="input" value={b.city ?? ""} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={b.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="WhatsApp">
          <input className="input" value={b.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} />
        </Field>
        <Field label="Website">
          <input className="input" value={b.website ?? ""} onChange={(e) => set("website", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
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
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Source">
          <input className="input" value={b.source ?? ""} onChange={(e) => set("source", e.target.value)} />
        </Field>
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
      </div>
      <Field label="Notes">
        <textarea
          className="textarea"
          rows={3}
          value={b.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-4">
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
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <div className="mt-1 text-[11.5px] text-brand-chilli">{error}</div>}
    </div>
  );
}
