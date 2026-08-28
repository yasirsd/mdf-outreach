/**
 * Deterministic Buyer Finder scoring.
 * Pure functions only — no repositories, network, time, or persistence.
 */

import { findBusinessProductById } from "./businessCatalogue";
import {
  blankToUndefined,
  normalizeDomain,
  normalizeOptionalEmail,
  normalizeOptionalUrl,
} from "./normalize";
import type {
  BusinessProductId,
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  EmailStatus,
} from "./types";

export const COMPANY_FIT_MAX = 45;
export const CONTACT_QUALITY_MAX = 40;
export const COMPLETENESS_MAX = 15;
export const SCORE_MAX = 100;

export type ScoreCategory = "companyFit" | "contactQuality" | "completeness";

export interface ScoreReason {
  code: string;
  label: string;
  points: number;
  category: ScoreCategory;
}

export interface BuyerScoreResult {
  total: number;
  companyFit: number;
  contactQuality: number;
  completeness: number;
  reasons: ScoreReason[];
}

export interface ScoreBuyerCandidateInput {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  productMatches: BuyerCandidateProductMatch[];
  /** When set, product points use this match only — not the max of all matches. */
  targetProductId?: BusinessProductId;
  /** When set, awards country-fit points for a case-insensitive country match. */
  targetCountry?: string;
}

export type RoleTier = 1 | 2 | 3 | 0;

export interface RoleScore {
  tier: RoleTier;
  points: number;
  matched?: string;
}

const PRODUCT_RELEVANCE_MAX = 22;
const IMPORTER_POINTS = 8;
const DISTRIBUTOR_POINTS = 4;
const BUYER_TYPE_POINTS = 5;
const COUNTRY_MATCH_POINTS = 4;
const INDUSTRY_POINTS = 2;

const PRIMARY_CONTACT_POINTS = 3;
const ROLE_TIER1_POINTS = 12;
const ROLE_TIER2_POINTS = 8;
const ROLE_TIER3_POINTS = 6;
const ROLE_GENERIC_POINTS = 2;
const CONTACT_SCORE_MAX = 5;
const EMAIL_EXISTS_POINTS = 6;
const EMAIL_VALID_POINTS = 8;
const EMAIL_ACCEPT_ALL_POINTS = 5;
const EMAIL_UNVERIFIED_POINTS = 2;
const EMAIL_CONFIDENCE_MAX = 4;
const CONTACT_LINKEDIN_POINTS = 2;

const DECISION_MAKER_POINTS = 3;
const SENIORITY_EXECUTIVE_POINTS = 2;
const SENIORITY_SENIOR_POINTS = 1;

const TIER1_PHRASES = [
  "head of procurement",
  "head of purchasing",
  "head of sourcing",
  "head of import",
  "chief procurement officer",
  "chief purchasing officer",
  "procurement director",
  "purchasing director",
  "import director",
  "sourcing director",
  "procurement manager",
  "purchasing manager",
  "purchase manager",
  "import manager",
  "sourcing manager",
  "category manager",
  "procurement lead",
  "category buying",
] as const;

const TIER2_PHRASES = [
  "managing director",
  "supply chain manager",
  "supply chain director",
  "commercial director",
  "commercial manager",
  "general manager",
] as const;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function scalePoints(score: number | undefined, maxPoints: number): number {
  if (score == null || !Number.isFinite(score)) return 0;
  return clampInt((Math.min(100, Math.max(0, score)) / 100) * maxPoints, 0, maxPoints);
}

