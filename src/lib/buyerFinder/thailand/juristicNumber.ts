/**
 * TH03 — Thailand juristic registration number validation (format only).
 *
 * Thai juristic persons are issued a 13-digit registration number by
 * the Department of Business Development (DBD). The same 13-digit
 * identifier doubles as the tax identifier for juristic persons.
 *
 * CHECKSUM NOTE
 *
 * A mod-11 weighted checksum algorithm is used for the Thai NATIONAL
 * ID (บัตรประชาชน). Reusing the exact same algorithm for juristic
 * numbers is a reasonable hypothesis, but TH01's audit did NOT
 * include a verified authoritative source for the juristic-specific
 * checksum formula. Per TH03's conservative stance, this module
 * implements **format validation only** — length, digit-only
 * composition — and returns `checksumVerified: false` /
 * `checksumValid: null` so downstream callers do not conflate
 * "well-formed" with "DBD-attested". Checksum validation is marked
 * TODO; TH04D will land it only once the authoritative algorithm is
 * verified against the DBD specification.
 */

export interface ThaiJuristicNumberValidation {
  /** Canonical 13-digit string, or null when the input cannot be normalized. */
  readonly normalized: string | null;
  /** True iff the normalized form is exactly 13 ASCII digits. */
  readonly validFormat: boolean;
  /**
   * TH03 does NOT verify the checksum. This field is always `false`
   * — downstream callers MUST treat `null` as "checksum state unknown".
   */
  readonly checksumVerified: boolean;
  /**
   * Null in TH03 because `checksumVerified` is false. When TH04D
   * ships the authoritative checksum, this will become
   * `true`/`false`.
   */
  readonly checksumValid: boolean | null;
}

const SEPARATOR_PATTERN = /[\s\-‐‑‒–—.()]/g;
const DIGITS_13_PATTERN = /^[0-9]{13}$/;

/**
 * Returns the canonical 13-digit string, or `null` when the input is
 * not a well-formed juristic number. Accepts common separators
 * (spaces, hyphens, dots, parentheses) between digits but refuses
 * any non-digit after separator removal — e.g. letters immediately
 * cause rejection.
 */
export function normalizeThaiJuristicNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const stripped = input.replace(SEPARATOR_PATTERN, "");
  if (!DIGITS_13_PATTERN.test(stripped)) return null;
  return stripped;
}

/**
 * Full validation record. The `checksumVerified` flag is always
 * false in TH03 — downstream flows interpret `checksumValid: null`
 * as "unknown", NOT as "valid" and NOT as "invalid".
 */
export function validateThaiJuristicNumber(input: unknown): ThaiJuristicNumberValidation {
  const normalized = normalizeThaiJuristicNumber(input);
  if (normalized === null) {
    return {
      normalized: null,
      validFormat: false,
      checksumVerified: false,
      checksumValid: null,
    };
  }
  return {
    normalized,
    validFormat: true,
    checksumVerified: false,
    checksumValid: null,
  };
}
