"use client";

import { QueueView, type QueueRowInput } from "@/app/(app)/buyer-finder/QueueView";
import { FreeEnrichmentSummaryPanel } from "@/components/buyerFinder/FreeEnrichmentSummaryPanel";
import { SearchView } from "@/app/(app)/buyer-finder/SearchView";
import { CandidateView } from "@/app/(app)/buyer-finder/candidate/[id]/CandidateView";
import type { BuyerCandidateRecord } from "@/lib/buyerFinder/types";

const base = {
  source: "hunter" as const,
  discoveryStatus: "ready" as const,
  reviewStatus: "pending" as const,
};

const rows: QueueRowInput[] = [
  {
    candidate: {
      id: "00000000-0000-4000-8000-0000000000aa",
      companyName: "KSONS Global",
      country: "United Arab Emirates",
      companyScore: 38,
      ...base,
    },
    productMatches: [
      {
        id: "00000000-0000-4000-8000-0000000000p1",
        candidateId: "00000000-0000-4000-8000-0000000000aa",
        productId: "guntur-dry-red-chilli",
        relevance: 50,
        source: "hunter",
        evidence: [],
      },
    ],
    contactCount: 2,
    bestContactName: "Chandan G.",
    bestContactTitle: "Director of Agricultural Commodities",
    bestHasLinkedin: true,
    revealPriority: "high",
    publicCompanyEmail: "info@ksonsglobal.com",
    publicJobStatus: "succeeded",
    peopleJobStatus: "succeeded",
  },
  {
    candidate: {
      id: "00000000-0000-4000-8000-0000000000bb",
      companyName: "Natureland",
      country: "Kuwait",
      companyScore: 40,
      ...base,
    },
    productMatches: [
      {
        id: "00000000-0000-4000-8000-0000000000p2",
        candidateId: "00000000-0000-4000-8000-0000000000bb",
        productId: "guntur-dry-red-chilli",
        relevance: 50,
        source: "hunter",
        evidence: [],
      },
    ],
    contactCount: 6,
    bestContactName: "Ahmed E.",
    bestContactTitle: "Category Manager",
    bestHasLinkedin: true,
    revealPriority: "high",
    peopleJobStatus: "succeeded",
  },
  {
    candidate: {
      id: "00000000-0000-4000-8000-0000000000cc",
      companyName: "Dry Fruit Hub",
      country: "Kuwait",
      companyScore: 22,
      ...base,
    },
    productMatches: [],
    contactCount: 7,
    bestContactTitle: "Director",
    revealPriority: "medium",
    publicJobStatus: "failed",
    peopleJobStatus: "succeeded",
  },
  {
    candidate: {
      id: "00000000-0000-4000-8000-0000000000dd",
      companyName: "Carya Roastery",
      country: "Kuwait",
      companyScore: 23,
      ...base,
      reviewStatus: "approved",
    },
    productMatches: [
      {
        id: "00000000-0000-4000-8000-0000000000p3",
        candidateId: "00000000-0000-4000-8000-0000000000dd",
        productId: "guntur-dry-red-chilli",
        relevance: 50,
        source: "hunter",
        evidence: [],
      },
    ],
    contactCount: 0,
    publicCompanyEmail: "hello@carya.example",
    peopleJobStatus: "no_result",
  },
];

const ksons: BuyerCandidateRecord = {
  candidate: {
    id: "00000000-0000-4000-8000-0000000000aa",
    companyName: "KSONS Global",
    website: "https://ksonsglobal.com",
    domain: "ksonsglobal.com",
    country: "United Arab Emirates",
    source: "hunter",
    companyScore: 38,
    discoveryStatus: "ready",
    reviewStatus: "pending",
    generalEmail: "info@ksonsglobal.com",
    publicContactsSearchedAt: "2026-08-29T00:00:00.000Z",
    peopleSearchedAt: "2026-08-29T00:00:00.000Z",
  },
  contacts: [
    {
      id: "00000000-0000-4000-8000-0000000000c8",
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      firstName: "",
      lastName: "",
      fullName: "Chandan G.",
      jobTitle: "Director of Agricultural Commodities",
      businessEmail: "",
      isPrimary: false,
      contactScore: 11,
      isDecisionMaker: true,
      linkedinAvailable: true,
      department: "management",
      seniority: "executive",
      source: "hunter",
      emailType: "personal",
    },
    {
      id: "00000000-0000-4000-8000-0000000000c9",
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      firstName: "",
      lastName: "",
      fullName: "Bharti S.",
      jobTitle: "Accountant",
      businessEmail: "",
      isPrimary: true,
      contactScore: 4,
      source: "hunter",
    },
  ],
  productMatches: [
    {
      id: "00000000-0000-4000-8000-0000000000p1",
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      productId: "guntur-dry-red-chilli",
      relevance: 50,
      source: "hunter",
      evidence: [
        {
          note: "Hunter Discover company match. Directory match only — not proof of import or distribution.",
          confidence: 40,
        },
      ],
    },
  ],
  publicEmails: [
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      candidateId: "00000000-0000-4000-8000-0000000000aa",
      email: "info@ksonsglobal.com",
      mailboxType: "general",
      mailboxKind: "corporate",
      source: "company_website",
      sourceUrl: "https://ksonsglobal.com/contact",
      isPrimary: true,
    },
  ],
};

