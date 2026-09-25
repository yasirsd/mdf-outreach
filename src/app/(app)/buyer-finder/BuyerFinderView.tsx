"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { toast } from "@/components/ui/Toast";
import { SearchView, type SearchFormValue } from "./SearchView";
import { QueueView, type QueueRowInput } from "./QueueView";
import { ProviderUsageIndicator } from "@/components/buyerFinder/ProviderUsageIndicator";
import { PublicWebsiteCapabilityChip } from "@/components/buyerFinder/PublicWebsiteCapabilityChip";
import { SearchRunProgressSurface } from "@/components/buyerFinder/SearchRunProgress";
import { ResearchServicesCluster, ResearchServicesSep } from "@/components/buyerFinder/workspaceChrome";
import {
  getHunterUsageAction,
  type HunterUsageResult,
  type QueueRow,
  type QueueSummary,
} from "./actions";
import {
  createBuyerFinderSearchRunAction,
  finalizeStaleBuyerFinderSearchRunAction,
  getBuyerFinderSearchRunAction,
} from "./searchRunActions";
import {
  isRunStale,
  isTerminal,
  type SafeSearchRunSnapshot,
} from "@/lib/buyerFinder/searchRun";
import { ALREADY_RUNNING_MESSAGE } from "@/lib/buyerFinder/searchRunCopy";
import {
  HUNTER_NOT_CONFIGURED_FOOTER,
  type HunterDiscoveryAvailability,
} from "@/lib/buyerFinder/hunterAvailability";
import type { HunterRevealAvailability } from "@/lib/buyerFinder/hunterRevealAvailability";
import type { PublicWebsiteAvailability } from "@/lib/buyerFinder/publicWebsiteAvailability";
import { useSearchRunPolling } from "@/lib/buyerFinder/useSearchRunPolling";
import { FreeEnrichmentSummaryPanel } from "@/components/buyerFinder/FreeEnrichmentSummaryPanel";
import type { FreeEnrichmentSummary } from "@/lib/buyerFinder/freeEnrichmentSummary";
import { codeForCountryName } from "@/lib/catalogue/countries";
import type { MarketIntelligenceHandoffContext } from "@/lib/marketIntelligence/read/overview";
import {
  buildBuyerFinderHandoffHref,
  buildMarketIntelligenceReturnHref,
  resolveMarketIntelligenceBuyerFinderHandoff,
  type MarketIntelligenceBuyerFinderHandoff,
} from "@/lib/marketIntelligence/buyerFinderHandoff";
import { formatScoreOutOf100 } from "@/lib/marketIntelligence/format";
import { TradeResearchBatchPanel } from "@/components/buyerFinder/TradeResearchPanel";
import type { TradeResearchBatchSnapshot } from "@/lib/tradeResearch/types";

type Tab = "search" | "queue";

const EMPTY_QUERY: SearchFormValue = {
  country: "",
  productId: "",
  buyerType: "",
  contactPriorities: [],
};

