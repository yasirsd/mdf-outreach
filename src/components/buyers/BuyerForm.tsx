"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS, BUYER_STATUS_ORDER } from "@/lib/types";
import { isValidEmail, uid } from "@/lib/utils";
import { AsyncButton } from "@/components/ui/AsyncButton";
import {
  SearchableCombobox,
  type ComboboxOption,
} from "@/components/ui/SearchableCombobox";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { COUNTRIES, findCountryByName } from "@/lib/catalogue/countries";
import { BUYER_TYPES, findBuyerTypeByLabel } from "@/lib/catalogue/buyerTypes";
import {
  activeProducts,
  findProductByDisplayName,
} from "@/lib/catalogue/products";
import { searchCitiesAction } from "@/lib/catalogue/citySearch";

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

const COUNTRY_OPTIONS: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.name,
  label: c.name,
  keywords: [c.code, ...(c.aliases ?? [])],
}));

const BUYER_TYPE_OPTIONS: ComboboxOption[] = BUYER_TYPES.map((t) => ({
  value: t.label,
  label: t.label,
  description: t.description,
}));

const PRODUCT_OPTIONS: ComboboxOption[] = activeProducts().map((p) => ({
  value: p.displayName,
  label: p.displayName,
  description: p.emailThemeKey ? undefined : "No email master yet",
  keywords: [p.shortName],
}));

const STATUS_OPTIONS: ComboboxOption[] = BUYER_STATUS_ORDER.map((s) => ({
  value: s,
  label: BUYER_STATUS_LABELS[s],
}));

