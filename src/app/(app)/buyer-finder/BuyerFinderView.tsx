"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageContainer, PageHeader } from "@/components/ui/Page";
import { toast } from "@/components/ui/Toast";
import { SearchView, type SearchFormValue } from "./SearchView";
import { QueueView, type QueueRowInput } from "./QueueView";
import { ProviderUsageIndicator } from "@/components/buyerFinder/ProviderUsageIndicator";
import { SearchRunProgressSurface } from "@/components/buyerFinder/SearchRunProgress";
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
  HUNTER_DISCOVERY_DISABLED_FOOTER,
  HUNTER_NOT_CONFIGURED_FOOTER,
  type HunterDiscoveryAvailability,
} from "@/lib/buyerFinder/hunterAvailability";
import { useSearchRunPolling } from "@/lib/buyerFinder/useSearchRunPolling";

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
  initialActiveRun,
}: {
  initialQueue: QueueRow[];
  initialSummary: QueueSummary;
  queueLimit: number;
  hunterDiscovery: HunterDiscoveryAvailability;
  initialActiveRun: SafeSearchRunSnapshot | null;
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
    hunterDiscovery === "disabled"
      ? HUNTER_DISCOVERY_DISABLED_FOOTER
      : hunterDiscovery === "not_configured"
        ? HUNTER_NOT_CONFIGURED_FOOTER
        : healthyActive
          ? ALREADY_RUNNING_MESSAGE
          : null;

  useEffect(() => {
    let cancelled = false;
    if (hunterDiscovery === "disabled") {
      setUsage({ outcome: "disabled", usage: null });
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
    <PageContainer size="wide">
      <PageHeader
        title="Buyer Finder"
        subtitle="Search real companies, review candidates, and approve for later Buyer conversion. Nothing becomes a Buyer automatically."
        actions={
          usage ? (
            <ProviderUsageIndicator
              usage={usage.outcome === "ok" ? usage.usage : null}
              state={usage.outcome}
            />
          ) : null
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
  }));
}

function QueueHeader({ summary, limit }: { summary: QueueSummary; limit: number }) {
  const capped = summary.total > limit;
  return (
    <div className="mb-4 text-[12.5px] text-text-muted flex flex-wrap gap-x-4 gap-y-1">
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
