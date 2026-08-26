"use client";

import type { BuyerCandidateRecord } from "@/lib/buyerFinder/types";
import { CandidateCard } from "@/components/buyerFinder/CandidateCard";

export function QueueView({ records }: { records: BuyerCandidateRecord[] }) {
  if (records.length === 0) {
    return (
      <div
        className="rounded-[16px] p-14 text-center"
        style={{
          backgroundColor: "var(--app-surface)",
          border: "1px dashed var(--app-border-strong)",
        }}
      >
        <div className="text-[10.5px] tracking-[0.16em] uppercase text-brand-orange font-medium mb-3">
          Empty
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight text-text-primary">
          No mock candidates match.
        </h2>
        <p className="mt-2 text-[13.5px] text-text-secondary leading-relaxed max-w-md mx-auto">
          Adjust search filters or clear them to see the local review queue.
        </p>
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {records.map((record) => (
        <CandidateCard key={record.candidate.id} record={record} />
      ))}
    </div>
  );
}
