/**
 * Truthful presentation of Buyer Finder scores and product-match strength.
 * Does not change persisted scoring inputs.
 */

import type { BuyerCandidateProductMatch } from "./types";

export function isDirectoryKeywordMatch(match: BuyerCandidateProductMatch): boolean {
  if (match.source === "hunter") return true;
  const notes = (match.evidence ?? []).map((e) => e.note).join("\n");
  return /Hunter Discover company match|Directory match only/i.test(notes);
}

export function isDirectoryMatchEvidenceNote(note: string): boolean {
  return /Hunter Discover company match|Directory match only/i.test(note);
}

export function shouldShowEvidenceConfidence(note: string, confidence: number): boolean {
  if (isDirectoryMatchEvidenceNote(note)) return false;
  if (!Number.isFinite(confidence) || confidence <= 0) return false;
  return true;
}

export function productMatchStrengthLabel(match: BuyerCandidateProductMatch): string {
  if (isDirectoryKeywordMatch(match)) return "Directory keyword match";
  if (match.relevance == null || !Number.isFinite(match.relevance)) return "Product match";
  return `${Math.round(match.relevance)}% relevance`;
}
