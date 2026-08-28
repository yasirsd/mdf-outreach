/**
 * Candidate.source is evidence provenance: the provider that actually
 * supplied the company record. It is not inferred from UI state or
 * Search Run provider alone.
 *
 * Merge precedence (single `source` column — no multi-provider attribution):
 * - Real provider evidence MAY upgrade mock → hunter (or other non-mock).
 * - Mock/test data must NEVER overwrite a non-mock source (hunter → mock).
 * - When both sides are already non-mock (or both mock), keep the existing value.
 * - Missing/unknown source is "other", never "mock".
 */

import { getProviderDescriptor } from "./providers/descriptors";
import type { CandidateSource } from "./types";

export const CANDIDATE_SOURCES: readonly CandidateSource[] = [
  "mock",
  "apollo",
  "hunter",
  "directory",
  "website",
  "other",
] as const;

function isCandidateSource(value: string): value is CandidateSource {
  return (CANDIDATE_SOURCES as readonly string[]).includes(value);
}

/**
 * Normalize a persisted or provider source.
 * Unknown/blank values become `other` — never `mock`.
 */
export function normalizeCandidateSource(raw: unknown): CandidateSource {
  if (typeof raw !== "string") return "other";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "other";
  if (isCandidateSource(trimmed)) return trimmed;
  return "other";
}

export function preferCandidateSource(
  existing: string | undefined | null,
  incoming: string | undefined | null,
): CandidateSource {
  const next = normalizeCandidateSource(incoming);
  const haveRaw = typeof existing === "string" ? existing.trim() : "";
  if (!haveRaw) return next;
  const have = normalizeCandidateSource(haveRaw);
  if (have === "mock" && next !== "mock") return next;
  if (next === "mock" && have !== "mock") return have;
  return have;
}

/**
 * Operator-facing label. Uses the provider descriptor display name when
 * one exists (Hunter, …) so UI copy is not hard-coded per component.
 */
export function candidateSourceLabel(source: string | undefined | null): string | undefined {
  const raw = typeof source === "string" ? source.trim() : "";
  if (!raw) return undefined;
  const descriptor = getProviderDescriptor(raw);
  if (descriptor) return descriptor.displayName;
  const normalized = normalizeCandidateSource(raw);
  if (normalized === "mock") return "Mock";
  if (normalized === "apollo") return "Apollo";
  if (normalized === "directory") return "Directory";
  if (normalized === "website") return "Website";
  if (normalized === "other") return raw === "other" ? "Other" : raw;
  return raw;
}
