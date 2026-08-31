"use client";

import { Search } from "lucide-react";
import { activeBusinessProducts } from "@/lib/buyerFinder/businessCatalogue";
import { COUNTRIES } from "@/lib/catalogue/countries";
import {
  BUYER_TYPE_OPTIONS,
  CONTACT_PRIORITY_OPTIONS,
  type BuyerTypeOption,
  type ContactPriorityId,
} from "@/lib/buyerFinder/types";
import { HUNTER_DISCOVER_FREE_FOOTER } from "@/lib/buyerFinder/hunterAvailability";

export interface SearchFormValue {
  country: string;
  productId: string;
  buyerType: BuyerTypeOption | "";
  contactPriorities: ContactPriorityId[];
}

/**
 * Search UI for Buyer Finder.
 *
 * Business product catalogue is the authority — options come from
 * `activeBusinessProducts()`. Country options come from the F5 canonical
 * `COUNTRIES` catalogue.
 *
 * BF2 removes the free-text industry filter because Hunter's arbitrary
 * industry input is fragile (documented in query.ts) and no other
 * downstream consumer uses it.
 */
export function SearchView({
  value,
  onChange,
  onSearch,
  pending,
  disabledReason,
}: {
  value: SearchFormValue;
  onChange: (next: SearchFormValue) => void;
  onSearch: () => void;
  pending: boolean;
  disabledReason: string | null;
}) {
  const products = activeBusinessProducts();

  function togglePriority(id: ContactPriorityId) {
    const selected = value.contactPriorities.includes(id)
      ? value.contactPriorities.filter((p) => p !== id)
      : [...value.contactPriorities, id];
    onChange({ ...value, contactPriorities: selected });
  }

  const canSubmit = !pending && !disabledReason && !!value.country && !!value.productId;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSearch();
      }}
      className="rounded-[12px] p-5 lg:p-7 space-y-6"
      style={{ backgroundColor: "var(--app-surface)" }}
    >
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">New search</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Discover companies by market and product. Search does not reveal personal contacts.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        <label className="block">
          <span className="label">Country</span>
          <select
            className="input"
            value={value.country}
            onChange={(e) => onChange({ ...value, country: e.target.value })}
            disabled={pending}
            required
          >
            <option value="">Select a country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Product</span>
          <select
            className="input"
            value={value.productId}
            onChange={(e) => onChange({ ...value, productId: e.target.value })}
            disabled={pending}
            required
          >
            <option value="">Select a product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Buyer type</span>
          <select
            className="input"
            value={value.buyerType}
            onChange={(e) =>
              onChange({ ...value, buyerType: e.target.value as BuyerTypeOption | "" })
            }
            disabled={pending}
          >
            <option value="">Any</option>
            {BUYER_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-text-muted">
            Search intent only. Not treated as a company fact.
          </p>
        </label>
      </div>

      <div>
        <div className="label">Contact priorities</div>
        <div className="flex flex-wrap gap-2">
          {CONTACT_PRIORITY_OPTIONS.map((opt) => {
            const active = value.contactPriorities.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => togglePriority(opt.id)}
                aria-pressed={active}
                className="chip"
                disabled={pending}
                style={
                  active
                    ? {
                        backgroundColor: "var(--app-surface-2, #1f1f1f)",
                        color: "var(--text-primary)",
                        borderColor: "var(--app-border-strong)",
                      }
                    : undefined
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-text-muted">
          Optional. Saved with this search for later contact enrichment.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
        <div className="text-[11.5px] text-text-muted">
          {disabledReason ?? HUNTER_DISCOVER_FREE_FOOTER}
        </div>
        <button
          type="submit"
          className="btn-primary min-h-9"
          disabled={!canSubmit}
          aria-busy={pending}
        >
          <Search size={13} /> {pending ? "Starting…" : "Find buyers"}
        </button>
      </div>
    </form>
  );
}
