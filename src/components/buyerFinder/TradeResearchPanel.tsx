"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import {
  cancelTradeResearchBatchAction,
  createTradeResearchBatchAction,
  getLatestTradeResearchJobForContextAction,
  getTradeResearchBatchAction,
} from "@/app/(app)/buyer-finder/tradeResearchActions";
import {
  PHASE_2A_STAGES,
  TRADE_RESEARCH_INTERPRETATION_VERSION,
  TRADE_RESEARCH_PLANNER_VERSION,
  isTerminalTradeResearchStatus,
  type TradeResearchBatchSnapshot,
  type TradeResearchJobSnapshot,
  type TradeResearchRequest,
} from "@/lib/tradeResearch/types";
import { phase2AStageState, TRADE_RESEARCH_STAGE_LABELS } from "@/lib/tradeResearch/stateMachine";
import { useTradeResearchPolling } from "@/lib/tradeResearch/useTradeResearchPolling";

export function TradeResearchBatchPanel({ requests, initialBatch, isOwner }: {
  requests: readonly TradeResearchRequest[];
  initialBatch?: TradeResearchBatchSnapshot;
  isOwner: boolean;
}) {
  const [batch, setBatch] = useState(initialBatch);
  const [pending, startTransition] = useTransition();
  const active = batch && !isTerminalTradeResearchStatus(batch.status);
  const fetchBatch = useCallback(() => batch ? getTradeResearchBatchAction(batch.id) : Promise.resolve(null), [batch?.id]);
  useTradeResearchPolling({ enabled: Boolean(active), fetchSnapshot: fetchBatch, onSnapshot: setBatch });
  if (!isOwner && !batch) return null;
  const settled = batch ? batch.completedCount + batch.partialCount + batch.needsReviewCount + batch.failedCount + batch.cancelledCount : 0;
  return (
    <section className="mb-4 rounded-[12px] border border-app-border bg-app-surface p-4" aria-label="Trade research batch">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[13.5px] font-semibold text-text-primary">Trade research</h2>
          <p className="mt-1 text-[11.5px] text-text-muted">Official free-source screening for the selected product and market. No shipment, product, or origin claim is inferred.</p>
        </div>
        {isOwner && !active && (
          <button className="btn-secondary" disabled={pending || requests.length === 0} onClick={() => startTransition(async () => {
            const result = await createTradeResearchBatchAction(requests);
            if (result.outcome === "created") { setBatch(result.batch); toast.success("Trade research queued"); }
            else toast.error(result.message);
          })}>Research trade activity</button>
        )}
      </div>
      {requests.length === 0 && (
        <p className="mt-2 text-[11px] text-text-muted">Choose a market and product with matching candidates before starting trade research.</p>
      )}
      {batch && (
        <div className="mt-3">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-[11.5px]">
            <Metric label="Candidates" value={batch.totalJobs} />
            <Metric label="Completed" value={batch.completedCount} />
            <Metric label="In progress" value={batch.runningCount} />
            <Metric label="Queued" value={batch.queuedCount} />
            <Metric label="Needs review" value={batch.needsReviewCount} />
            <Metric label="Official corroboration" value={batch.corroboratedCount} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-text-muted">
            <span>Batch completion · {settled} of {batch.totalJobs}</span>
            <span>Free research · ₹{batch.automaticSpendRupees} spent</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-app-elevated" aria-label={`Batch completion ${settled} of ${batch.totalJobs}`}>
            <div className="h-full bg-brand-orange transition-[width]" style={{ width: `${batch.totalJobs ? settled / batch.totalJobs * 100 : 0}%` }} />
          </div>
          {active && isOwner && <button className="btn-ghost mt-2" disabled={pending} onClick={() => startTransition(async () => {
            const result = await cancelTradeResearchBatchAction(batch.id);
            if (result.batch) setBatch(result.batch);
          })}>Cancel batch</button>}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><div className="text-text-muted">{label}</div><div className="mt-0.5 text-[15px] tabular-nums text-text-primary">{value}</div></div>;
}

export interface TradeResearchProductOption {
  id: string;
  label: string;
}

function requestKey(request: TradeResearchRequest): string {
  return [
    request.candidateId,
    request.marketCountryCode,
    request.productId,
    request.productForm ?? "",
    request.researchGoal,
  ].join("|");
}

function jobMatchesRequest(job: TradeResearchJobSnapshot | undefined, request: TradeResearchRequest): boolean {
  const context = job?.context;
  return Boolean(
    context
      && job?.contextFingerprint
      && context.candidateId === request.candidateId
      && context.marketCountryCode === request.marketCountryCode
      && context.productId === request.productId
      && context.productForm === request.productForm
      && context.researchGoal === request.researchGoal
      && context.providerPlanVersion === TRADE_RESEARCH_PLANNER_VERSION
      && context.interpretationVersion === TRADE_RESEARCH_INTERPRETATION_VERSION,
  );
}

export function CandidateTradeResearchPanel({
  candidateId,
  productOptions,
  marketCountryCode,
  marketLabel,
  initialJob,
  isOwner,
}: {
  candidateId: string;
  productOptions: readonly TradeResearchProductOption[];
  marketCountryCode?: string;
  marketLabel: string;
  initialJob?: TradeResearchJobSnapshot;
  isOwner: boolean;
}) {
  const [selectedProductId, setSelectedProductId] = useState(
    productOptions.length === 1 ? productOptions[0]!.id : "",
  );
  const selectedRequest = useMemo<TradeResearchRequest | undefined>(
    () => selectedProductId && marketCountryCode
      ? {
          candidateId,
          marketCountryCode,
          productId: selectedProductId,
          productForm: null,
          researchGoal: "screen_trade_activity",
        }
      : undefined,
    [candidateId, marketCountryCode, selectedProductId],
  );
  const selectedKey = selectedRequest ? requestKey(selectedRequest) : "";
  const initialMatches = selectedRequest ? jobMatchesRequest(initialJob, selectedRequest) : false;
  const [job, setJob] = useState(initialMatches ? initialJob : undefined);
  const [loadedKey, setLoadedKey] = useState(initialMatches ? selectedKey : "");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = job && !isTerminalTradeResearchStatus(job.status);
  const fetchJob = useCallback(
    () => selectedRequest
      ? getLatestTradeResearchJobForContextAction(selectedRequest)
      : Promise.resolve(null),
    [selectedRequest],
  );

  useEffect(() => {
    if (!selectedRequest || loadedKey === selectedKey) return;
    let cancelled = false;
    setLoading(true);
    void fetchJob()
      .then((latest) => {
        if (cancelled) return;
        setJob(latest ?? undefined);
        setLoading(false);
        setLoadedKey(selectedKey);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchJob, loadedKey, selectedKey, selectedRequest]);

  useTradeResearchPolling({ enabled: Boolean(active), fetchSnapshot: fetchJob, onSnapshot: setJob });
  return (
    <section className="rounded-[12px] border border-app-border bg-app-surface p-4" aria-labelledby="trade-intelligence-heading">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="trade-intelligence-heading" className="text-[13.5px] font-semibold text-text-primary">Trade Intelligence</h2><p className="mt-1 text-[11px] text-text-muted">Free official-source screening</p></div>
        {isOwner && !active && <button className="btn-secondary" disabled={pending || !selectedRequest} onClick={() => startTransition(async () => {
          if (!selectedRequest) return;
          const result = await createTradeResearchBatchAction([selectedRequest]);
          if (result.outcome === "created") { toast.success("Trade research queued"); const latest = await fetchJob(); if (latest) setJob(latest); }
          else toast.error(result.message);
        })}>Research trade activity</button>}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">Product</div>
          {productOptions.length > 1 ? (
            <select
              aria-label="Research product"
              className="input mt-1 w-full"
              value={selectedProductId}
              onChange={(event) => {
                setSelectedProductId(event.target.value);
                setJob(undefined);
                setLoadedKey("");
              }}
            >
              <option value="">Select a product</option>
              {productOptions.map((product) => <option key={product.id} value={product.id}>{product.label}</option>)}
            </select>
          ) : productOptions.length === 1 ? (
            <p className="mt-1 text-[12px] text-text-primary" data-selected-research-product={productOptions[0]!.id}>{productOptions[0]!.label}</p>
          ) : (
            <p className="mt-1 text-[11px] text-text-muted">Associate a product with this candidate before researching trade activity.</p>
          )}
        </div>
        <div>
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-muted">Market</div>
          <p className="mt-1 text-[12px] text-text-primary" data-research-market={marketCountryCode ?? "unavailable"}>
            {marketCountryCode ? `${marketLabel} (${marketCountryCode})` : "Canonical market unavailable"}
          </p>
        </div>
      </div>
      {!selectedProductId && productOptions.length > 1 ? (
        <p className="mt-3 text-[12px] text-text-muted">Choose the product context to view or start its trade research.</p>
      ) : loading ? (
        <p className="mt-3 text-[12px] text-text-muted">Loading trade research for this context…</p>
      ) : job ? (
        <JobContent job={job} />
      ) : selectedRequest ? (
        <p className="mt-3 text-[12px] text-text-muted">No trade research has been run for this product and market.</p>
      ) : null}
    </section>
  );
}

function JobContent({ job }: { job: TradeResearchJobSnapshot }) {
  const terminal = isTerminalTradeResearchStatus(job.status);
  if (!terminal) {
    // BI4F Phase 2A UX fix: distinguish `queued` (worker has not
    // claimed the job yet) from `running` (worker is actively
    // executing a truthful stage). "Preparing company identity" is
    // only truthful once the worker owns the job — before that we
    // display an explicit waiting affordance.
    if (job.status === "queued") {
      return (
        <div className="mt-3" role="status" aria-live="polite" data-job-state="queued">
          <div className="flex items-center gap-2 text-[11.5px] text-text-secondary" data-stage-state="queued">
            <Circle size={13} className="text-text-muted" aria-hidden />
            <span>Queued for research</span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted leading-relaxed">
            A background scheduler runs official-source screening a few times an hour. Feel
            free to close this page — the result will be here when you come back.
          </p>
          <div className="mt-3 text-[11px] text-text-muted">₹{job.automaticSpendRupees} spent</div>
        </div>
      );
    }
    return (
      <div className="mt-3" role="status" aria-live="polite" data-job-state="running">
        <div className="space-y-1.5">
          {PHASE_2A_STAGES.map((stage) => {
            const state = phase2AStageState(job.stage, stage);
            const Icon = state === "complete" ? Check : state === "active" ? Loader2 : Circle;
            return <div key={stage} data-stage={stage} data-state={state} className={`flex items-center gap-2 text-[11.5px] ${state === "pending" ? "text-text-muted" : "text-text-primary"}`}><Icon size={13} className={state === "active" ? "animate-spin" : ""} aria-hidden />{TRADE_RESEARCH_STAGE_LABELS[stage]}</div>;
          })}
        </div>
        <div className="mt-3 text-[11px] text-text-muted">₹{job.automaticSpendRupees} spent</div>
      </div>
    );
  }
  const r = job.result;
  // BI4F Phase 2B UI semantics fix: labels and source strings are
  // driven by `result_summary.evidence.source`, not hard-coded to
  // FDA FSVP. Widened `productEvidence` and new `originEvidence`
  // literals are mapped honestly for CID's company + HS6 + origin
  // evidence grain.
  const source = r.evidence?.source ?? "FDA FSVP";
  const isCid = source === "Canadian Importers Database";
  const officialProgramLabelDt = isCid
    ? "Official importer-directory evidence"
    : "Official importer-program evidence";
  const officialLabel =
    r.officialProgramEvidence === "verified" ? "Verified" :
    r.officialProgramEvidence === "needs_review" ? "Needs review" :
    r.officialProgramEvidence === "no_verified_match" ? "No verified match found" :
    "Not evaluated";
  const productEvidenceLabel =
    r.productEvidence === "verified" ? "Verified" :
    r.productEvidence === "supporting" ? "Supporting evidence" :
    r.productEvidence === "no_verified_match" ? "No verified match found" :
    "Not available from this source";
  const originEvidenceLabel =
    r.originEvidence === "verified" ? "Verified" :
    r.originEvidence === "supporting" ? "Supporting evidence" :
    r.originEvidence === "no_verified_match" ? "No verified match found" :
    r.originEvidence === "not_verified" ? "Not verified" :
    "Not available from this source";
  const indiaOriginLabel =
    r.indiaOrigin === "verified" ? "Verified" :
    r.indiaOrigin === "supporting" ? "Supporting evidence" :
    "Not verified";
  const matchedLocationDt = isCid ? "Matched province" : "Matched state";
  const providerLabel = (providerId: string) =>
    providerId === "fda-fsvp" ? "FDA FSVP" :
    providerId === "fda-vqip" ? "FDA VQIP" :
    providerId === "canada-cid" ? "Canadian Importers Database" : providerId;
  const executionLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, (value) => value.toUpperCase());
  return (
    <div className="mt-3 text-[12px]">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
        <dt className="text-text-muted">{officialProgramLabelDt}</dt><dd className="text-text-primary" data-evidence-status={r.officialProgramEvidence}>{officialLabel}</dd>
        <dt className="text-text-muted">Product evidence</dt><dd className="text-text-primary" data-product-evidence={r.productEvidence}>{productEvidenceLabel}</dd>
        <dt className="text-text-muted">Origin evidence</dt><dd className="text-text-primary" data-origin-evidence={r.originEvidence}>{originEvidenceLabel}</dd>
        <dt className="text-text-muted">India origin</dt><dd className="text-text-primary" data-india-origin={r.indiaOrigin}>{indiaOriginLabel}</dd>
        <dt className="text-text-muted">Shipment evidence</dt><dd className="text-text-primary">Not verified</dd>
        <dt className="text-text-muted">Sources checked</dt><dd className="text-text-primary tabular-nums" data-testid="sources-checked">{r.sourcesChecked}</dd>
        {r.sourcesPlanned !== undefined && <><dt className="text-text-muted">Sources planned</dt><dd className="text-text-primary tabular-nums">{r.sourcesPlanned}</dd></>}
        {r.sourcesFailed !== undefined && r.sourcesFailed > 0 && <><dt className="text-text-muted">Sources failed</dt><dd className="text-text-primary tabular-nums">{r.sourcesFailed}</dd></>}
        <dt className="text-text-muted">Cost</dt><dd className="text-text-primary">₹{r.automaticSpendRupees} spent</dd>
      </dl>
      {r.officialProgramEvidence === "not_checked" && <p className="mt-3 text-[11px] leading-relaxed text-text-muted">No eligible free official source was evaluated for this candidate&apos;s scope. This is not evidence for or against import activity.</p>}
      {r.officialProgramEvidence === "no_verified_match" && <p className="mt-3 text-[11px] leading-relaxed text-text-muted">This means no match was found in the checked dataset. It does not prove the company has no import activity.</p>}
      {r.providerResults ? (
        <details className="mt-3" data-provider-results="true">
          <summary className="cursor-pointer text-text-secondary">View evidence ({r.providerResults.length} sources)</summary>
          {r.providerResults.map((provider) => (
            <section key={provider.providerId} className="mt-3 rounded border border-app-border p-2" data-provider-result={provider.providerId}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-semibold text-text-primary">{providerLabel(provider.providerId)}</h3>
                <span className="text-[11px] text-text-secondary" data-provider-status={provider.execution.status}>{executionLabel(provider.execution.status)}</span>
              </div>
              {provider.execution.safeErrorCode && <p className="mt-1 text-[11px] text-text-muted">Source status: {provider.execution.safeErrorCode.replace(/_/g, " ").toLowerCase()}</p>}
              {provider.evidence && (
                <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-text-muted">Dataset period</dt><dd>{provider.sourcePeriod ?? "—"}</dd>
                  <dt className="text-text-muted">Retrieved</dt><dd>{provider.retrievedAt ? new Date(provider.retrievedAt).toLocaleDateString() : "—"}</dd>
                  <dt className="text-text-muted">Identity decision</dt><dd>{provider.evidence.matchDecision}</dd>
                  <dt className="text-text-muted">Coverage</dt><dd>{provider.evidence.coverage.explanation}</dd>
                  <dt className="text-text-muted">Limitations</dt><dd>{provider.evidence.limitations.join(" ")}</dd>
                  <dt className="text-text-muted">Attribution</dt><dd>{provider.evidence.attribution}</dd>
                </dl>
              )}
            </section>
          ))}
        </details>
      ) : r.sources && r.sources.length > 1 ? (
        <details className="mt-3" data-multi-source="true">
          <summary className="cursor-pointer text-text-secondary">View evidence ({r.sources.length} sources)</summary>
          {r.aggregate && (
            <p className="mt-2 text-[11px] text-text-muted" data-aggregate-identity={r.aggregate.identity}>
              <strong>Aggregate:</strong> {r.aggregate.identity.replace(/_/g, " ")} — {r.aggregate.reason}
            </p>
          )}
          {r.sources.map((src) => (
            <section key={src.providerId} className="mt-3 rounded border border-app-border p-2" data-source={src.providerId}>
              <h3 className="text-[12px] font-semibold text-text-primary">{src.source}</h3>
              <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-text-muted">Dataset period</dt><dd>{src.datasetPeriod}</dd>
                <dt className="text-text-muted">Retrieved</dt><dd>{new Date(src.retrievedAt).toLocaleDateString()}</dd>
                <dt className="text-text-muted">Matched name</dt><dd>{src.matchedSourceName ?? "—"}</dd>
                <dt className="text-text-muted">Matched location</dt><dd>{src.matchedState ?? "—"}</dd>
                <dt className="text-text-muted">Identity decision</dt><dd data-source-identity={src.identityDecision}>{src.identityDecision}</dd>
                <dt className="text-text-muted">Company evidence</dt><dd data-source-company={src.companyEvidence}>{src.companyEvidence}</dd>
                <dt className="text-text-muted">Product evidence</dt><dd>{src.productEvidence}</dd>
                <dt className="text-text-muted">Origin evidence</dt><dd>{src.originEvidence}</dd>
                <dt className="text-text-muted">Shipment evidence</dt><dd>Not verified</dd>
                <dt className="text-text-muted">Reason</dt><dd>{src.matchReason}</dd>
                <dt className="text-text-muted">Coverage</dt><dd>{src.coverageExplanation}</dd>
                <dt className="text-text-muted">Attribution</dt><dd>{src.attribution}</dd>
              </dl>
            </section>
          ))}
        </details>
      ) : r.evidence && (
        <details className="mt-3"><summary className="cursor-pointer text-text-secondary">View evidence</summary><dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-text-muted">Source</dt><dd data-evidence-source={source}>{source}</dd><dt className="text-text-muted">Dataset period</dt><dd>{r.evidence.datasetPeriod}</dd><dt className="text-text-muted">Retrieved</dt><dd>{new Date(r.evidence.retrievedAt).toLocaleDateString()}</dd><dt className="text-text-muted">Matched name</dt><dd>{r.evidence.matchedSourceName ?? "—"}</dd><dt className="text-text-muted">{matchedLocationDt}</dt><dd>{r.evidence.matchedState ?? "—"}</dd><dt className="text-text-muted">Identity decision</dt><dd>{r.evidence.identityDecision}</dd><dt className="text-text-muted">Reason</dt><dd>{r.evidence.matchReason}</dd><dt className="text-text-muted">Coverage</dt><dd>{r.evidence.coverageExplanation}</dd>
        </dl></details>
      )}
    </div>
  );
}
