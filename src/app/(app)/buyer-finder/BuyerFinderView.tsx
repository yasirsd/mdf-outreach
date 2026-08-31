"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
}: {
  initialQueue: QueueRow[];
  initialSummary: QueueSummary;
  queueLimit: number;
  hunterDiscovery: HunterDiscoveryAvailability;
  hunterReveal?: HunterRevealAvailability;
  publicWebsite?: PublicWebsiteAvailability;
  initialActiveRun: SafeSearchRunSnapshot | null;
  enrichmentSummary?: FreeEnrichmentSummary;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState<SearchFormValue>(EMPTY_QUERY);
  const [pending, startTransition] = useTransition();
  const [usage, setUsage] = useState<HunterUsageResult | null>(null);
  const [activeRun, setActiveRun] = useState<SafeSearchRunSnapshot | null>(initialActiveRun);
  const refreshedIds = useRef(new Set<string>());
  const finalizedIds = useRef(new Set<string>());
  const executeStartedIds = useRef(new Set<string>());

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
  }, [hunterDiscovery]);

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
    if (!activeRun) return;
    if (!isRunStale(activeRun)) return;
    if (finalizedIds.current.has(activeRun.id)) return;
    finalizedIds.current.add(activeRun.id);
    void finalizeStaleBuyerFinderSearchRunAction(activeRun.id).then((r) => {
      if (r.run) setActiveRun(r.run);
    });
  }, [activeRun]);

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
    setActiveRun(null);
  }

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
          <SearchView
            value={query}
            onChange={setQuery}
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
