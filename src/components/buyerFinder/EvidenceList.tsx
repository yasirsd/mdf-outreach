import type { CandidateEvidence } from "@/lib/buyerFinder/types";
import { shouldShowEvidenceConfidence } from "@/lib/buyerFinder/scorePresentation";

export function EvidenceList({ evidence }: { evidence: CandidateEvidence[] }) {
  if (evidence.length === 0) {
    return <p className="text-[13px] text-text-muted">No evidence captured yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {evidence.map((item, i) => (
        <li key={`${item.note}-${i}`} className="text-[13px] leading-relaxed">
          <p className="text-text-primary">{item.note}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-muted">
            {shouldShowEvidenceConfidence(item.note, item.confidence) && (
              <span className="tabular-nums">Confidence {item.confidence}%</span>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-text-secondary hover:text-brand-orange transition-colors"
              >
                {item.url.replace(/^https?:\/\//, "")} ↗
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}