export function BuyerForm({ initial, onSubmit, onCancel }: Props) {
  const [b, setB] = useState<Buyer>(initial ?? blankBuyer());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // "Other" specifier — kept in local state (not persisted separately);
  // the actual buyer.buyerType stores the string the operator typed.
  const [buyerTypeIsOther, setBuyerTypeIsOther] = useState(false);
  const [otherBuyerTypeText, setOtherBuyerTypeText] = useState("");

  // Country → City lookup wiring.
  const [cityLoading, setCityLoading] = useState(false);
  const [cityOptions, setCityOptions] = useState<ComboboxOption[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const cityRequestSeq = useRef(0);
  // Whether the current city may not match the country — surfaces a
  // subtle helper, never mutates the value.
  const [cityCountryMismatch, setCityCountryMismatch] = useState(false);

  useEffect(() => {
    if (initial) {
      setB(initial);
      setErrors({});
      const bt = findBuyerTypeByLabel(initial.buyerType);
      if (bt?.isOther || (!bt && initial.buyerType)) {
        setBuyerTypeIsOther(!!bt?.isOther);
        setOtherBuyerTypeText(bt?.isOther ? "" : initial.buyerType ?? "");
      } else {
        setBuyerTypeIsOther(false);
        setOtherBuyerTypeText("");
      }
      setCityCountryMismatch(false);
    }
  }, [initial?.id]);

  // Debounced country-scoped city search. Ignore stale responses so
  // the last-typed query wins even under network jitter.
  useEffect(() => {
    if (!b.country) {
      setCityOptions([]);
      return;
    }
    const q = cityQuery.trim();
    if (!q) {
      setCityOptions([]);
      return;
    }
    const seq = ++cityRequestSeq.current;
    setCityLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchCitiesAction({ country: b.country, query: q });
        if (cityRequestSeq.current !== seq) return; // stale
        setCityOptions(
          results.map((r) => ({
            value: r.name,
            label: r.name,
            description: r.admin,
          })),
        );
      } catch {
        if (cityRequestSeq.current === seq) setCityOptions([]);
      } finally {
        if (cityRequestSeq.current === seq) setCityLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [cityQuery, b.country]);

  function set<K extends keyof Buyer>(k: K, v: Buyer[K]) {
    setB((prev) => ({ ...prev, [k]: v }));
  }

  function changeCountry(next: string) {
    setB((prev) => ({ ...prev, country: next }));
    // If a city is set and the operator changes country, surface a
    // subtle helper but do NOT erase the city.
    if (b.city && b.city.trim().length > 0) setCityCountryMismatch(true);
  }

  function changeBuyerType(nextValue: string) {
    const entry = findBuyerTypeByLabel(nextValue);
    if (entry?.isOther) {
      setBuyerTypeIsOther(true);
      // Persist the "Other" label until the operator specifies.
      set("buyerType", otherBuyerTypeText || "Other");
    } else {
      setBuyerTypeIsOther(false);
      setOtherBuyerTypeText("");
      set("buyerType", nextValue);
    }
  }

  function changeOtherBuyerType(next: string) {
    setOtherBuyerTypeText(next);
    set("buyerType", next.trim() ? next : "Other");
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
    try {
      await onSubmit({
        ...b,
        email: b.email.trim().toLowerCase(),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  // Legacy value awareness for the labeled controls.
  const countryIsLegacy = !!b.country && !findCountryByName(b.country);
  const productLabel = b.productInterest ?? "";
  const productIsLegacy =
    !!productLabel && !findProductByDisplayName(productLabel);

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
          <Field
            label="Country"
            error={errors.country}
            hint={countryIsLegacy ? "Legacy value preserved. Choose a canonical country if this is stale." : undefined}
          >
            <SearchableCombobox
              value={b.country || null}
              onChange={changeCountry}
              options={COUNTRY_OPTIONS}
              placeholder="Search country…"
              emptyLabel="Select country…"
              allowCustom={false}
              onClear={() => set("country", "")}
            />
          </Field>
          <Field
            label="City"
            hint={
              cityCountryMismatch
                ? "City may not match the selected country. Choose another city if needed."
                : undefined
            }
          >
            <SearchableCombobox
              value={b.city || null}
              onChange={(next) => {
                set("city", next);
                setCityCountryMismatch(false);
              }}
              options={cityOptions}
              placeholder={
                b.country ? `Search cities in ${b.country}…` : "Choose a country first"
              }
              emptyLabel="Type a city…"
              emptyMessage="No matching city — type to add."
              allowCustom
              loading={cityLoading}
              onQueryChange={setCityQuery}
              disabled={!b.country}
              onClear={() => set("city", "")}
            />
          </Field>
        </TwoCol>
        <TwoCol>
          <Field label="Buyer type">
            <Select
              value={
                buyerTypeIsOther
                  ? "Other"
                  : findBuyerTypeByLabel(b.buyerType)?.label ??
                    (b.buyerType || null)
              }
              onChange={changeBuyerType}
              options={BUYER_TYPE_OPTIONS}
              emptyLabel="Select buyer type…"
            />
            {buyerTypeIsOther && (
              <input
                className="input mt-2"
                value={otherBuyerTypeText}
                onChange={(e) => changeOtherBuyerType(e.target.value)}
                placeholder="Specify buyer type"
              />
            )}
          </Field>
          <Field
            label="Product interest"
            hint={
              productIsLegacy
                ? "Legacy value preserved. Choose an MDF product to replace it."
                : "Only MDF products can be selected. New products must be added to the catalogue first."
            }
          >
            <SearchableCombobox
              value={b.productInterest || null}
              onChange={(next) => set("productInterest", next)}
              options={PRODUCT_OPTIONS}
              placeholder="Search products…"
              emptyLabel="Select product…"
              // F5 follow-up: no more arbitrary custom products at edit time.
              // Legacy values remain visible (via the Combobox's legacy chip)
              // and are preserved on unrelated saves; the operator can only
              // REPLACE with a canonical MDF product.
              allowCustom={false}
              onClear={() => set("productInterest", undefined)}
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
            <Select
              value={b.status}
              onChange={(next) => set("status", next as BuyerStatus)}
              options={STATUS_OPTIONS}
            />
          </Field>
          <Field label="Next follow-up">
            <DatePicker
              value={b.nextFollowUpAt}
              onChange={(iso) => set("nextFollowUpAt", iso ?? undefined)}
              placeholder="Pick a follow-up date"
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
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <AsyncButton type="submit" pending={saving} pendingLabel="Saving…">
          Save buyer
        </AsyncButton>
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
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {error ? (
        <div className="mt-1 text-[11px]" style={{ color: "#F08B7E" }}>
          {error}
        </div>
      ) : hint ? (
        <div className="mt-1 text-[11.5px] text-text-muted">{hint}</div>
      ) : null}
    </label>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">{children}</div>;
}