export function BuyerFinderView({
  initialQueue,
  initialSummary,
  queueLimit,
  hunterDiscovery,
  hunterReveal = "disabled",
  publicWebsite = "ready",
  initialActiveRun,
  enrichmentSummary,
  initialQuery,
  marketHandoff,
  marketContext,
  isOwner = false,
  initialResearchBatch,
}: {
  initialQueue: QueueRow[];
  initialSummary: QueueSummary;
  queueLimit: number;
  hunterDiscovery: HunterDiscoveryAvailability;
  hunterReveal?: HunterRevealAvailability;
  publicWebsite?: PublicWebsiteAvailability;
  initialActiveRun: SafeSearchRunSnapshot | null;
  enrichmentSummary?: FreeEnrichmentSummary;
  initialQuery?: Pick<SearchFormValue, "country" | "productId">;
  marketHandoff?: MarketIntelligenceBuyerFinderHandoff | null;
  marketContext?: MarketIntelligenceHandoffContext;
  isOwner?: boolean;
  initialResearchBatch?: TradeResearchBatchSnapshot;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState<SearchFormValue>(() => ({
    ...EMPTY_QUERY,
    ...initialQuery,
  }));
  const [pending, startTransition] = useTransition();
  const [contextPending, startContextTransition] = useTransition();
  const [usage, setUsage] = useState<HunterUsageResult | null>(null);
  const [activeRun, setActiveRun] = useState<SafeSearchRunSnapshot | null>(initialActiveRun);
  const refreshedIds = useRef(new Set<string>());
  const finalizedIds = useRef(new Set<string>());
  const executeStartedIds = useRef(new Set<string>());
  const isMarketHandoff = Boolean(marketHandoff);

  const healthyActive =
    !!activeRun && !isTerminal(activeRun.status) && !isRunStale(activeRun);

  const disabledReason =
    hunterDiscovery === "not_configured"
      ? HUNTER_NOT_CONFIGURED_FOOTER
      : healthyActive
        ? ALREADY_RUNNING_MESSAGE
        : null;

  useEffect(() => {
    let cancelled = false;
    if (isMarketHandoff) {
      setUsage(null);
      return;
    }
    if (hunterDiscovery !== "ready") {
      setUsage({ outcome: "not_configured", usage: null });
      return;
    }
    getHunterUsageAction()
      .then((r) => {
        if (!cancelled) setUsage(r);
      })
      .catch(() => {
        if (!cancelled) setUsage({ outcome: "unavailable", usage: null });
      });
    return () => {
      cancelled = true;
    };
  }, [hunterDiscovery, isMarketHandoff]);

  const applySnapshot = useCallback(
    (snap: SafeSearchRunSnapshot) => {
      setActiveRun(snap);
      if (isTerminal(snap.status) && !refreshedIds.current.has(snap.id)) {
        refreshedIds.current.add(snap.id);
        router.refresh();
      }
    },
    [router],
  );

  const fetchRun = useCallback(async (runId: string) => {
    const result = await getBuyerFinderSearchRunAction(runId);
    return result.outcome === "ok" ? result.run : null;
  }, []);

  useSearchRunPolling({
    runId: activeRun?.id ?? null,
    enabled: !!activeRun && !isTerminal(activeRun.status) && !isRunStale(activeRun),
    fetchRun,
    onSnapshot: applySnapshot,
    isStale: (run) => isRunStale(run),
  });

  useEffect(() => {
    if (isMarketHandoff) return;
    if (!activeRun) return;
    if (!isRunStale(activeRun)) return;
    if (finalizedIds.current.has(activeRun.id)) return;
    finalizedIds.current.add(activeRun.id);
    void finalizeStaleBuyerFinderSearchRunAction(activeRun.id).then((r) => {
      if (r.run) setActiveRun(r.run);
    });
  }, [activeRun, isMarketHandoff]);

  useEffect(() => {
    if (!initialQuery) return;
    setQuery((current) => ({
      ...current,
      country: initialQuery.country,
      productId: initialQuery.productId,
    }));
  }, [initialQuery?.country, initialQuery?.productId]);

  function startExecute(runId: string) {
    if (executeStartedIds.current.has(runId)) return;
    executeStartedIds.current.add(runId);
    void fetch(`/api/buyer-finder/search-runs/${runId}/execute`, { method: "POST" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { run?: SafeSearchRunSnapshot | null }
          | null;
        if (body?.run) applySnapshot(body.run);
      })
      .catch(() => {
        // Polling / stale recovery will surface the outcome. Do not
        // restart Hunter from the client.
      });
  }

  function runSearch() {
    startTransition(async () => {
      try {
        const result = await createBuyerFinderSearchRunAction({
          country: query.country,
          productId: query.productId,
          buyerTypes: query.buyerType ? [query.buyerType] : undefined,
          contactPriorities: query.contactPriorities,
        });
        if (
          result.outcome === "invalid_input" ||
          result.outcome === "not_configured" ||
          result.outcome === "disabled"
        ) {
          toast.error(result.message);
          return;
        }
        setActiveRun(result.run);
        if (result.outcome === "created") {
          startExecute(result.run.id);
        }
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  function clearRun() {
    if (activeRun && !isTerminal(activeRun.status) && isRunStale(activeRun)) {
      startTransition(async () => {
        try {
          const result = await finalizeStaleBuyerFinderSearchRunAction(activeRun.id);
          if (result.outcome === "finalized" || result.outcome === "not_found") {
            setActiveRun(null);
          } else if (result.run) {
            setActiveRun(result.run);
          }
        } catch {
          toast.error("Could not reconcile the interrupted search. Please try again.");
        }
      });
      return;
    }
    setActiveRun(null);
  }

  function updateQuery(next: SearchFormValue) {
    const identityChanged = next.country !== query.country || next.productId !== query.productId;
    setQuery(next);
    if (!marketHandoff || !identityChanged) return;
    const countryAlpha2 = codeForCountryName(next.country);
    if (!countryAlpha2 || !next.productId) return;
    const href = buildBuyerFinderHandoffHref({
      productId: next.productId,
      countryAlpha2,
    });
    if (!href) return;
    startContextTransition(() => router.replace(href, { scroll: false }));
  }

  const visibleMarketContext = marketContext &&
    marketContext.product.id === query.productId &&
    marketContext.country.name === query.country
    ? marketContext
    : undefined;
  const selectedCountryAlpha2 = codeForCountryName(query.country);
  const selectionMatchesOriginal = marketHandoff &&
    marketHandoff.productId === query.productId &&
    marketHandoff.countryAlpha2 === selectedCountryAlpha2;
  const currentReturnHandoff = marketHandoff && selectedCountryAlpha2
    ? resolveMarketIntelligenceBuyerFinderHandoff({
        source: "market-intelligence",
        product: query.productId,
        country: selectedCountryAlpha2,
        returnCompare: selectionMatchesOriginal
          ? marketHandoff.returnComparison.join(",")
          : undefined,
      })
    : null;

  return (
    <PageContainer size="wide" className="!py-6 md:!py-7">
      <PageHeader
        title="Buyer Finder"
        subtitle="Find, research, and prioritize potential buyers."
        actions={
          <ResearchServicesCluster>
            <PublicWebsiteCapabilityChip state={publicWebsite} />
            <ResearchServicesSep />
            {usage ? (
              <ProviderUsageIndicator
                usage={usage.outcome === "ok" ? usage.usage : null}
                state={usage.outcome}
                hunterReveal={hunterReveal}
              />
            ) : (
              <span className="text-[11.5px] text-text-muted">Hunter</span>
            )}
          </ResearchServicesCluster>
        }
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
        <div className="space-y-4">
          {currentReturnHandoff && (
            <div className="flex items-center justify-between gap-3 flex-wrap" aria-busy={contextPending || undefined}>
              <Link
                href={buildMarketIntelligenceReturnHref(currentReturnHandoff)}
                className="inline-flex items-center gap-1.5 text-[11.5px] text-text-secondary hover:text-text-primary focus-ring-quiet rounded-[6px]"
              >
                <ArrowLeft size={13} aria-hidden />
                Back to Market Intelligence
              </Link>
              {contextPending && <span className="text-[10.5px] text-text-muted" role="status">Updating market context…</span>}
            </div>
          )}
          {visibleMarketContext && <MarketContextCard context={visibleMarketContext} />}
          <SearchView
            value={query}
            onChange={updateQuery}
            onSearch={runSearch}
            pending={pending}
            disabledReason={disabledReason}
          />
          {activeRun && (
            <SearchRunProgressSurface
              run={activeRun}
              onViewCandidates={() => setTab("queue")}
              onFindMore={clearRun}
              onStartNew={clearRun}
            />
          )}
        </div>
      )}

      {tab === "queue" && (
        <div>
          <QueueHeader summary={initialSummary} limit={queueLimit} />
          <TradeResearchBatchPanel
            candidateIds={initialQueue.map((row) => row.candidate.id)}
            initialBatch={initialResearchBatch}
            isOwner={isOwner}
          />
          {enrichmentSummary && (
            <FreeEnrichmentSummaryPanel
              summary={enrichmentSummary}
              paused={false}
            />
          )}
          <QueueView rows={toQueueInputs(initialQueue)} />
        </div>
      )}
    </PageContainer>
  );
}

function MarketContextCard({ context }: { context: MarketIntelligenceHandoffContext }) {
  const recommendation = context.recommendationStatus
    .replaceAll("_", " ")
    .replace(/^./, (value) => value.toUpperCase());
  return (
    <section
      aria-labelledby="market-context-heading"
      className="rounded-[12px] p-4"
      style={{ backgroundColor: "var(--app-surface)", border: "1px solid var(--app-border)" }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-brand-orange">Market-level evidence</div>
          <h2 id="market-context-heading" className="mt-1 text-[14px] font-semibold text-text-primary">
            {context.country.name} · {context.product.displayName}
          </h2>
        </div>
        <dl className="grid grid-cols-3 gap-x-5 gap-y-2 text-[11.5px]">
          <div><dt className="text-text-muted">Market Fit</dt><dd className="mt-0.5 tabular-nums text-text-primary">{formatScoreOutOf100(context.marketFit)}</dd></div>
          <div><dt className="text-text-muted">Confidence</dt><dd className="mt-0.5 tabular-nums text-text-primary">{formatScoreOutOf100(context.dataConfidence)}</dd></div>
          <div><dt className="text-text-muted">Status</dt><dd className="mt-0.5 text-text-primary">{recommendation}</dd></div>
        </dl>
      </div>
      <div className="mt-3 flex items-start gap-2 text-[10.5px] leading-relaxed text-text-muted">
        <Info size={12} aria-hidden className="mt-0.5 shrink-0" />
        <p>
          {context.isTradeProxy && context.hsRevision && context.hsCode
            ? `Trade proxy · ${context.hsRevision} ${context.hsCode}. `
            : ""}
          This is country-level market evidence. It does not establish that any company discovered below imports this product.
        </p>
      </div>
    </section>
  );
}

function toQueueInputs(rows: QueueRow[]): QueueRowInput[] {
  return rows.map((r) => ({
    candidate: r.candidate,
    productMatches: r.productMatches,
    contactCount: r.contactCount,
    bestContactTitle: r.bestContactTitle,
    bestContactName: r.bestContactName,
    bestHasLinkedin: r.bestHasLinkedin,
    bestIsDecisionMaker: r.bestIsDecisionMaker,
    priorityReason: r.priorityReason,
    publicCompanyEmail: r.publicCompanyEmail,
    revealPriority: r.revealPriority,
    publicJobStatus: r.publicJobStatus,
    peopleJobStatus: r.peopleJobStatus,
    roleRelevance: r.roleRelevance,
    contactQuality: r.contactQuality,
    convertedBuyerId: r.convertedBuyerId,
  }));
}

function QueueHeader({ summary, limit }: { summary: QueueSummary; limit: number }) {
  const capped = summary.total > limit;
  return (
    <div className="mb-2 text-[11.5px] text-text-muted/80 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>
        {summary.total} total{capped ? ` (showing latest ${limit})` : ""}
      </span>
      <span>· {summary.pending} pending</span>
      <span>· {summary.approved} approved</span>
      <span>· {summary.rejected} rejected</span>
      <span>· {summary.archived} archived</span>
    </div>
  );
}
