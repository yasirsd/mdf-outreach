/**
 * Deterministic Buyer Finder duplicate detection.
 * Evaluates only — never merges, deletes, or writes.
 * Does not load Buyers or candidates; callers pass data in.
 */

import type { Buyer } from "@/lib/types";
import { normalizeDomain, normalizeOptionalEmail } from "./normalize";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidateRecord } from "./types";

export type DuplicateConfidence = "exact" | "high" | "possible" | "none";

export type DuplicateReasonType = "email" | "domain" | "company_name" | "company_name_country";

export interface DuplicateReason {
  type: DuplicateReasonType;
  value: string;
}

export interface BuyerDuplicateMatch {
  buyerId: string;
  confidence: Exclude<DuplicateConfidence, "none">;
  reasons: DuplicateReason[];
}

export interface BuyerDuplicateResult {
  status: DuplicateConfidence;
  matches: BuyerDuplicateMatch[];
}

export interface CandidateDuplicateMatch {
  candidateId: string;
  confidence: Exclude<DuplicateConfidence, "none">;
  reasons: DuplicateReason[];
}

export interface CandidateDuplicateResult {
  status: DuplicateConfidence;
  matches: CandidateDuplicateMatch[];
}

/**
 * Personal / public mailbox providers. Corporate-domain matching must ignore these.
 * Local and static — not a third-party list.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.co.uk",
  "yahoo.in",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
]);

const LEGAL_SUFFIXES = new Set([
  "ltd",
  "limited",
  "co",
  "company",
  "inc",
  "incorporated",
  "llc",
  "plc",
  "corp",
  "corporation",
  "pvt",
  "private",
  "pte",
  "lp",
  "llp",
]);

const RANK: Record<DuplicateConfidence, number> = {
  none: 0,
  possible: 1,
  high: 2,
  exact: 3,
};

export function isPublicEmailDomain(domain: string | null | undefined): boolean {
  const d = normalizeDomain(domain);
  return d ? PUBLIC_EMAIL_DOMAINS.has(d) : false;
}

/** Lowercase, strip punctuation, drop trailing legal suffixes. Conservative — not fuzzy. */
export function normalizeCompanyNameForCompare(name: string | null | undefined): string | undefined {
  try {
    let s = (name ?? "").toLowerCase().replace(/&/g, " and ");
    s = s.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    if (!s) return undefined;
    const tokens = s.split(" ");
    if (tokens[0] === "the") tokens.shift();
    while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
      tokens.pop();
    }
    const out = tokens.join(" ").trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCountry(value: string | null | undefined): string | undefined {
  const s = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return s.length > 0 ? s : undefined;
}

export function emailDomain(email: string | null | undefined): string | undefined {
  const e = normalizeOptionalEmail(email);
  if (!e) return undefined;
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return undefined;
  const local = e.slice(0, at);
  const domain = normalizeDomain(e.slice(at + 1));
  if (!local || !domain) return undefined;
  return domain;
}

function corporateDomain(value: string | null | undefined): string | undefined {
  const d = normalizeDomain(value);
  if (!d || isPublicEmailDomain(d)) return undefined;
  return d;
}

function candidateEmails(candidate: BuyerCandidate, contacts: BuyerCandidateContact[]): string[] {
  const out = new Set<string>();
  const general = normalizeOptionalEmail(candidate.generalEmail);
  if (general) out.add(general);
  for (const c of contacts) {
    const e = normalizeOptionalEmail(c.businessEmail);
    if (e) out.add(e);
  }
  return [...out];
}

function candidateCorporateDomains(candidate: BuyerCandidate, contacts: BuyerCandidateContact[]): string[] {
  const out = new Set<string>();
  const fromField = corporateDomain(candidate.domain);
  const fromSite = corporateDomain(candidate.website);
  if (fromField) out.add(fromField);
  if (fromSite) out.add(fromSite);
  for (const e of candidateEmails(candidate, contacts)) {
    const d = corporateDomain(emailDomain(e));
    if (d) out.add(d);
  }
  return [...out];
}

function buyerCorporateDomains(buyer: Buyer): string[] {
  const out = new Set<string>();
  const fromSite = corporateDomain(buyer.website);
  if (fromSite) out.add(fromSite);
  const fromEmail = corporateDomain(emailDomain(buyer.email));
  if (fromEmail) out.add(fromEmail);
  return [...out];
}

function strongestConfidence(
  reasons: DuplicateReason[],
): Exclude<DuplicateConfidence, "none"> | undefined {
  if (reasons.some((r) => r.type === "email")) return "exact";
  if (reasons.some((r) => r.type === "domain" || r.type === "company_name_country")) return "high";
  if (reasons.some((r) => r.type === "company_name")) return "possible";
  return undefined;
}

function overallStatus<T extends { confidence: Exclude<DuplicateConfidence, "none"> }>(
  matches: T[],
): DuplicateConfidence {
  let best: DuplicateConfidence = "none";
  for (const m of matches) {
    if (RANK[m.confidence] > RANK[best]) best = m.confidence;
  }
  return best;
}

function compareCompanySignals(
  leftName: string | undefined,
  leftCountry: string | undefined,
  rightName: string | undefined,
  rightCountry: string | undefined,
): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  if (!leftName || !rightName || leftName !== rightName) return reasons;
  const sameCountry = Boolean(leftCountry && rightCountry && leftCountry === rightCountry);
  if (sameCountry) {
    reasons.push({ type: "company_name_country", value: `${leftName} / ${leftCountry}` });
  } else {
    reasons.push({ type: "company_name", value: leftName });
  }
  return reasons;
}