function normalizeTitle(jobTitle: string | null | undefined): string {
  return (jobTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function firstMatchingPhrase(haystack: string, phrases: readonly string[]): string | undefined {
  return phrases.find((p) => haystack.includes(p));
}

/** Deterministic role rank for MDF export outreach. No fuzzy-search library. */
export function scoreContactRole(jobTitle: string | null | undefined): RoleScore {
  const title = normalizeTitle(jobTitle);
  if (!title) return { tier: 0, points: 0 };

  const t1 = firstMatchingPhrase(title, TIER1_PHRASES);
  if (t1) return { tier: 1, points: ROLE_TIER1_POINTS, matched: t1 };

  if (/\b(procurement|purchasing|purchase|buyer|buying|sourcing)\b/.test(title)) {
    const matched =
      ["procurement", "purchasing", "purchase", "buyer", "buying", "sourcing"].find((p) =>
        title.includes(p),
      ) ?? "procurement";
    return { tier: 1, points: ROLE_TIER1_POINTS, matched };
  }
  if (/\b(importer|importing|imports|import)\b/.test(title)) {
    return { tier: 1, points: ROLE_TIER1_POINTS, matched: "import" };
  }

  const t2 = firstMatchingPhrase(title, TIER2_PHRASES);
  if (t2) return { tier: 2, points: ROLE_TIER2_POINTS, matched: t2 };

  if (/\b(owner|founder|co founder)\b/.test(title)) {
    const matched = title.includes("founder") ? "founder" : "owner";
    return { tier: 3, points: ROLE_TIER3_POINTS, matched };
  }
  if (/\b(chief executive|ceo)\b/.test(title)) {
    return { tier: 3, points: ROLE_TIER3_POINTS, matched: "ceo" };
  }
  if (/\bdirector\b/.test(title)) {
    return { tier: 3, points: ROLE_TIER3_POINTS, matched: "director" };
  }

  return { tier: 0, points: ROLE_GENERIC_POINTS, matched: "generic-title" };
}

function productLabel(id: BusinessProductId): string {
  return findBusinessProductById(id)?.displayName ?? id;
}

function emailStatusPoints(status: EmailStatus | undefined): number {
  if (status === "valid") return EMAIL_VALID_POINTS;
  if (status === "accept_all") return EMAIL_ACCEPT_ALL_POINTS;
  if (status === "unverified") return EMAIL_UNVERIFIED_POINTS;
  return 0;
}

function emailStatusLabel(status: EmailStatus | undefined): string | undefined {
  if (status === "valid") return "Primary-quality contact email verified";
  if (status === "accept_all") return "Contact email is accept-all";
  if (status === "unverified") return "Contact email is unverified";
  return undefined;
}

function buyerTypeFits(buyerType: string | undefined): boolean {
  if (!buyerType) return false;
  return /importer|distributor|wholesaler/i.test(buyerType);
}

function normalizeCountry(value: string | null | undefined): string | undefined {
  const s = blankToUndefined(value)?.toLowerCase();
  return s;
}

function strongestProductMatch(
  productMatches: BuyerCandidateProductMatch[],
  targetProductId: BusinessProductId | undefined,
): BuyerCandidateProductMatch | undefined {
  if (targetProductId) {
    return productMatches.find((m) => m.productId === targetProductId);
  }
  let best: BuyerCandidateProductMatch | undefined;
  for (const m of productMatches) {
    const rel = m.relevance ?? 0;
    if (!best || rel > (best.relevance ?? 0)) best = m;
  }
  return best;
}

function scoreOneContactReasons(contact: BuyerCandidateContact): ScoreReason[] {
  const personal: ScoreReason[] = [];
  const role = scoreContactRole(contact.jobTitle);
  if (role.points > 0) {
    personal.push({
      code: "contact-role",
      label:
        role.tier === 1
          ? `High-priority role (${role.matched})`
          : role.tier === 2
            ? `Useful commercial role (${role.matched})`
            : role.tier === 3
              ? `Decision-maker role (${role.matched})`
              : "Job title present",
      points: role.points,
      category: "contactQuality",
    });
  }

  if (contact.isDecisionMaker) {
    personal.push({
      code: "decision-maker",
      label: "Provider marks this person as a decision maker",
      points: DECISION_MAKER_POINTS,
      category: "contactQuality",
    });
  }

  const seniority = (contact.seniority ?? "").trim().toLowerCase();
  if (seniority === "executive") {
    personal.push({
      code: "seniority",
      label: "Executive seniority",
      points: SENIORITY_EXECUTIVE_POINTS,
      category: "contactQuality",
    });
  } else if (seniority === "senior") {
    personal.push({
      code: "seniority",
      label: "Senior seniority",
      points: SENIORITY_SENIOR_POINTS,
      category: "contactQuality",
    });
  }

  const cs = scalePoints(contact.contactScore, CONTACT_SCORE_MAX);
  const email = normalizeOptionalEmail(contact.businessEmail);
  if (cs > 0 && email) {
    personal.push({
      code: "contact-score",
      label: "Existing contact quality signal",
      points: cs,
      category: "contactQuality",
    });
  }

  if (email) {
    personal.push({
      code: "business-email",
      label: "Business email present",
      points: EMAIL_EXISTS_POINTS,
      category: "contactQuality",
    });
  }

  const statusPts = email ? emailStatusPoints(contact.emailStatus) : 0;
  const statusLbl = emailStatusLabel(contact.emailStatus);
  if (statusPts > 0 && statusLbl) {
    personal.push({
      code: "email-status",
      label: statusLbl,
      points: statusPts,
      category: "contactQuality",
    });
  }

  const invalid = contact.emailStatus === "invalid";
  const conf = email && !invalid ? scalePoints(contact.emailConfidence, EMAIL_CONFIDENCE_MAX) : 0;
  if (conf > 0) {
    personal.push({
      code: "email-confidence",
      label: "Email confidence",
      points: conf,
      category: "contactQuality",
    });
  }

  if (normalizeOptionalUrl(contact.linkedinUrl)) {
    personal.push({
      code: "contact-linkedin",
      label: "Contact LinkedIn URL present",
      points: CONTACT_LINKEDIN_POINTS,
      category: "contactQuality",
    });
  }

  return personal;
}

/** Personal contact-quality points for one person (no primary bonus). */
export function scoreOneContact(contact: BuyerCandidateContact): { points: number; reasons: ScoreReason[] } {
  const reasons = scoreOneContactReasons(contact).filter((r) => r.points > 0);
  const points = clampInt(
    reasons.reduce((n, r) => n + r.points, 0),
    0,
    CONTACT_QUALITY_MAX,
  );
  return { points, reasons };
}

function scoreBestContact(contacts: BuyerCandidateContact[]): {
  points: number;
  reasons: ScoreReason[];
} {
  const reasons: ScoreReason[] = [];
  if (contacts.some((c) => c.isPrimary)) {
    reasons.push({
      code: "primary-contact",
      label: "Primary contact identified",
      points: PRIMARY_CONTACT_POINTS,
      category: "contactQuality",
    });
  }

  let bestPersonal = 0;
  let bestReasons: ScoreReason[] = [];

  for (const contact of contacts) {
    const personal = scoreOneContactReasons(contact);
    const sum = personal.reduce((n, r) => n + r.points, 0);
    if (sum > bestPersonal) {
      bestPersonal = sum;
      bestReasons = personal;
    }
  }

  return { points: reasons.reduce((n, r) => n + r.points, 0) + bestPersonal, reasons: [...reasons, ...bestReasons] };
}

function scoreCompanyFit(input: ScoreBuyerCandidateInput): ScoreReason[] {
  const { candidate, productMatches, targetProductId, targetCountry } = input;
  const reasons: ScoreReason[] = [];

  const match = strongestProductMatch(productMatches, targetProductId);
  const productPts = scalePoints(match?.relevance, PRODUCT_RELEVANCE_MAX);
  if (match && productPts > 0) {
    const name = productLabel(match.productId);
    reasons.push({
      code: "product-relevance",
      label:
        targetProductId && match.productId === targetProductId
          ? `Target product match (${name})`
          : `Strongest product match (${name})`,
      points: productPts,
      category: "companyFit",
    });
  }

  if (candidate.isImporter) {
    reasons.push({
      code: "importer",
      label: "Company is an importer",
      points: IMPORTER_POINTS,
      category: "companyFit",
    });
  }
  if (candidate.isDistributor) {
    reasons.push({
      code: "distributor",
      label: "Company is a distributor",
      points: DISTRIBUTOR_POINTS,
      category: "companyFit",
    });
  }
  if (buyerTypeFits(candidate.buyerType)) {
    reasons.push({
      code: "buyer-type",
      label: "Buyer type is importer, distributor, or wholesaler",
      points: BUYER_TYPE_POINTS,
      category: "companyFit",
    });
  }

  const wanted = normalizeCountry(targetCountry);
  const got = normalizeCountry(candidate.country);
  if (wanted && got && wanted === got) {
    reasons.push({
      code: "country-match",
      label: "Country matches the search",
      points: COUNTRY_MATCH_POINTS,
      category: "companyFit",
    });
  }

  if (blankToUndefined(candidate.industry)) {
    reasons.push({
      code: "industry",
      label: "Industry recorded",
      points: INDUSTRY_POINTS,
      category: "companyFit",
    });
  }

  return reasons;
}

function scoreCompleteness(input: ScoreBuyerCandidateInput): ScoreReason[] {
  const { candidate, productMatches } = input;
  const reasons: ScoreReason[] = [];

  if (normalizeOptionalUrl(candidate.website)) {
    reasons.push({
      code: "website",
      label: "Company website present",
      points: 2,
      category: "completeness",
    });
  }
  if (normalizeDomain(candidate.domain ?? candidate.website)) {
    reasons.push({
      code: "domain",
      label: "Company domain present",
      points: 2,
      category: "completeness",
    });
  }
  if (blankToUndefined(candidate.city)) {
    reasons.push({
      code: "city",
      label: "City / location present",
      points: 2,
      category: "completeness",
    });
  }

  const evidence = candidate.evidence ?? [];
  const matchEvidence = productMatches.flatMap((m) => m.evidence ?? []);
  const allEvidence = [...evidence, ...matchEvidence];
  if (allEvidence.length >= 1) {
    reasons.push({
      code: "evidence",
      label: "Supporting evidence present",
      points: 2,
      category: "completeness",
    });
  }
  if (allEvidence.length >= 2) {
    reasons.push({
      code: "evidence-multiple",
      label: "Multiple independent evidence signals",
      points: 1,
      category: "completeness",
    });
  }

  if (productMatches.length >= 2) {
    reasons.push({
      code: "product-matches-multiple",
      label: "Multiple product matches",
      points: 2,
      category: "completeness",
    });
  }

  if (blankToUndefined(candidate.source)) {
    reasons.push({
      code: "source",
      label: "Discovery source recorded",
      points: 1,
      category: "completeness",
    });
  }
  if (normalizeOptionalUrl(candidate.companyLinkedinUrl)) {
    reasons.push({
      code: "company-linkedin",
      label: "Company LinkedIn URL present",
      points: 1,
      category: "completeness",
    });
  }
  if (blankToUndefined(candidate.address) || blankToUndefined(candidate.phone)) {
    reasons.push({
      code: "address-or-phone",
      label: "Address or phone present",
      points: 1,
      category: "completeness",
    });
  }
  if (normalizeOptionalEmail(candidate.generalEmail)) {
    reasons.push({
      code: "general-email",
      label: "General company email present",
      points: 1,
      category: "completeness",
    });
  }

  return reasons;
}

function sumCategory(reasons: ScoreReason[], category: ScoreCategory, max: number): number {
  return clampInt(
    reasons.filter((r) => r.category === category).reduce((n, r) => n + r.points, 0),
    0,
    max,
  );
}

/**
 * Score a Buyer Finder candidate. Same input always yields the same result.
 * Does not read or write Supabase. Does not cap the whole company at 0 for an invalid email.
 */
export function scoreBuyerCandidate(input: ScoreBuyerCandidateInput): BuyerScoreResult {
  const companyReasons = scoreCompanyFit(input);
  const contact = scoreBestContact(input.contacts ?? []);
  const completenessReasons = scoreCompleteness(input);

  const reasons = [...companyReasons, ...contact.reasons, ...completenessReasons].filter((r) => r.points > 0);

  const companyFit = sumCategory(reasons, "companyFit", COMPANY_FIT_MAX);
  const contactQuality = sumCategory(reasons, "contactQuality", CONTACT_QUALITY_MAX);
  const completeness = sumCategory(reasons, "completeness", COMPLETENESS_MAX);
  const total = clampInt(companyFit + contactQuality + completeness, 0, SCORE_MAX);

  return { total, companyFit, contactQuality, completeness, reasons };
}
