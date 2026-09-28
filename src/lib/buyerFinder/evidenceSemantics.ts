import type { BuyerCandidateProductMatch, CandidateEvidence } from "./types";

/** Discovery/query context can be retained for provenance, but is not evidence. */
export function isDiscoveryContextEvidence(item: CandidateEvidence): boolean {
  return /SEARCH INTENT|Hunter Discover company match|Hunter(?: Discover)? (?:company )?directory match|Directory match only/i.test(item.note);
}

export function observedEvidence(items: CandidateEvidence[] | undefined): CandidateEvidence[] {
  return (items ?? []).filter((item) => !isDiscoveryContextEvidence(item));
}

export function hasObservedProductEvidence(match: BuyerCandidateProductMatch): boolean {
  if (match.source === "hunter") return false;
  return observedEvidence(match.evidence).length > 0;
}
