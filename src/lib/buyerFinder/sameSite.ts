/**
 * Same-company site policy for public website fetches.
 *
 * Conservative V1 (no Public Suffix List): the candidate's own host and
 * its subdomains. Not naive `endsWith(candidateDomain)`.
 *
 * Future hardening: PSL / eTLD+1 (tldts) when that dependency is available.
 */

import { domainToASCII } from "node:url";
import { normalizeDomain } from "./normalize";

function asciiHost(hostname: string | null | undefined): string | undefined {
  const raw = (hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return undefined;
  if (raw.includes("/") || raw.includes(" ") || raw.includes("..")) return undefined;
  let ascii: string;
  try {
    ascii = domainToASCII(raw);
  } catch {
    return undefined;
  }
  if (!ascii) return undefined;
  return ascii.replace(/^www\./, "") || undefined;
}

export function normalizeHostname(hostname: string | null | undefined): string | undefined {
  return asciiHost(hostname);
}

/** Candidate host used for suffix comparison (www stripped, punycode). */
export function registrableDomain(hostname: string | null | undefined): string | undefined {
  return asciiHost(hostname) ?? asciiHost(normalizeDomain(hostname));
}

function hasAtLeastTwoLabels(host: string): boolean {
  const labels = host.split(".").filter(Boolean);
  return labels.length >= 2 && labels.every((l) => l.length > 0);
}

/**
 * True when `hostname` is the candidate company domain or a subdomain
 * of it. False for deceptive suffixes such as evilcompany.com.
 */
export function isSameCompanySite(
  candidateDomain: string | null | undefined,
  hostname: string | null | undefined,
): boolean {
  const cand = registrableDomain(candidateDomain);
  const host = registrableDomain(hostname);
  if (!cand || !host) return false;
  if (!hasAtLeastTwoLabels(cand) || !hasAtLeastTwoLabels(host)) return false;
  if (host === cand) return true;
  return host.endsWith(`.${cand}`);
}
