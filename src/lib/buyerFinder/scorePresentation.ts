/**
 * Truthful presentation of Buyer Finder scores and product-match strength.
 * Does not change persisted scoring inputs.
 */

import type { BuyerCandidateProductMatch } from "./types";

/**
 * Hunter Discover does not return a measured product-relevance score in
 * our mapping. Persisted `relevance: 50` is a directory-match placeholder
 * used only so scoring has a numeric input — it is not a precise 50%.
 */
export function isDirectoryKeywordMatch(match: BuyerCandidateProductMatch): boolean {
  if (match.source === "hunter") return true;
  const notes = (match.evidence ?? []).map((e) => e.note).join("\n");
  return /Hunter Discover company match|Directory match only/i.test(notes);
}

export function productMatchStrengthLabel(match: BuyerCandidateProductMatch): string {
  if (isDirectoryKeywordMatch(match)) return "Directory keyword match";
  if (match.relevance == null || !Number.isFinite(match.relevance)) return "Product match";
  return `${Math.round(match.relevance)}% relevance`;
}
