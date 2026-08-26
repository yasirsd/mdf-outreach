"use client";

import { Search } from "lucide-react";
import { PRODUCT_CATALOGUE } from "@/lib/email/themes/catalogue";
import type { ProductKey } from "@/lib/email/themes/types";
import {
  BUYER_TYPE_OPTIONS,
  CONTACT_PRIORITY_OPTIONS,
  type BuyerFinderSearchQuery,
  type BuyerTypeOption,
  type ContactPriorityId,
} from "@/lib/buyerFinder/types";

export function SearchView({
  query,
  onChange,
  onSearch,
  countries,
  industries,
}: {
  query: BuyerFinderSearchQuery;
  onChange: (next: BuyerFinderSearchQuery) => void;
  onSearch: () => void;
  countries: string[];
  industries: string[];
}) {
  function togglePriority(id: ContactPriorityId) {
    const selected = query.contactPriorities.includes(id)
      ? query.contactPriorities.filter((p) => p !== id)
      : [...query.contactPriorities, id];
    onChange({ ...query, contactPriorities: selected });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
      className="rounded-[12px] p-6 space-y-5"
      style={{
        backgroundColor: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="label">Country</span>
          <select
            className="input"
            value={query.country}
            onChange={(e) => onChange({ ...query, country: e.target.value })}
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Product</span>
          <select
            className="input"
            value={query.productKey}
            onChange={(e) =>
              onChange({ ...query, productKey: e.target.value as ProductKey | "" })
            }
          >
            <option value="">All products</option>
            {PRODUCT_CATALOGUE.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Buyer type</span>
          <select
            className="input"
            value={query.buyerType}
            onChange={(e) =>
              onChange({ ...query, buyerType: e.target.value as BuyerTypeOption | "" })
            }
          >
            <option value="">All buyer types</option>
            {BUYER_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Industry</span>
          <select
            className="input"
            value={query.industry}
            onChange={(e) => onChange({ ...query, industry: e.target.value })}
          >
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div className="label">Contact priorities</div>
        <div className="flex flex-wrap gap-2">
          {CONTACT_PRIORITY_OPTIONS.map((opt) => {
            const active = query.contactPriorities.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => togglePriority(opt.id)}
                aria-pressed={active}
                className="chip"
                style={
                  active
                    ? {
                        backgroundColor: "rgba(243,107,33,0.12)",
                        color: "var(--brand-orange)",
                        borderColor: "rgba(243,107,33,0.28)",
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
          Optional. Filters mock candidates to those with a matching job title.
        </p>
      </div>

      <div className="flex items-center justify-end pt-1">
        <button type="submit" className="btn-primary">
          <Search size={13} /> Find buyers
        </button>
      </div>
    </form>
  );
}
