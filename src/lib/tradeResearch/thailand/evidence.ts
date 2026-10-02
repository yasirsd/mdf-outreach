/**
 * TH02 — Thailand evidence dimension contract (types only).
 *
 * The Thailand model reuses the shared T11 executor + T12
 * certification pipeline. This module defines the Thailand-side
 * evidence vocabulary and the hard rules that prevent market-level
 * flows from being promoted into company-level claims.
 *
 * NO IMPLEMENTATION HERE — this module is pure types, enums, and
 * explicit forbidden-promotion guards for downstream aggregation.
 */

export const THAILAND_EVIDENCE_CONTRACT_VERSION = "thailand-evidence-v1" as const;

export type ThaiCompanyIdentity = "verified" | "needs_review" | "unavailable";
export type ThaiImportExportRegistration = "registered" | "not_found" | "unavailable";
export type ThaiFoodImportLicense = "licensed" | "not_found" | "unavailable";
export type ThaiProductRelevance = "observed" | "not_observed" | "unknown";
export type ThaiMarketImportActivity = "observed" | "not_observed" | "unknown";
export type ThaiIndiaOriginMarketActivity = "observed" | "not_observed" | "unknown";
/**
 * Thailand V1 has no free company-level shipment source. This
 * dimension is STRUCTURALLY pinned to UNKNOWN. The type reflects
 * that invariant — adding a company-level shipment claim later
 * requires a schema change AND evidence of a genuine company-level
 * source, not an inference from any other dimension.
 */
export type ThaiCompanyShipmentActivity = "UNKNOWN";
export type ThaiContactAvailability =
  | "public_company_email"
  | "named_public_contact"
  | "unavailable";

export interface ThaiCoverage {
  readonly planned: readonly ThailandEvidenceDimensionKey[];
  readonly evaluated: readonly ThailandEvidenceDimensionKey[];
  readonly unavailable: readonly ThailandEvidenceDimensionKey[];
  readonly failed: readonly ThailandEvidenceDimensionKey[];
}

export type ThailandEvidenceDimensionKey =
  | "company_identity"
  | "import_export_registration"
  | "food_import_license"
  | "product_relevance"
  | "market_import_activity"
  | "india_origin_market_activity"
  | "company_shipment_activity"
  | "contact_availability";

export interface ThailandEvidence {
  readonly company_identity: ThaiCompanyIdentity;
  readonly import_export_registration: ThaiImportExportRegistration;
  readonly food_import_license: ThaiFoodImportLicense;
  readonly product_relevance: ThaiProductRelevance;
  readonly market_import_activity: ThaiMarketImportActivity;
  readonly india_origin_market_activity: ThaiIndiaOriginMarketActivity;
  readonly company_shipment_activity: ThaiCompanyShipmentActivity;
  readonly contact_availability: ThaiContactAvailability;
  readonly coverage: ThaiCoverage;
}

/** Factory for the Thailand V1 default evidence shape — everything UNKNOWN / unavailable. */
export function emptyThailandEvidence(): ThailandEvidence {
  return {
    company_identity: "unavailable",
    import_export_registration: "unavailable",
    food_import_license: "unavailable",
    product_relevance: "unknown",
    market_import_activity: "unknown",
    india_origin_market_activity: "unknown",
    company_shipment_activity: "UNKNOWN",
    contact_availability: "unavailable",
    coverage: { planned: [], evaluated: [], unavailable: [], failed: [] },
  };
}

/**
 * The Thailand evidence invariants. Each check returns true when the
 * invariant HOLDS (safe), false when a forbidden promotion would
 * occur. Aggregator code in TH05 MUST call these before accepting
 * an evidence transition.
 */
export const ThailandEvidenceInvariants = {
  /** Market-level India-origin activity NEVER promotes to a company-level India-origin claim. */
  marketIndiaOriginDoesNotPromoteCompany(
    marketIndiaOrigin: ThaiIndiaOriginMarketActivity,
    _companyShipment: ThaiCompanyShipmentActivity,
  ): boolean {
    // No matter what the market says, company-level shipment MUST be UNKNOWN in V1.
    return _companyShipment === "UNKNOWN";
  },

  /** `company_shipment_activity` is UNKNOWN in V1 under every input. */
  companyShipmentIsUnknown(evidence: ThailandEvidence): boolean {
    return evidence.company_shipment_activity === "UNKNOWN";
  },

  /** Website product mention never becomes a shipment claim. */
  websiteProductMentionDoesNotPromoteShipment(
    _productRelevance: ThaiProductRelevance,
    companyShipment: ThaiCompanyShipmentActivity,
  ): boolean {
    return companyShipment === "UNKNOWN";
  },

  /** DBD registration never becomes importer status. */
  dbdRegistrationDoesNotImplyImporter(
    _companyIdentity: ThaiCompanyIdentity,
    importExportRegistration: ThaiImportExportRegistration,
  ): boolean {
    // The dimensions are independent. Returning the current value
    // untouched is the invariant — this function only asserts the
    // caller did not promote.
    return (
      importExportRegistration === "registered"
      || importExportRegistration === "not_found"
      || importExportRegistration === "unavailable"
    );
  },

  /** Customs operator registration never becomes product-specific import evidence. */
  customsOperatorDoesNotImplyProduct(
    _importExportRegistration: ThaiImportExportRegistration,
    productRelevance: ThaiProductRelevance,
  ): boolean {
    return (
      productRelevance === "observed"
      || productRelevance === "not_observed"
      || productRelevance === "unknown"
    );
  },

  /** FDA food license never becomes India-origin evidence. */
  fdaLicenseDoesNotImplyIndiaOrigin(
    _foodLicense: ThaiFoodImportLicense,
    indiaOrigin: ThaiIndiaOriginMarketActivity,
  ): boolean {
    return (
      indiaOrigin === "observed"
      || indiaOrigin === "not_observed"
      || indiaOrigin === "unknown"
    );
  },

  /** Provider failure NEVER becomes negative company evidence. */
  providerFailureStaysNeutral(
    beforeOnDimension: string,
    afterOnDimension: string,
  ): boolean {
    // A failure must leave the dimension at UNKNOWN / unavailable —
    // never at a "negative" terminal value like `not_found` on a
    // dimension where `not_found` means "we actively looked".
    if (beforeOnDimension === "unknown" || beforeOnDimension === "unavailable" || beforeOnDimension === "UNKNOWN") {
      return afterOnDimension === "unknown"
        || afterOnDimension === "unavailable"
        || afterOnDimension === "UNKNOWN";
    }
    return true;
  },

  /** Missing manual evidence NEVER becomes negative company evidence. */
  missingManualEvidenceStaysUnavailable(
    before: ThaiImportExportRegistration | ThaiFoodImportLicense | ThaiCompanyIdentity,
    after: ThaiImportExportRegistration | ThaiFoodImportLicense | ThaiCompanyIdentity,
  ): boolean {
    if (before === "unavailable") {
      return after === "unavailable";
    }
    return true;
  },
} as const;