export default function Bf4rVisualPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const initial = (["all", "priority", "attention", "detail", "search"] as const).includes(
    searchParams?.view as "all",
  )
    ? (searchParams?.view as "all" | "priority" | "attention" | "detail" | "search")
    : "all";
  const view = initial;
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--app-bg)" }}>
      <div className="mx-auto max-w-[1480px] px-6 md:px-10 py-6 md:py-7">
        {view !== "detail" && (
          <>
            <div className="flex items-start justify-between gap-6 mb-5">
              <div className="min-w-0">
                <h1 className="text-[22px] font-semibold leading-[1.15] tracking-tight text-text-primary">
                  Buyer Finder
                </h1>
                <p className="mt-2 text-text-secondary text-[13.5px] leading-relaxed">
                  Find, research, and prioritize potential buyers.
                </p>
              </div>
              <div className="text-[12px] text-right shrink-0">
                <div className="text-[11px] text-text-muted mb-1">Research services</div>
                <div
                  className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[10px] px-2.5 py-1.5 text-text-secondary"
                  style={{ border: "1px solid var(--app-border)" }}
                >
                  <span>
                    <span className="font-medium">Website</span>{" "}
                    <span className="text-text-muted">Contacts · Free</span>
                  </span>
                  <span aria-hidden className="text-text-muted/35">
                    |
                  </span>
                  <span>
                    <span className="font-medium">Hunter</span>{" "}
                    <span className="text-text-muted">People · Free</span>
                  </span>
                  <span aria-hidden className="text-text-muted/35">
                    |
                  </span>
                  <span className="text-text-muted">Personal reveal · Locked</span>
                </div>
              </div>
            </div>
            <div className="mb-6" style={{ borderBottom: "1px solid var(--app-border)" }}>
              <nav className="flex gap-0.5 -mb-px" aria-label="Buyer Finder sections">
                {(
                  [
                    ["search", "Search"],
                    ["queue", "Review queue"],
                  ] as const
                ).map(([key, label]) => {
                  const active = key === "search" ? view === "search" : view !== "search";
                  return (
                    <span
                      key={key}
                      className="relative px-3 py-2.5 text-[12.5px] font-medium"
                      style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}
                    >
                      {label}
                      {active && (
                        <span
                          aria-hidden
                          className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full"
                          style={{ backgroundColor: "var(--brand-orange)" }}
                        />
                      )}
                    </span>
                  );
                })}
              </nav>
            </div>
          </>
        )}
        {view === "search" && (
          <SearchView
            value={{
              country: "United Arab Emirates",
              productId: "guntur-dry-red-chilli",
              buyerType: "",
              contactPriorities: [],
            }}
            onChange={() => {}}
            onSearch={() => {}}
            pending={false}
            disabledReason={null}
          />
        )}
        {view !== "search" && view !== "detail" && (
          <>
            <div className="mb-2 text-[11.5px] text-text-muted/80 flex flex-wrap gap-x-3">
              <span>45 total</span>
              <span>· 44 pending</span>
              <span>· 1 approved</span>
              <span>· 0 rejected</span>
              <span>· 0 archived</span>
            </div>
            <FreeEnrichmentSummaryPanel
              summary={{
                companies: 45,
                ready: 33,
                researching: 0,
                needsAttention: 12,
                checksRemaining: 0,
                companiesWithPublicEmail: 20,
                peopleFound: 51,
                highRevealPriority: 2,
                complete: 33,
                inProgress: 0,
                retrying: 0,
                queued: 0,
                publicEmailsFound: 27,
                decisionMakersFound: 51,
              }}
            />
            <QueueView rows={rows} filter={view} onFilterChange={() => {}} />
          </>
        )}
      </div>
      {view === "detail" && (
        <CandidateView
          record={ksons}
          publicWebsite="ready"
          hunterReveal="disabled"
          publicJobStatus="succeeded"
          peopleJobStatus="succeeded"
        />
      )}
    </div>
  );
}
