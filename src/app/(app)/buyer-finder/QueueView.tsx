"use client";

import { CandidateCard, type CandidateCardInput } from "@/components/buyerFinder/CandidateCard";

export type QueueRowInput = CandidateCardInput;

export function QueueView({ rows }: { rows: QueueRowInput[] }) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-[16px] p-14 text-center"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px dashed var(--app-border-strong)",
        }}
      >
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium mb-3">
          Empty queue
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">
          No candidates yet.
        </h2>
        <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed max-w-md mx-auto">
          Use Search to discover companies via Hunter. Candidates persist here for review.
        </p>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {rows.map((row) => (
        <CandidateCard key={row.candidate.id} record={row} />
      ))}
    </div>
  );
}
