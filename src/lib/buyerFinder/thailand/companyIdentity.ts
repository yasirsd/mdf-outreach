/**
 * TH03 — Thailand bi-script company identity matcher.
 *
 * Deterministic, explainable, no fuzzy/ML scoring. The matcher
 * encodes the forbidden-promotion rules from the TH03 brief:
 *
 *   • A 13-digit juristic number match is STRONG (even without a
 *     name agreement).
 *   • An exact normalized Thai legal-name match is STRONG.
 *   • An exact normalized English legal-name match is STRONG.
 *   • A Thai or English name match plus corroborating domain or
 *     address is "exact".
 *   • Transliteration similarity alone is NOT accepted.
 *   • Fuzzy English-name similarity is NOT accepted.
 *   • Domain or address similarity alone is NOT accepted.
 */

import { normalizeThaiJuristicNumber } from "./juristicNumber";
import { normalizeThaiLegalName } from "./companyName";
import { normalizeThaiTextForComparison } from "./text";

export type ThaiCompanyMatchLevel = "exact" | "strong" | "possible" | "no_match";

export type ThaiCompanyMatchReason =
  | "juristic_number_match"
  | "thai_legal_name_match"
  | "english_legal_name_match"
  | "domain_corroboration"
  | "address_corroboration"
  | "no_strong_signal";

export type ThaiCompanyMatchedField =
  | "juristicRegistrationNumber"
  | "thaiLegalName"
  | "englishLegalName"
  | "domain"
  | "address";

export interface ThaiCompanyIdentityInput {
  readonly juristicRegistrationNumber?: string | null;
  readonly thaiLegalName?: string | null;
  readonly englishLegalName?: string | null;
  readonly domain?: string | null;
  readonly address?: string | null;
}

export interface ThaiCompanyIdentityComparison {
  readonly matchLevel: ThaiCompanyMatchLevel;
  readonly reasons: readonly ThaiCompanyMatchReason[];
  readonly matchedFields: readonly ThaiCompanyMatchedField[];
}

function normalizedDomain(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  // Strip protocol + path + trailing slash + leading www.
  const noProto = trimmed.replace(/^[a-z]+:\/\//, "");
  const hostOnly = noProto.split("/")[0]!;
  const noWww = hostOnly.replace(/^www\./, "");
  return noWww || null;
}

function hasValue(x: string | null | undefined): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/**
 * Compare two Thailand company identities and return an explainable
 * match verdict. Only deterministic equality signals contribute; no
 * fuzzy / transliteration similarity is ever accepted.
 */
export function compareThaiCompanyIdentity(
  a: ThaiCompanyIdentityInput,
  b: ThaiCompanyIdentityInput,
): ThaiCompanyIdentityComparison {
  const reasons: ThaiCompanyMatchReason[] = [];
  const matchedFields: ThaiCompanyMatchedField[] = [];

  // 1. Juristic number equality (strongest). Both sides must normalize cleanly.
  const juristicA = normalizeThaiJuristicNumber(a.juristicRegistrationNumber ?? "");
  const juristicB = normalizeThaiJuristicNumber(b.juristicRegistrationNumber ?? "");
  if (juristicA !== null && juristicB !== null && juristicA === juristicB) {
    reasons.push("juristic_number_match");
    matchedFields.push("juristicRegistrationNumber");
  }

  // 2. Thai legal-name equality on the comparison key.
  const thaiA = hasValue(a.thaiLegalName) ? normalizeThaiLegalName(a.thaiLegalName).comparisonKey : "";
  const thaiB = hasValue(b.thaiLegalName) ? normalizeThaiLegalName(b.thaiLegalName).comparisonKey : "";
  if (thaiA && thaiB && thaiA === thaiB) {
    reasons.push("thai_legal_name_match");
    matchedFields.push("thaiLegalName");
  }

  // 3. English legal-name equality on the comparison key.
  const englishA = hasValue(a.englishLegalName) ? normalizeThaiLegalName(a.englishLegalName).comparisonKey : "";
  const englishB = hasValue(b.englishLegalName) ? normalizeThaiLegalName(b.englishLegalName).comparisonKey : "";
  if (englishA && englishB && englishA === englishB) {
    reasons.push("english_legal_name_match");
    matchedFields.push("englishLegalName");
  }

  // 4. Domain corroboration (NEVER alone; only promotes an existing name match).
  const domainA = normalizedDomain(a.domain);
  const domainB = normalizedDomain(b.domain);
  const domainMatch = domainA !== null && domainB !== null && domainA === domainB;

  // 5. Address corroboration (comparison-form equality; never alone).
  const addrA = hasValue(a.address) ? normalizeThaiTextForComparison(a.address) : "";
  const addrB = hasValue(b.address) ? normalizeThaiTextForComparison(b.address) : "";
  const addressMatch = Boolean(addrA && addrB && addrA === addrB);

  const hasNameMatch =
    reasons.includes("thai_legal_name_match") || reasons.includes("english_legal_name_match");

  if (domainMatch && hasNameMatch) {
    reasons.push("domain_corroboration");
    matchedFields.push("domain");
  }
  if (addressMatch && hasNameMatch) {
    reasons.push("address_corroboration");
    matchedFields.push("address");
  }

  // Decide the overall match level.
  // - juristic number match → strong (and exact if any corroboration present).
  // - name match + corroboration → exact.
  // - name match alone → strong.
  // - corroboration without name or juristic → NEVER strong (TH03 rule).
  //   At most "possible" — but even that we only report when at
  //   least one deterministic equality fired; otherwise no_match.
  let matchLevel: ThaiCompanyMatchLevel = "no_match";
  const juristicMatched = reasons.includes("juristic_number_match");
  const corroborated = reasons.includes("domain_corroboration") || reasons.includes("address_corroboration");

  if (juristicMatched && (hasNameMatch || corroborated)) matchLevel = "exact";
  else if (juristicMatched) matchLevel = "strong";
  else if (hasNameMatch && corroborated) matchLevel = "exact";
  else if (hasNameMatch) matchLevel = "strong";
  else if (domainMatch || addressMatch) {
    // Corroboration-only is explicitly NOT strong. Report as
    // "possible" with no_strong_signal so downstream aggregators
    // treat it as a hint, never as identity proof.
    matchLevel = "possible";
    reasons.push("no_strong_signal");
    if (domainMatch) matchedFields.push("domain");
    if (addressMatch) matchedFields.push("address");
  }

  if (matchLevel === "no_match") {
    reasons.push("no_strong_signal");
  }

  return { matchLevel, reasons, matchedFields };
}
