"use client";

/**
 * TH06 FINAL — Thailand research section mounted inside the real
 * CandidateView. Market-gated: ONLY renders when the candidate's
 * market is Thailand. For US/CA candidates nothing renders — the
 * existing CandidateTradeResearchPanel keeps its historical shape.
 *
 * On mount the component fetches the server-assembled aggregate
 * (never computed in the browser) and the active manual-evidence
 * chain-leaf rows via the TH04C read action. On successful
 * manual-evidence writes the server actions call
 * `revalidatePath("/buyer-finder")` which triggers a re-fetch
 * through `router.refresh()`.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThailandEvidencePanel } from "./ThailandEvidencePanel";
import { ThailandManualEvidenceCards } from "./ThailandManualEvidenceCards";
import { getThailandAggregateForCandidateAction, type GetThailandAggregateResult } from "./getThailandAggregateAction";
import {
  getThailandManualEvidenceForCandidateAction,
  getThailandManualEvidenceHistoryAction,
  type ThailandManualEvidenceHistoryResult,
} from "../thailandManualEvidenceActions";
import type { ThailandManualEvidenceReadResult } from "@/lib/tradeResearch/thailand/manualEvidenceResolver";

export function ThailandResearchSection({
  candidateId,
  marketCountryCode,
}: {
  candidateId: string;
  marketCountryCode?: string;
}) {
  const router = useRouter();
  const [agg, setAgg] = useState<GetThailandAggregateResult | null>(null);
  const [manual, setManual] = useState<ThailandManualEvidenceReadResult | null>(null);
  const [history, setHistory] = useState<ThailandManualEvidenceHistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const normalizedMarket = typeof marketCountryCode === "string" ? marketCountryCode.toUpperCase() : "";
  const isThailand = normalizedMarket === "TH";

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [a, m, h] = await Promise.all([
        getThailandAggregateForCandidateAction(candidateId),
        getThailandManualEvidenceForCandidateAction(candidateId),
        getThailandManualEvidenceHistoryAction(candidateId),
      ]);
      setAgg(a);
      setManual(m);
      setHistory(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thailand research failed to load.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    if (!isThailand) {
      setLoading(false);
      setAgg(null);
      setManual(null);
      setHistory(null);
      return;
    }
    void load();
  }, [isThailand, load]);

  // Market gate — nothing renders for US/CA.
  if (!isThailand) return null;

  if (loading) {
    return (
      <section data-thailand-research="loading" aria-label="Thailand research" className="rounded-xl p-4 bg-[color:var(--app-surface)] border border-[color:var(--app-border)]">
        <p className="text-[12px] text-[color:var(--text-secondary)]">Loading Thailand research…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section data-thailand-research="error" aria-label="Thailand research" className="rounded-xl p-4 bg-[color:var(--app-surface)] border border-[color:var(--app-border)]">
        <p className="text-[12px] text-[color:#F08B7E]" role="alert">Thailand research unavailable: {error}</p>
      </section>
    );
  }
  if (!agg || !agg.isThailandMarket || !agg.aggregate) {
    return null; // defense-in-depth: server verified market gate again.
  }

  return (
    <div data-thailand-research="ready" className="space-y-4">
      {agg.productSupported === false && agg.unsupportedProductMessage ? (
        <p
          data-thailand-unsupported-product="true"
          role="status"
          className="rounded-md px-3 py-2 text-[12px] text-[color:var(--text-secondary)] bg-black/10 border border-[color:var(--app-border)]"
        >
          {agg.unsupportedProductMessage}
        </p>
      ) : null}
      <ThailandEvidencePanel aggregate={agg.aggregate} />
      <ThailandManualEvidenceCards
        candidateId={candidateId}
        active={{
          dbd: manual?.dbd,
          customsOperator: manual?.customsOperator,
          fdaImporter: manual?.fdaImporter,
        }}
        history={{
          dbd: history?.dbd,
          customsOperator: history?.customsOperator,
          fdaImporter: history?.fdaImporter,
        }}
      />
      <noscript>
        <p className="text-[11px] text-[color:var(--text-secondary)]">
          Manual evidence capture requires JavaScript. Evidence state is still rendered server-side.
        </p>
      </noscript>
      <button
        type="button"
        className="h-7 px-2 text-[11px] text-[color:var(--text-secondary)] underline"
        onClick={() => { void load(); router.refresh(); }}
      >
        Refresh Thailand evidence
      </button>
    </div>
  );
}
