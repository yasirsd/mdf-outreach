/**
 * TH03 — Thailand phone-number normalization.
 *
 * Deterministic, free, no external validation API. The helper
 * normalizes a Thai phone number to E.164 (+66…) WHEN the input is
 * well-formed. It makes NO claim about whether the number is
 * active, assigned, or in service. It only sorts the common Thai
 * input variants into one canonical shape.
 *
 * Supported input shapes:
 *   +66 2 123 4567       → +6621234567
 *   +66-2-123-4567       → +6621234567
 *   0066 2 123 4567      → +6621234567
 *   0066-81-234-5678     → +66812345678
 *   02-123-4567          → +6621234567     (Bangkok landline)
 *   081-234-5678         → +66812345678    (mobile)
 *   091-234-5678         → +66912345678    (mobile)
 *   061-234-5678         → +66612345678    (mobile, newer prefix)
 *
 * Rules:
 *   - After stripping all separators, the national number MUST be
 *     either 9 digits (national part after dropping leading 0) or
 *     a +66-prefixed 11-digit international shape.
 *   - A leading 0 followed by 8 more digits is normalized by
 *     substituting +66 for the leading 0.
 *   - 0066-prefixed inputs are treated as +66.
 *   - Any input whose stripped digits don't fit one of these shapes
 *     yields `validFormat: false` with `normalizedE164: undefined`.
 *   - Extensions declared via common separators (`ext`, `x`, `#`)
 *     after the main number are extracted into `extension`.
 */

const SEPARATORS = /[\s\-\.()]+/g;
const EXTENSION_PATTERN = /\s*(?:ext\.?|x|#)\s*([0-9]{1,6})\s*$/i;

export interface ThaiPhoneNormalization {
  readonly original: string;
  readonly normalizedE164?: string;
  readonly nationalNumber?: string;
  readonly extension?: string;
  readonly validFormat: boolean;
}

export function normalizeThailandPhone(input: unknown): ThaiPhoneNormalization {
  if (typeof input !== "string" || !input.trim()) {
    return { original: typeof input === "string" ? input : "", validFormat: false };
  }
  const original = input;

  // Pull off a trailing extension if present (before stripping punctuation).
  let working = original;
  let extension: string | undefined;
  const extMatch = EXTENSION_PATTERN.exec(working);
  if (extMatch) {
    extension = extMatch[1];
    working = working.slice(0, extMatch.index);
  }

  // Normalize the main number.
  const noSeparators = working.replace(SEPARATORS, "");
  // Accept a leading +66, 0066, 066, or 0 and reduce to the national
  // part. Letters, Thai digits, or anything else → invalid.
  if (!/^[+0-9]+$/.test(noSeparators) || noSeparators.length === 0) {
    return { original, validFormat: false, extension };
  }

  let national: string;
  // TH04B Part 8 — `066…` is intentionally NOT treated as an
  // international alias. It is indistinguishable from a national
  // number beginning `0` followed by `66`. The accepted canonical
  // forms are `+66…`, `0066…`, and national `0X…`. Anything else is
  // reported `validFormat: false` without fabrication.
  if (noSeparators.startsWith("+66")) {
    national = noSeparators.slice(3);
  } else if (noSeparators.startsWith("0066")) {
    national = noSeparators.slice(4);
  } else if (noSeparators.startsWith("0")) {
    national = noSeparators.slice(1);
  } else {
    // No recognizable Thai prefix.
    return { original, validFormat: false, extension };
  }

  // National number MUST be 8 or 9 digits (Bangkok landlines + modern
  // mobile prefixes). Anything shorter / longer is not a Thai phone.
  if (!/^[0-9]{8,9}$/.test(national)) {
    return { original, validFormat: false, extension };
  }
  // TH04B Part 8 — ambiguous `066…` guard. After stripping a leading
  // 0, a Thai area code never starts with "66" (and there is no
  // Thai mobile prefix 66X). A national number beginning `066` on
  // input is therefore not a valid Thai phone: it either is a
  // misformatted `+66…` or a bogus number. Reject rather than
  // normalize to `+66 66…`.
  if (national.startsWith("66")) {
    return { original, validFormat: false, extension };
  }

  return {
    original,
    normalizedE164: `+66${national}`,
    nationalNumber: national,
    extension,
    validFormat: true,
  };
}
