/**
 * TH03 — Thailand legal-name normalization.
 *
 * Supports both Thai and English legal forms. The original string is
 * always retained; only a comparison key is produced with
 * legal-form tokens stripped so a company written as:
 *
 *   "บริษัท สยามสปิเซส จำกัด"
 *   "SIAM SPICES CO., LTD."
 *   "Siam Spices Co.,Ltd"
 *
 * all share a common comparison key for exact-match equality. No
 * fuzzy/transliteration similarity is used; the equality is only
 * meaningful when both inputs are the SAME SCRIPT (Thai↔Thai or
 * English↔English).
 */

import { normalizeThaiTextForComparison, normalizeThaiTextForDisplay } from "./text";

export type ThaiLegalForm = "company_limited" | "public_company_limited" | "unknown";

export interface ThaiLegalNameNormalization {
  /** Verbatim input (coerced to "" when not a string). */
  readonly original: string;
  /** Display-safe normalization (NFC, trimmed, whitespace collapsed). */
  readonly normalized: string;
  /**
   * Lower-cased, legal-form-stripped, punctuation-collapsed form.
   * Suitable ONLY for equality checks between like-script names.
   */
  readonly comparisonKey: string;
  readonly detectedLegalForm: ThaiLegalForm;
}

/**
 * Thai legal-form markers. Order matters — more specific patterns
 * must precede less specific ones so the longer "public company
 * limited" prefix is detected before the shorter "company limited".
 */
const THAI_PUBLIC_MARKERS: readonly RegExp[] = [
  /มหาชน/,       // Thai: "public"
  /บมจ\.?/,       // Thai abbreviation: บมจ. = Public Company Limited
];
const THAI_COMPANY_MARKERS: readonly RegExp[] = [
  /บริษัท/,       // Thai: "company"
  /จำกัด/,        // Thai: "limited"
  /บจก\.?/,       // Thai abbreviation: บจก. = Company Limited
];
const ENGLISH_PUBLIC_MARKERS: readonly RegExp[] = [
  /\bpublic\s+company\s+limited\b/i,
  /\bpcl\b/i,
];
const ENGLISH_COMPANY_MARKERS: readonly RegExp[] = [
  /\bco\.?,?\s*ltd\.?\b/i,
  /\bcompany\s+limited\b/i,
  /\bcompany\s+ltd\.?\b/i,
  /\bltd\.?\b/i,
];

/** Legal-form tokens stripped from the comparison key. */
const COMPARISON_STRIP_PATTERNS: readonly RegExp[] = [
  // Thai public
  /จำกัด\s*\(?\s*มหาชน\s*\)?/g,
  /มหาชน/g,
  /บมจ\.?/g,
  // Thai company limited
  /บริษัท/g,
  /จำกัด/g,
  /บจก\.?/g,
  // English public
  /\bpublic\s+company\s+limited\b/gi,
  /\bpcl\b/gi,
  // English company limited (variations)
  /\bco\.?,?\s*ltd\.?\b/gi,
  /\bcompany\s+limited\b/gi,
  /\bcompany\s+ltd\.?\b/gi,
  /\bltd\.?\b/gi,
];

function detectLegalForm(normalized: string): ThaiLegalForm {
  if (THAI_PUBLIC_MARKERS.some((p) => p.test(normalized))) return "public_company_limited";
  if (ENGLISH_PUBLIC_MARKERS.some((p) => p.test(normalized))) return "public_company_limited";
  if (THAI_COMPANY_MARKERS.some((p) => p.test(normalized))) return "company_limited";
  if (ENGLISH_COMPANY_MARKERS.some((p) => p.test(normalized))) return "company_limited";
  return "unknown";
}

/**
 * Normalize a company name for TH identity use.
 *
 * The `comparisonKey` is a LOWER-CASED, legal-form-stripped,
 * punctuation-collapsed representation of the substantive company
 * name. It must only be compared to another `comparisonKey` from
 * the SAME SCRIPT family (Thai↔Thai or English↔English). Cross-
 * script equality is handled by `compareThaiCompanyIdentity`.
 */
export function normalizeThaiLegalName(input: unknown): ThaiLegalNameNormalization {
  const original = typeof input === "string" ? input : "";
  const normalized = normalizeThaiTextForDisplay(original);
  const detectedLegalForm = detectLegalForm(normalized);

  // Build comparison key from the comparison-normalized form, then
  // strip legal-form tokens. The order of pattern application is
  // important: strip the longer "จำกัด (มหาชน)" / "public company
  // limited" variants BEFORE the shorter ones so partial residue
  // like a stray "limited" doesn't survive.
  let key = normalizeThaiTextForComparison(normalized);
  for (const pattern of COMPARISON_STRIP_PATTERNS) {
    key = key.replace(pattern, " ");
  }
  const comparisonKey = key.replace(/\s+/g, " ").trim();

  return { original, normalized, comparisonKey, detectedLegalForm };
}
