import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_STATUS_LABELS } from "@/lib/types";

/**
 * MDF Outreach — F6 buyer pipeline aggregation.
 *
 * Visual grouping only: we bucket the canonical BuyerStatus values into
 * a smaller set of operational STAGES so the pipeline is legible at a
 * glance. The persisted status vocabulary is UNCHANGED — a buyer whose
 * status is "quotation-sent" still has status "quotation-sent" in every
 * repository, filter and audit event.
 *
 * Mapping (F6 pipeline visual grouping):
 *
 *   Pipeline               → statuses
 *   ────────────────────────────────────────────────────────────────
 *   Prospects              → new, qualified, ready
 *   Contacted              → contacted
 *   Engaged                → replied, interested
 *   In deal                → quotation-sent, negotiating
 *   Won                    → converted
 *   Not interested         → not-interested
 *
 * Each stage exposes both the aggregate count AND the per-status
 * breakdown so the Overview can present the grouping while still
 * making individual counts visible.
 */

export type PipelineStageKey =
  | "prospects"
  | "contacted"
  | "engaged"
  | "in_deal"
  | "won"
  | "not_interested";

export interface PipelineStageBreakdown {
  status: BuyerStatus;
  label: string;
  count: number;
}

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  /** Semantic role — the renderer uses this for tone, never for numbers. */
  tone: "neutral" | "progress" | "positive" | "warning" | "muted";
  count: number;
  breakdown: PipelineStageBreakdown[];
}

export interface BuyerPipeline {
  total: number;
  stages: PipelineStage[];
}

const STAGE_MAPPING: {
  key: PipelineStageKey;
  label: string;
  tone: PipelineStage["tone"];
  statuses: BuyerStatus[];
}[] = [
  { key: "prospects", label: "Prospects", tone: "neutral", statuses: ["new", "qualified", "ready"] },
  { key: "contacted", label: "Contacted", tone: "progress", statuses: ["contacted"] },
  { key: "engaged", label: "Engaged", tone: "progress", statuses: ["replied", "interested"] },
  { key: "in_deal", label: "In deal", tone: "progress", statuses: ["quotation-sent", "negotiating"] },
  { key: "won", label: "Won", tone: "positive", statuses: ["converted"] },
  { key: "not_interested", label: "Not interested", tone: "muted", statuses: ["not-interested"] },
];

/**
 * Aggregate buyers by pipeline stage. The total is the total number of
 * buyer rows passed in — every buyer is represented in exactly one stage.
 */
export function computePipeline(buyers: Buyer[]): BuyerPipeline {
  const perStatus = new Map<BuyerStatus, number>();
  for (const b of buyers) {
    perStatus.set(b.status, (perStatus.get(b.status) ?? 0) + 1);
  }
  const stages: PipelineStage[] = STAGE_MAPPING.map((m) => {
    const breakdown = m.statuses.map((s) => ({
      status: s,
      label: BUYER_STATUS_LABELS[s],
      count: perStatus.get(s) ?? 0,
    }));
    const count = breakdown.reduce((n, r) => n + r.count, 0);
    return { key: m.key, label: m.label, tone: m.tone, count, breakdown };
  });
  return { total: buyers.length, stages };
}
