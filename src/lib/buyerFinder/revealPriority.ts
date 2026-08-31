/**
 * BF3C — operator reveal-priority ranking.
 *
 * Presentation / shortlist only. Never calls Hunter reveal.
 * Reuses scoreContactRole for procurement/import/executive families.
 * Trading titles are HIGH here without changing buyer_score formulas.
 */

import { scoreContactRole } from "./scoring";
import { comparePeopleForPrimary } from "./personRank";
import type { BuyerCandidate, BuyerCandidateContact, BuyerCandidatePublicEmail } from "./types";

export type RevealPriorityTier = "high" | "medium" | "low" | "none";

export interface RevealPriorityPerson {
  contactId: string;
  jobTitle: string;
  rolePoints: number;
  isDecisionMaker?: boolean;
  seniority?: string;
  hasLinkedin: boolean;
}

export interface RevealPriorityResult {
  tier: RevealPriorityTier;
  bestPerson?: RevealPriorityPerson;
  publicCompanyEmail?: string;
}

const COMMODITY_AGRI_COMMERCIAL_PHRASES = [
  "head of trading",
  "trading manager",
  "commodity trader",
  "commodities trader",
  "agricultural trader",
  "agri trader",
  "commodity director",
  "commodities director",
  "commodity manager",
  "commodities manager",
  "head of commodities",
  "head of commodity",
  "agricultural commodities",
  "agricultural commodity",
  "agri commodities",
  "agri commodity",
  "commodity trading",
  "commodities trading",
  "origination",
] as const;

function normalizeTitle(jobTitle: string | null | undefined): string {
  return (jobTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isUnrelatedCommodityContext(title: string): boolean {
  return /\b(sales|marketing|hr|human resources|it|software|engineer|engineering|support|accountant|accounting|recruiter)\b/.test(
    title,
  );
}

/**
 * Reveal-priority only. Does not change scoreContactRole.
 * Strong agri / commodity buying and trading leadership → HIGH.
 * Generic "Director" stays on the existing score map (MEDIUM).
 */
function isStrongCommodityOrTradingTitle(jobTitle: string | null | undefined): boolean {
  const title = normalizeTitle(jobTitle);
  if (!title || isUnrelatedCommodityContext(title)) return false;
  if (COMMODITY_AGRI_COMMERCIAL_PHRASES.some((p) => title.includes(p))) return true;
  const agriOrCommodity = /\b(agri|agricultural|agriculture|commodit(?:y|ies))\b/.test(title);
  const commercialLead = /\b(director|manager|head|trader|trading|origination)\b/.test(title);
  if (agriOrCommodity && commercialLead) return true;
  return /\btrader\b/.test(title) || /\btrading\b/.test(title);
}

export function revealPriorityTierForTitle(
  jobTitle: string | null | undefined,
): Exclude<RevealPriorityTier, "none"> {
  const scored = scoreContactRole(jobTitle);
  if (scored.tier === 1 || isStrongCommodityOrTradingTitle(jobTitle)) return "high";
  if (scored.tier === 2 || scored.tier === 3) return "medium";
  return "low";
}

export function revealPriorityTierRank(tier: RevealPriorityTier): number {
  if (tier === "high") return 3;
  if (tier === "medium") return 2;
  if (tier === "low") return 1;
  return 0;
}

export function compareRevealPriorityContacts(a: BuyerCandidateContact, b: BuyerCandidateContact): number {
  const ta = revealPriorityTierForTitle(a.jobTitle);
  const tb = revealPriorityTierForTitle(b.jobTitle);
  const tierDelta = revealPriorityTierRank(tb) - revealPriorityTierRank(ta);
  if (tierDelta !== 0) return tierDelta;
  const roleDelta = scoreContactRole(b.jobTitle).points - scoreContactRole(a.jobTitle).points;
  if (roleDelta !== 0) return roleDelta;
  const people = comparePeopleForPrimary(
    {
      jobTitle: a.jobTitle,
      isDecisionMaker: a.isDecisionMaker,
      seniority: a.seniority,
      fullName: a.fullName,
      providerRef: a.providerRef,
    },
    {
      jobTitle: b.jobTitle,
      isDecisionMaker: b.isDecisionMaker,
      seniority: b.seniority,
      fullName: b.fullName,
      providerRef: b.providerRef,
    },
  );
  if (people !== 0) return people;
  return Number(Boolean(b.linkedinUrl)) - Number(Boolean(a.linkedinUrl));
}

export function compareRevealPriorityResults(
  a: { priority: RevealPriorityResult; candidateScore?: number },
  b: { priority: RevealPriorityResult; candidateScore?: number },
): number {
  const tierDelta =
    revealPriorityTierRank(b.priority.tier) - revealPriorityTierRank(a.priority.tier);
  if (tierDelta !== 0) return tierDelta;
  const roleDelta = (b.priority.bestPerson?.rolePoints ?? 0) - (a.priority.bestPerson?.rolePoints ?? 0);
  if (roleDelta !== 0) return roleDelta;
  return (b.candidateScore ?? 0) - (a.candidateScore ?? 0);
}

export function assessRevealPriority(input: {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  publicEmails?: BuyerCandidatePublicEmail[];
}): RevealPriorityResult {
  const people = input.contacts.filter((c) => (c.fullName ?? "").trim() || (c.jobTitle ?? "").trim());
  const primaryPublic =
    input.publicEmails?.find((e) => e.isPrimary)?.email ??
    input.publicEmails?.[0]?.email ??
    input.candidate.generalEmail;

  if (people.length === 0) {
    return { tier: "none", publicCompanyEmail: primaryPublic };
  }

  const ranked = [...people].sort(compareRevealPriorityContacts);
  const best = ranked[0]!;
  const scored = scoreContactRole(best.jobTitle);
  return {
    tier: revealPriorityTierForTitle(best.jobTitle),
    bestPerson: {
      contactId: best.id,
      jobTitle: best.jobTitle,
      rolePoints: scored.points,
      isDecisionMaker: best.isDecisionMaker,
      seniority: best.seniority,
      hasLinkedin: Boolean(best.linkedinUrl),
    },
    publicCompanyEmail: primaryPublic,
  };
}
