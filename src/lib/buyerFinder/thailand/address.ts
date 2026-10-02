/**
 * TH03 — Minimal Thai address normalization + postal-code extraction.
 *
 * Explicitly NOT a geocoder. The helper preserves the original
 * address verbatim, provides a display-safe normalization, and
 * extracts the 5-digit postal code when it is present as a
 * standalone token. Province / district / sub-district strings are
 * preserved; the module never infers missing fields.
 */

import { normalizeThaiTextForDisplay } from "./text";

export interface ThaiAddressNormalization {
  readonly original: string;
  readonly normalized: string;
  readonly postalCode?: string;
}

/** Thailand postal codes are 5 digits; the first digit is 1–9. */
const THAI_POSTAL_CODE_PATTERN = /(?<![0-9])([1-9][0-9]{4})(?![0-9])/;

export function normalizeThaiAddress(input: unknown): ThaiAddressNormalization {
  const original = typeof input === "string" ? input : "";
  const normalized = normalizeThaiTextForDisplay(original);
  const match = THAI_POSTAL_CODE_PATTERN.exec(normalized);
  if (match) {
    return { original, normalized, postalCode: match[1] };
  }
  return { original, normalized };
}
