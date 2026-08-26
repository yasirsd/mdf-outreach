"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import type { BuyerCandidateRecord, BuyerFinderSearchQuery } from "@/lib/buyerFinder/types";
import {
  listMockCandidates,
  searchMockCandidates,
  uniqueMockCountries,
  uniqueMockIndustries,
} from "@/lib/buyerFinder/mock/candidates";
import { SearchView } from "./SearchView";
import { QueueView } from "./QueueView";

type Tab = "search" | "queue";

const EMPTY_QUERY: BuyerFinderSearchQuery = {
  country: "",
  productKey: "",
  buyerType: "",
  industry: "",
  contactPriorities: [],
};

export function BuyerFinderView() {
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState<BuyerFinderSearchQuery>(EMPTY_QUERY);
  const [results, setResults] = useState<BuyerCandidateRecord[]>(() => listMockCandidates());
  const [hasSearched, setHasSearched] = useState(false);

  const countries = useMemo(() => uniqueMockCountries(), []);
  const industries = useMemo(() => uniqueMockIndustries(), []);

  function runSearch() {
    setResults(searchMockCandidates(query));
    setHasSearched(true);
    setTab("queue");
  }

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Buyer Finder"
        subtitle="Search mock companies, review a staging queue, and inspect candidates. Nothing is saved and nothing becomes a Buyer yet."
      />

      <div className="mb-6" style={{ borderBottom: "1px solid var(--app-border)" }}>
        <nav className="flex gap-0.5 -mb-px" aria-label="Buyer Finder sections">
          {(
            [
              ["search", "Search"],
              ["queue", "Review queue"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-3 py-2.5 text-[12.5px] font-medium transition-colors relative focus-ring-quiet",
                  active ? "text-text-primary" : "text-text-muted hover:text-text-secondary",
                )}
              >
                {label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full"
                    style={{ backgroundColor: "var(--brand-orange)" }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "search" && (
        <SearchView
          query={query}
          onChange={setQuery}
          onSearch={runSearch}
          countries={countries}
          industries={industries}
        />
      )}

      {tab === "queue" && (
        <div>
          <div className="mb-4 text-[12.5px] text-text-muted">
            {hasSearched
              ? `${results.length} mock candidate${results.length === 1 ? "" : "s"} match this search.`
              : `${results.length} mock candidates in the review queue.`}
          </div>
          <QueueView records={results} />
        </div>
      )}
    </PageContainer>
  );
}
