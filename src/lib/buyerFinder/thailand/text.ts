/**
 * TH03 — Thai text / Unicode normalization helpers.
 *
 * Pure functions. No I/O, no external deps, no side effects. Thai
 * script is preserved: NFC composition only, no transliteration, no
 * combining-mark stripping, no character substitution beyond
 * conservative invisible-character cleanup.
 *
 * Two helpers are offered:
 *
 *   • normalizeThaiTextForDisplay — safe for persisting / rendering.
 *     Preserves every semantic character; only cleans up invisible /
 *     redundant whitespace so repeated storage of equivalent input
 *     yields a stable string.
 *
 *   • normalizeThaiTextForComparison — safe for equality / matching.
 *     Lowercases Latin characters (Thai has no case), additionally
 *     collapses whitespace, strips a conservative legal-punctuation
 *     set. Thai semantic characters are untouched.
 *
 * Both are additive to the existing BuyerFinder helpers. They do NOT
 * replace any generic US/CA normalizer.
 */

/** Zero-width characters stripped by the comparison and display normalizers. */
const ZERO_WIDTH_PATTERN = /[​‌‍﻿]/g;

/** Non-breaking spaces (and other Unicode spaces) → single ASCII space. */
const UNICODE_SPACE_PATTERN = /[   -   　]/g;

/** Collapse any run of ASCII whitespace to a single space. */
const ASCII_WS_RUN_PATTERN = /[ \t\r\n\f\v]+/g;

/**
 * Display-preserving normalization.
 *
 * Guarantees:
 *   - NFC Unicode composition.
 *   - Preserves Thai script characters including combining marks.
 *   - Does NOT transliterate.
 *   - Collapses ASCII whitespace runs to a single space.
 *   - Converts non-breaking spaces to a single ASCII space.
 *   - Strips zero-width joiners / non-joiners / BOM.
 *   - Trims leading / trailing whitespace.
 *   - Leaves punctuation and letter case untouched.
 */
export function normalizeThaiTextForDisplay(input: unknown): string {
  if (typeof input !== "string") return "";
  const nfc = input.normalize("NFC");
  const noZeroWidth = nfc.replace(ZERO_WIDTH_PATTERN, "");
  const asciiSpaces = noZeroWidth.replace(UNICODE_SPACE_PATTERN, " ");
  const collapsed = asciiSpaces.replace(ASCII_WS_RUN_PATTERN, " ");
  return collapsed.trim();
}

/**
 * Comparison-only normalization.
 *
 * In addition to the display-preserving guarantees, this:
 *   - lowercases Latin characters (Thai is unaffected — it has no case).
 *   - strips a conservative, well-known set of legal-ish punctuation
 *     (`.`, `,`, `;`, `:`, `(`, `)`, `[`, `]`, double / single quotes,
 *     en/em dashes). Thai punctuation (ฯ, ๆ) is NOT stripped.
 *   - collapses whitespace that may now surround removed punctuation.
 *
 * The returned string is suitable ONLY for comparison / indexing. Do
 * NOT persist it as the user-visible value.
 */
export function normalizeThaiTextForComparison(input: unknown): string {
  const display = normalizeThaiTextForDisplay(input);
  if (!display) return "";
  const lower = display.toLowerCase();
  const stripped = lower.replace(/[.,;:()[\]"'“”‘’–—]/g, " ");
  return stripped.replace(ASCII_WS_RUN_PATTERN, " ").trim();
}
