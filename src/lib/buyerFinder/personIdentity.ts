/**
 * Stable MDF person identity for Buyer Finder contacts.
 *
 * Hunter `reveal_handle` (persisted as provider_ref) is an opaque CURRENT
 * provider reference used later for server-side reveal. It is not the
 * permanent person identity: Hunter may rotate handles across billing
 * periods.
 *
 * Fingerprint is scoped to one candidate and uses only stable masked
 * metadata. Never send provider_ref to the browser.
 */

import { normalizeDomain } from "./normalize";

export interface PersonFingerprintInput {
  candidateId: string;
  domain: string;
  maskedName: string;
  position: string;
}

function normalizePersonToken(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Deterministic identity for a masked person on one candidate.
 * Same candidate + domain + name + title → same fingerprint regardless
 * of the current provider_ref / reveal_handle.
 */
export function personFingerprint(input: PersonFingerprintInput): string {
  const candidateId = input.candidateId.trim().toLowerCase();
  const domain = normalizeDomain(input.domain) ?? "";
  const name = normalizePersonToken(input.maskedName);
  const title = normalizePersonToken(input.position);
  return `${candidateId}|${domain}|${name}|${title}`;
}