function collectEmailReasons(leftEmails: string[], rightEmails: string[]): DuplicateReason[] {
  const rights = new Set(rightEmails);
  const reasons: DuplicateReason[] = [];
  for (const e of leftEmails) {
    if (rights.has(e)) reasons.push({ type: "email", value: e });
  }
  return reasons;
}

function collectDomainReasons(left: string[], right: string[]): DuplicateReason[] {
  const rights = new Set(right);
  const reasons: DuplicateReason[] = [];
  for (const d of left) {
    if (rights.has(d)) reasons.push({ type: "domain", value: d });
  }
  return reasons;
}

function rankMatches<T extends { confidence: Exclude<DuplicateConfidence, "none"> }>(matches: T[]): T[] {
  return [...matches].sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
}

export function findBuyerDuplicates(input: {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  existingBuyers: Buyer[];
}): BuyerDuplicateResult {
  const { candidate, contacts, existingBuyers } = input;
  const emails = candidateEmails(candidate, contacts);
  const domains = candidateCorporateDomains(candidate, contacts);
  const name = normalizeCompanyNameForCompare(candidate.companyName);
  const country = normalizeCountry(candidate.country);

  const matches: BuyerDuplicateMatch[] = [];
  for (const buyer of existingBuyers ?? []) {
    if (!buyer?.id) continue;
    const buyerEmail = normalizeOptionalEmail(buyer.email);
    const reasons: DuplicateReason[] = [
      ...collectEmailReasons(emails, buyerEmail ? [buyerEmail] : []),
      ...collectDomainReasons(domains, buyerCorporateDomains(buyer)),
      ...compareCompanySignals(
        name,
        country,
        normalizeCompanyNameForCompare(buyer.company),
        normalizeCountry(buyer.country),
      ),
    ];
    const confidence = strongestConfidence(reasons);
    if (!confidence) continue;
    matches.push({ buyerId: buyer.id, confidence, reasons });
  }

  const ranked = rankMatches(matches);
  return { status: overallStatus(ranked), matches: ranked };
}

export function findCandidateDuplicates(
  candidate: BuyerCandidateRecord,
  candidates: BuyerCandidateRecord[],
): CandidateDuplicateResult {
  const emails = candidateEmails(candidate.candidate, candidate.contacts);
  const domains = candidateCorporateDomains(candidate.candidate, candidate.contacts);
  const name = normalizeCompanyNameForCompare(candidate.candidate.companyName);
  const country = normalizeCountry(candidate.candidate.country);
  const selfId = candidate.candidate.id;

  const matches: CandidateDuplicateMatch[] = [];
  for (const other of candidates ?? []) {
    const otherId = other?.candidate?.id;
    if (!otherId || otherId === selfId) continue;
    const reasons: DuplicateReason[] = [
      ...collectEmailReasons(emails, candidateEmails(other.candidate, other.contacts ?? [])),
      ...collectDomainReasons(domains, candidateCorporateDomains(other.candidate, other.contacts ?? [])),
      ...compareCompanySignals(
        name,
        country,
        normalizeCompanyNameForCompare(other.candidate.companyName),
        normalizeCountry(other.candidate.country),
      ),
    ];
    const confidence = strongestConfidence(reasons);
    if (!confidence) continue;
    matches.push({ candidateId: otherId, confidence, reasons });
  }

  const ranked = rankMatches(matches);
  return { status: overallStatus(ranked), matches: ranked };
}
