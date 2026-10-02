/**
 * TH02 — Thailand HS/AHTN mapping abstraction (contract only).
 *
 * The Thai Customs statistics UI accepts tariff queries at multiple
 * digit widths (2 / 4 / 8 / 11) but does NOT accept 6-digit queries
 * directly. Internal reasoning stays at the 6-digit semantic HS
 * level; the actual Thai query codes used against the live portal
 * are fixture/config driven and MUST be verified against the Thai
 * Customs portal before TH04A ships.
 *
 * TH02 ships the semantic HS and leaves `thaiQueryCodes` empty by
 * default. TH04A will populate them from a reviewed snapshot of the
 * Thai statistical code book.
 *
 * The mapping is INTENTIONALLY product-configurable — Thailand V1
 * primary is `guntur-dry-red-chilli` (whole, dried), but the shape
 * supports future products (powdered chilli, dried fruit, etc.)
 * without a schema change.
 */

export const THAILAND_HS_MAPPING_VERSION = "thailand-hs-mapping-v1" as const;

/** HS6 code (6-digit, no separators). */
export type SemanticHs6 = `${number}` | string;

export interface ThailandHsMapping {
  /** Canonical MDF business product id (e.g. "guntur-dry-red-chilli"). */
  readonly productId: string;
  /** Optional product form (e.g. "whole", "ground"); null means product-level mapping. */
  readonly productForm: string | null;
  /** HS6 code the business reasons about (e.g. "090421" for whole dried chilli). */
  readonly semanticHs6: SemanticHs6;
  /**
   * Thai Customs statistical query codes — zero-or-more 8-digit or
   * 11-digit entries. EMPTY until TH04A verifies the current code
   * book. The TH executor MUST refuse to run with an empty list;
   * refusal surfaces as `unavailable` coverage, never fabricated.
   */
  readonly thaiQueryCodes: readonly string[];
  /** Short rationale for the mapping (audit note). */
  readonly rationale: string;
}

/**
 * V1 default mappings. Only the SEMANTIC HS is locked. Thai 8/11-digit
 * query codes are intentionally empty and MUST be filled in TH04A
 * from a reviewed snapshot of the current Thai Customs statistical
 * code book. Hard-coding `09042110` / `09042190` without that
 * verification is explicitly disallowed by TH01.
 */
export const THAILAND_HS_MAPPINGS: readonly ThailandHsMapping[] = [
  {
    productId: "guntur-dry-red-chilli",
    productForm: null,
    semanticHs6: "090421",
    // TH04A verified: the Thai Customs Data Catalog dataset
    // ctm_06_11 reports whole dried Capsicum under 8-digit tariff
    // `09042110` ("Chillies — fruits of genus Capsicum"). This V1
    // mapping intentionally does NOT activate `09042190` ("Other");
    // TH04A executor filters strictly on `09042110`.
    //
    // Provenance:
    //   source: Thai Customs Department tariff schedule (HS 2017+)
    //           reflected in the public Customs Data Catalog
    //           dataset ctm_06_11 "Imports by country of origin".
    //   reviewed: 2026-10-01 (verified in TH04A-V from live
    //             statistic_report.php HS-code input accepting 8-digit
    //             queries and the pre-verified authoritative tariff
    //             facts supplied in the TH04A brief).
    //   mapping version: thailand-hs-mapping-v1.
    //
    // 11-digit statistical suffixes are NOT required for V1 — the
    // ctm_06_11 dataset already carries the statistical-code column
    // on each row, so the executor preserves whatever suffixes the
    // official data emits rather than guessing them.
    thaiQueryCodes: ["09042110"],
    rationale:
      "HS 09.04 — pepper of the genus Piper; dried fruits of the genus Capsicum or of the "
      + "genus Pimenta. Subheading 0904.21: Capsicum / Pimenta dried, neither crushed nor "
      + "ground. Thai 8-digit tariff code 09042110 (Chillies / Capsicum). The Thai Customs "
      + "Data Catalog dataset ctm_06_11 reports rows for this code with their own "
      + "statistical-code suffixes; TH04A preserves whichever suffixes the official data "
      + "emits (no guessed codes).",
  },
  // Future product forms (powder/crushed) resolve to HS6 "090422" and
  // can be enabled here when the product form warrants it; contract
  // only — not activated in TH02.
] as const;

/**
 * Pure lookup — never throws. Returns undefined when no mapping is
 * defined for the product. Callers decide what to do (TH04A refuses
 * to execute `thai-customs-stats` without a mapping and surfaces
 * coverage as `unavailable`).
 */
export function findThailandHsMapping(
  productId: string,
  productForm: string | null,
): ThailandHsMapping | undefined {
  return THAILAND_HS_MAPPINGS.find((m) =>
    m.productId === productId && (m.productForm ?? null) === (productForm ?? null),
  );
}
