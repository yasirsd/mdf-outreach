"use client";

import { useCallback, useState, useTransition } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import {
  cancelTradeResearchBatchAction,
  createTradeResearchBatchAction,
  getLatestTradeResearchJobForCandidateAction,
  getTradeResearchBatchAction,
} from "@/app/(app)/buyer-finder/tradeResearchActions";
import { PHASE_2A_STAGES, isTerminalTradeResearchStatus, type TradeResearchBatchSnapshot, type TradeResearchJobSnapshot } from "@/lib/tradeResearch/types";
import { phase2AStageState, TRADE_RESEARCH_STAGE_LABELS } from "@/lib/tradeResearch/stateMachine";
import { useTradeResearchPolling } from "@/lib/tradeResearch/useTradeResearchPolling";

export function TradeResearchBatchPanel({ candidateIds, initialBatch, isOwner }: {
  candidateIds: readonly string[];
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
          <p className="mt-1 text-[11.5px] text-text-muted">Official free-source screening. No shipment, product, or origin claim is inferred.</p>
        </div>
        {isOwner && !active && (
          <button className="btn-secondary" disabled={pending || candidateIds.length === 0} onClick={() => startTransition(async () => {
            const result = await createTradeResearchBatchAction(candidateIds);
            if (result.outcome === "created") { setBatch(result.batch); toast.success("Trade research queued"); }
            else toast.error(result.message);
          })}>Research trade activity</button>
        )}
      </div>
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

export function CandidateTradeResearchPanel({ candidateId, initialJob, isOwner }: {
  candidateId: string;
  initialJob?: TradeResearchJobSnapshot;
  isOwner: boolean;
}) {
  const [job, setJob] = useState(initialJob);
  const [pending, startTransition] = useTransition();
  const active = job && !isTerminalTradeResearchStatus(job.status);
  const fetchJob = useCallback(() => getLatestTradeResearchJobForCandidateAction(candidateId), [candidateId]);
  useTradeResearchPolling({ enabled: Boolean(active), fetchSnapshot: fetchJob, onSnapshot: setJob });
  return (
    <section className="rounded-[12px] border border-app-border bg-app-surface p-4" aria-labelledby="trade-intelligence-heading">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="trade-intelligence-heading" className="text-[13.5px] font-semibold text-text-primary">Trade Intelligence</h2><p className="mt-1 text-[11px] text-text-muted">Free official-source screening</p></div>
        {isOwner && !active && <button className="btn-secondary" disabled={pending} onClick={() => startTransition(async () => {
          const result = await createTradeResearchBatchAction([candidateId]);
          if (result.outcome === "created") { toast.success("Trade research queued"); const latest = await fetchJob(); if (latest) setJob(latest); }
          else toast.error(result.message);
        })}>Research trade activity</button>}
      </div>
      {job ? <JobContent job={job} /> : <p className="mt-3 text-[12px] text-text-muted">No trade research has been run for this candidate.</p>}
    </section>
  );
}

function JobContent({ job }: { job: TradeResearchJobSnapshot }) {
  const terminal = isTerminalTradeResearchStatus(job.status);
  if (!terminal) return (
    <div className="mt-3" role="status" aria-live="polite">
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
  const r = job.result;
  return (
    <div className="mt-3 text-[12px]">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
        <dt className="text-text-muted">Official importer-program evidence</dt><dd className="text-text-primary">{r.officialProgramEvidence === "verified" ? "Verified" : r.officialProgramEvidence === "needs_review" ? "Needs review" : "No verified match found"}</dd>
        <dt className="text-text-muted">Product evidence</dt><dd className="text-text-primary">Not available from this source</dd>
        <dt className="text-text-muted">India origin</dt><dd className="text-text-primary">Not verified</dd>
        <dt className="text-text-muted">Shipment evidence</dt><dd className="text-text-primary">Not verified</dd>
        <dt className="text-text-muted">Sources checked</dt><dd className="text-text-primary tabular-nums">{r.sourcesChecked}</dd>
        <dt className="text-text-muted">Cost</dt><dd className="text-text-primary">₹{r.automaticSpendRupees} spent</dd>
      </dl>
      {r.officialProgramEvidence === "no_verified_match" && <p className="mt-3 text-[11px] leading-relaxed text-text-muted">This means no match was found in the checked dataset. It does not prove the company has no import activity.</p>}
      {r.evidence && <details className="mt-3"><summary className="cursor-pointer text-text-secondary">View evidence</summary><dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-text-muted">Source</dt><dd>FDA FSVP</dd><dt className="text-text-muted">Dataset period</dt><dd>{r.evidence.datasetPeriod}</dd><dt className="text-text-muted">Retrieved</dt><dd>{new Date(r.evidence.retrievedAt).toLocaleDateString()}</dd><dt className="text-text-muted">Matched name</dt><dd>{r.evidence.matchedSourceName ?? "—"}</dd><dt className="text-text-muted">Matched state</dt><dd>{r.evidence.matchedState ?? "—"}</dd><dt className="text-text-muted">Identity decision</dt><dd>{r.evidence.identityDecision}</dd><dt className="text-text-muted">Reason</dt><dd>{r.evidence.matchReason}</dd><dt className="text-text-muted">Coverage</dt><dd>{r.evidence.coverageExplanation}</dd>
      </dl></details>}
    </div>
  );
}
