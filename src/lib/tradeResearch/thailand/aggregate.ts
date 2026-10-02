/**
 * TH05 — Thailand conservative aggregator.
 *
 * Produces ONE Thailand aggregate result from:
 *
 *   AUTOMATED
 *     • thai-customs-stats   (MARKET-LEVEL trade statistics)
 *     • public-website       (COMPANY_SITE signals, v2)
 *
 *   MANUAL
 *     • thai-dbd              (COMPANY_IDENTITY, append-only)
 *     • thai-customs-operator (REGISTERED_IMPORT_EXPORT_OPERATOR)
 *     • thai-fda-importer     (LICENSED_FOOD_IMPORTER)
 *
 * Semantic rules (all forbidden promotions enforced by TH02's
 * `ThailandEvidenceInvariants` + explicit guards here):
 *
 *   • `company_shipment_activity` is ALWAYS `"UNKNOWN"`.
 *   • Market-level evidence (Customs stats) NEVER becomes a
 *     company-level claim.
 *   • Website evidence NEVER promotes `company_identity` to
 *     `verified`; it may only support `needs_review`.
 *   • Website / Customs stats / DBD / FDA NEVER establish
 *     `import_export_registration` — only the Customs operator
 *     manual record does.
 *   • Website / stats / DBD / Customs operator NEVER establish
 *     `food_import_license` — only the FDA manual record does.
 *   • Provider failure NEVER becomes negative evidence. Missing
 *     manual evidence is `unavailable` (or `manual_pending` on
 *     coverage), never `not_found`.
 *   • Conflicts are surfaced explicitly in `conflicts[]`; no
 *     silent resolution.
 *   • Buyer conversion rules unchanged: `contact_availability` is
 *     only `public_company_email` when the public website provider
 *     observed an eligible public email. Phone-only is not an
 *     email.
 *
 * Pure function. No I/O. Consumers (TH06 UI + any read model)
 * are responsible for calling the certified provider results and
 * active manual evidence into this function.
 */

import type { ThailandEvidence } from "./evidence";
import { ThailandEvidenceInvariants } from "./evidence";
import type { ThailandManualEvidenceReadResult, ThailandManualEvidenceActiveRow } from "./manualEvidenceResolver";
import type { ThaiCompanyMatchLevel } from "@/lib/buyerFinder/thailand/companyIdentity";
import { compareThaiCompanyIdentity } from "@/lib/buyerFinder/thailand/companyIdentity";
import type { ThailandManualEvidencePayload } from "./manualEvidence";
import type { ThaiManualEvidenceLookupBasis } from "../repository";

export const THAILAND_AGGREGATE_CONTRACT_VERSION = "thailand-aggregate-v1" as const;

export interface ThailandAggregateProviderSummary {
  readonly providerId: "thai-customs-stats" | "public-website";
  readonly status: "completed" | "no_match" | "cached" | "failed_retryable" | "failed_terminal" | "unsupported" | "not_evaluated";
  readonly datasetVersion: string | null;
  readonly parserVersion: string | null;
  readonly interpretationVersion: string | null;
  readonly sourcePeriod: string | null;
  readonly retrievedAt: string | null;
  /** Short human-readable explanation (first ~400 chars of the executor's observation text). */
  readonly observation: string | null;
}

export interface ThailandAggregateDimensionProvenance {
  readonly providerId: string;
  readonly sourceUrl: string | null;
  readonly grain: "company_record" | "company_product" | "company_site" | "market_product" | "market_product_origin" | "operator_record" | "licence_record" | "not_available";
  readonly capturedAt: string | null;
  readonly parserVersion?: string | null;
  readonly interpretationVersion?: string | null;
  readonly manualEvidenceId?: string;
  readonly explanation: string;
}

export interface ThailandAggregateDimension<V> {
  readonly value: V;
  readonly provenance: readonly ThailandAggregateDimensionProvenance[];
}

export type ThailandAggregateConflict =
  | { readonly kind: "duplicate_active_manual"; readonly providerId: string; readonly rowIds: readonly string[] }
  | { readonly kind: "identity_mismatch"; readonly description: string }
  | { readonly kind: "fda_other_juristic"; readonly description: string }
  | { readonly kind: "website_contradicts_manual"; readonly description: string };

export interface ThailandAggregateCoverage {
  readonly planned: readonly string[];
  readonly evaluated: readonly string[];
  readonly unavailable: readonly string[];
  readonly failed: readonly string[];
  readonly manualPending: readonly string[];
}

export interface ThailandAggregateResult {
  readonly contractVersion: typeof THAILAND_AGGREGATE_CONTRACT_VERSION;
  readonly companyIdentity: ThailandAggregateDimension<ThailandEvidence["company_identity"]>;
  readonly importExportRegistration: ThailandAggregateDimension<ThailandEvidence["import_export_registration"]>;
  readonly foodImportLicense: ThailandAggregateDimension<ThailandEvidence["food_import_license"]>;
  readonly productRelevance: {
    readonly companyLevel: ThailandAggregateDimension<ThailandEvidence["product_relevance"]>;
    readonly marketLevel: ThailandAggregateDimension<ThailandEvidence["product_relevance"]>;
  };
  readonly marketImportActivity: ThailandAggregateDimension<ThailandEvidence["market_import_activity"]>;
  readonly indiaOriginMarketActivity: ThailandAggregateDimension<ThailandEvidence["india_origin_market_activity"]>;
  readonly companyShipmentActivity: ThailandAggregateDimension<ThailandEvidence["company_shipment_activity"]>;
  readonly contactAvailability: ThailandAggregateDimension<ThailandEvidence["contact_availability"]>;
  readonly coverage: ThailandAggregateCoverage;
  readonly providerSummaries: readonly ThailandAggregateProviderSummary[];
  readonly conflicts: readonly ThailandAggregateConflict[];
  readonly overallState: "evidence_complete" | "evidence_partial" | "needs_review" | "no_evidence";
  readonly limitations: readonly string[];
}

export interface ThailandCandidateIdentityInput {
  readonly juristicRegistrationNumber?: string | null;
  readonly thaiLegalName?: string | null;
  readonly englishLegalName?: string | null;
  readonly domain?: string | null;
  readonly address?: string | null;
}

export interface ThailandAggregateInput {
  readonly thaiCustomsStats?: {
    readonly status: ThailandAggregateProviderSummary["status"];
    readonly datasetVersion?: string | null;
    readonly sourcePeriod?: string | null;
    readonly retrievedAt?: string | null;
    readonly observation?: string;
    readonly marketImportActivity: "observed" | "not_observed" | "unknown";
    readonly indiaOriginMarketActivity: "observed" | "not_observed" | "unknown";
    readonly productRelevance: "observed" | "not_observed" | "unknown";
    readonly sourceUrl?: string;
  };
  readonly publicWebsite?: {
    readonly status: ThailandAggregateProviderSummary["status"];
    readonly datasetVersion?: string | null;
    readonly sourcePeriod?: string | null;
    readonly retrievedAt?: string | null;
    readonly observation?: string;
    readonly productSignalsObserved: boolean;
    readonly identityMatchLevel: ThaiCompanyMatchLevel | null;
    readonly observedPublicEmails: readonly string[];
    readonly observedPublicPhones: readonly string[];
    readonly parserVersion?: string;
    readonly interpretationVersion?: string;
    readonly sourceUrl?: string;
    /** Website-displayed Thai or English legal name differs materially from DBD. */
    readonly contradictsManualIdentity?: boolean;
  };
  readonly manual: ThailandManualEvidenceReadResult;
  /**
   * TH06 Step 0C — Candidate identity used to derive per-provider
   * identity-match correlation at aggregation time. The arbitrary
   * `manualIdentityStrong: boolean` was removed in favor of real
   * payload-vs-candidate comparison via
   * `compareThaiCompanyIdentity`.
   */
  readonly candidateIdentity?: ThailandCandidateIdentityInput;
}

interface PayloadView {
  readonly juristicRegistrationNumber: string | null;
  readonly thaiLegalName: string | null;
  readonly englishLegalName: string | null;
  readonly domain: string | null;
  readonly address: string | null;
}

function readPayloadAsIdentity(providerId: string, payload: unknown): PayloadView {
  const p = (payload ?? {}) as Record<string, unknown>;
  // All three MANUAL_ONLY payloads carry juristic / legal name /
  // address snapshots directly or via provider-specific keys.
  const juristic = typeof p.juristicRegistrationNumber === "string" ? p.juristicRegistrationNumber : null;
  if (providerId === "thai-dbd") {
    const legal = typeof p.legalNameSnapshot === "string" ? p.legalNameSnapshot : null;
    const addr = typeof p.registeredAddressSnapshot === "string" ? p.registeredAddressSnapshot : null;
    const looksThai = legal ? /[฀-๿]/.test(legal) : false;
    return {
      juristicRegistrationNumber: juristic,
      thaiLegalName: looksThai ? legal : null,
      englishLegalName: looksThai ? null : legal,
      domain: null,
      address: addr,
    };
  }
  if (providerId === "thai-customs-operator") {
    return {
      juristicRegistrationNumber: juristic,
      thaiLegalName: null,
      englishLegalName: typeof p.operatorIdSnapshot === "string" ? p.operatorIdSnapshot : null,
      domain: null,
      address: null,
    };
  }
  if (providerId === "thai-fda-importer") {
    return {
      juristicRegistrationNumber: juristic,
      thaiLegalName: null,
      englishLegalName: typeof p.licenseeNameSnapshot === "string" ? p.licenseeNameSnapshot : null,
      domain: null,
      address: typeof p.licenseeAddressSnapshot === "string" ? p.licenseeAddressSnapshot : null,
    };
  }
  return { juristicRegistrationNumber: null, thaiLegalName: null, englishLegalName: null, domain: null, address: null };
}

function derivePerProviderMatch(
  providerId: string,
  payload: unknown,
  candidate: ThailandCandidateIdentityInput | undefined,
): ThaiCompanyMatchLevel {
  if (!candidate) return "no_match";
  const source = readPayloadAsIdentity(providerId, payload);
  const result = compareThaiCompanyIdentity(source, candidate);
  return result.matchLevel;
}

function readLookupBasis(row: ThailandManualEvidenceActiveRow): ThaiManualEvidenceLookupBasis | null {
  const r = row as unknown as { lookup_basis?: unknown };
  return typeof r.lookup_basis === "string" ? (r.lookup_basis as ThaiManualEvidenceLookupBasis) : null;
}

function isAuthoritativeIdentifierLookup(providerId: string, basis: ThaiManualEvidenceLookupBasis | null): boolean {
  // Juristic number is authoritative for all three.
  if (basis === "juristic_number") return true;
  // License number is authoritative ONLY for FDA.
  if (basis === "license_number" && providerId === "thai-fda-importer") return true;
  return false;
}

const DIMENSION_KEYS = [
  "company_identity",
  "import_export_registration",
  "food_import_license",
  "product_relevance",
  "market_import_activity",
  "india_origin_market_activity",
  "company_shipment_activity",
  "contact_availability",
] as const;

const UNAVAILABLE_IDENTITY: ThailandAggregateDimension<"unavailable"> = {
  value: "unavailable",
  provenance: [],
};

function prov(input: Partial<ThailandAggregateDimensionProvenance> & { explanation: string; grain: ThailandAggregateDimensionProvenance["grain"] }): ThailandAggregateDimensionProvenance {
  return {
    providerId: input.providerId ?? "",
    sourceUrl: input.sourceUrl ?? null,
    grain: input.grain,
    capturedAt: input.capturedAt ?? null,
    parserVersion: input.parserVersion,
    interpretationVersion: input.interpretationVersion,
    manualEvidenceId: input.manualEvidenceId,
    explanation: input.explanation,
  };
}

function fromManual(row: ThailandManualEvidenceActiveRow, grain: ThailandAggregateDimensionProvenance["grain"], explanation: string): ThailandAggregateDimensionProvenance {
  return prov({
    providerId: row.provider_id,
    sourceUrl: row.source_url,
    grain,
    capturedAt: row.captured_at,
    manualEvidenceId: row.id,
    explanation,
  });
}

export function aggregateThailandResearch(input: ThailandAggregateInput): ThailandAggregateResult {
  const conflicts: ThailandAggregateConflict[] = [];
  const limitations: string[] = [];

  // Thread conflicts from the manual resolver (duplicate active).
  for (const c of input.manual.conflicts) {
    conflicts.push({ kind: "duplicate_active_manual", providerId: c.providerId, rowIds: c.rowIds });
  }

  const dbd = input.manual.dbd;
  const customsOperator = input.manual.customsOperator;
  const fdaImporter = input.manual.fdaImporter;

  // Per-provider identity match derived from PAYLOAD + candidate.
  const dbdMatch = dbd ? derivePerProviderMatch("thai-dbd", dbd.evidence_payload, input.candidateIdentity) : "no_match";
  const operatorMatch = customsOperator ? derivePerProviderMatch("thai-customs-operator", customsOperator.evidence_payload, input.candidateIdentity) : "no_match";
  const fdaMatch = fdaImporter ? derivePerProviderMatch("thai-fda-importer", fdaImporter.evidence_payload, input.candidateIdentity) : "no_match";
  const dbdBasis = dbd ? readLookupBasis(dbd) : null;
  const operatorBasis = customsOperator ? readLookupBasis(customsOperator) : null;
  const fdaBasis = fdaImporter ? readLookupBasis(fdaImporter) : null;
  const dbdStrong = dbdMatch === "exact" || dbdMatch === "strong";
  const operatorStrong = operatorMatch === "exact" || operatorMatch === "strong";
  const fdaStrong = fdaMatch === "exact" || fdaMatch === "strong";

  // ---------- Dimension 1: company_identity ----------
  let companyIdentity: ThailandAggregateDimension<ThailandEvidence["company_identity"]> = UNAVAILABLE_IDENTITY;
  if (dbd) {
    if (dbd.evidence_status === "verified" && dbdStrong) {
      companyIdentity = {
        value: "verified",
        provenance: [fromManual(dbd, "company_record", `DBD verified; identity correlation ${dbdMatch} via ${dbdBasis ?? "payload fields"}.`)],
      };
    } else if (dbd.evidence_status === "verified") {
      companyIdentity = {
        value: "needs_review",
        provenance: [fromManual(dbd, "company_record", `DBD verified; identity correlation ${dbdMatch} is weak/ambiguous. Cannot promote to verified without exact/strong match.`)],
      };
    } else if (dbd.evidence_status === "inconclusive") {
      companyIdentity = {
        value: "needs_review",
        provenance: [fromManual(dbd, "company_record", "DBD manual evidence inconclusive.")],
      };
    } else if (dbd.evidence_status === "not_found") {
      // Authoritative not_found requires BOTH strong identity AND an
      // authoritative-identifier lookup basis (TH06 Step 0D). A
      // historical row with no lookup_basis stays conservative.
      const authoritative = dbdStrong && isAuthoritativeIdentifierLookup("thai-dbd", dbdBasis);
      companyIdentity = authoritative
        ? { value: "needs_review", provenance: [fromManual(dbd, "company_record", `DBD not_found on authoritative identifier search (${dbdBasis}); company existence requires operator judgement.`)] }
        : { value: "unavailable", provenance: [fromManual(dbd, "company_record", `DBD not_found by ${dbdBasis ?? "unspecified"} search; cannot infer non-existence without an authoritative identifier lookup.`)] };
    }
  }
  // Website can only SUPPORT identity via needs_review — never promote to verified.
  if (companyIdentity.value !== "verified" && input.publicWebsite?.identityMatchLevel) {
    const lvl = input.publicWebsite.identityMatchLevel;
    if (lvl === "strong" || lvl === "exact") {
      companyIdentity = {
        value: companyIdentity.value === "unavailable" ? "needs_review" : companyIdentity.value,
        provenance: [
          ...companyIdentity.provenance,
          prov({
            providerId: "public-website",
            sourceUrl: input.publicWebsite.sourceUrl ?? null,
            grain: "company_site",
            parserVersion: input.publicWebsite.parserVersion,
            interpretationVersion: input.publicWebsite.interpretationVersion,
            capturedAt: input.publicWebsite.retrievedAt ?? null,
            explanation: `Website identity signal (${lvl}) supports review but can never promote to verified without strong manual DBD evidence.`,
          }),
        ],
      };
    }
  }
  // Website vs manual contradiction surfaced explicitly.
  if (input.publicWebsite?.contradictsManualIdentity && dbd?.evidence_status === "verified") {
    conflicts.push({ kind: "website_contradicts_manual", description: "Website-displayed name differs from DBD-authoritative legal name." });
    limitations.push("Website name differs from DBD authoritative name; retained for operator review.");
  }

  // ---------- Dimension 2: import_export_registration ----------
  let importExportRegistration: ThailandAggregateDimension<ThailandEvidence["import_export_registration"]> = {
    value: "unavailable",
    provenance: [],
  };
  if (customsOperator) {
    if (customsOperator.evidence_status === "verified" && operatorStrong) {
      importExportRegistration = {
        value: "registered",
        provenance: [fromManual(customsOperator, "operator_record", `Customs operator verified; identity correlation ${operatorMatch}.`)],
      };
    } else if (customsOperator.evidence_status === "not_found" && operatorStrong
      && isAuthoritativeIdentifierLookup("thai-customs-operator", operatorBasis)) {
      importExportRegistration = {
        value: "not_found",
        provenance: [fromManual(customsOperator, "operator_record", `Customs operator not_found on authoritative identifier search (${operatorBasis}) with strong identity.`)],
      };
    } else {
      importExportRegistration = {
        value: "unavailable",
        provenance: [fromManual(customsOperator, "operator_record", `Customs operator evidence present (${customsOperator.evidence_status}, identity ${operatorMatch}, basis ${operatorBasis ?? "unspecified"}); conservatively unavailable.`)],
      };
    }
  }

  // ---------- Dimension 3: food_import_license ----------
  let foodImportLicense: ThailandAggregateDimension<ThailandEvidence["food_import_license"]> = {
    value: "unavailable",
    provenance: [],
  };
  if (fdaImporter) {
    if (fdaImporter.evidence_status === "verified" && fdaStrong) {
      foodImportLicense = {
        value: "licensed",
        provenance: [fromManual(fdaImporter, "licence_record", `FDA licence verified; identity correlation ${fdaMatch}.`)],
      };
    } else if (fdaImporter.evidence_status === "not_found" && fdaStrong
      && isAuthoritativeIdentifierLookup("thai-fda-importer", fdaBasis)) {
      foodImportLicense = {
        value: "not_found",
        provenance: [fromManual(fdaImporter, "licence_record", `FDA licence not_found on authoritative identifier search (${fdaBasis}) with strong identity.`)],
      };
    } else {
      foodImportLicense = {
        value: "unavailable",
        provenance: [fromManual(fdaImporter, "licence_record", `FDA evidence present (${fdaImporter.evidence_status}, identity ${fdaMatch}, basis ${fdaBasis ?? "unspecified"}); conservatively unavailable.`)],
      };
    }
  }

  // ---------- Dimension 4: product_relevance (grain-separated) ----------
  const companyProduct: ThailandAggregateDimension<"observed" | "not_observed" | "unknown"> = (() => {
    if (!input.publicWebsite) return { value: "unknown", provenance: [] };
    if (input.publicWebsite.status === "failed_retryable" || input.publicWebsite.status === "failed_terminal") {
      return { value: "unknown", provenance: [] };
    }
    if (input.publicWebsite.productSignalsObserved) {
      return {
        value: "observed",
        provenance: [prov({
          providerId: "public-website",
          sourceUrl: input.publicWebsite.sourceUrl ?? null,
          grain: "company_site",
          parserVersion: input.publicWebsite.parserVersion,
          interpretationVersion: input.publicWebsite.interpretationVersion,
          capturedAt: input.publicWebsite.retrievedAt ?? null,
          explanation: "Website displays product-signal keywords (COMPANY_SITE grain). Does NOT imply shipment / India origin / regulatory registration.",
        })],
      };
    }
    return {
      value: "not_observed",
      provenance: [prov({
        providerId: "public-website",
        sourceUrl: input.publicWebsite.sourceUrl ?? null,
        grain: "company_site",
        capturedAt: input.publicWebsite.retrievedAt ?? null,
        explanation: "No product-signal keywords on the fetched page(s). Thai-language coverage may be incomplete; NOT a company-level negative.",
      })],
    };
  })();
  const marketProduct: ThailandAggregateDimension<"observed" | "not_observed" | "unknown"> = (() => {
    if (!input.thaiCustomsStats) return { value: "unknown", provenance: [] };
    if (input.thaiCustomsStats.status === "failed_retryable" || input.thaiCustomsStats.status === "failed_terminal") {
      return { value: "unknown", provenance: [] };
    }
    return {
      value: input.thaiCustomsStats.productRelevance,
      provenance: [prov({
        providerId: "thai-customs-stats",
        sourceUrl: input.thaiCustomsStats.sourceUrl ?? null,
        grain: "market_product",
        parserVersion: "thai-customs-stats-csv-v1",
        interpretationVersion: "thai-customs-stats-csv-v1:t08-v1",
        capturedAt: input.thaiCustomsStats.retrievedAt ?? null,
        explanation: `Thai Customs ctm_06_11 (${input.thaiCustomsStats.sourcePeriod ?? "latest"}) at HS8 09042110 (MARKET grain).`,
      })],
    };
  })();

  // ---------- Dimension 5: market_import_activity ----------
  const marketImportActivity: ThailandAggregateDimension<ThailandEvidence["market_import_activity"]> = (() => {
    if (!input.thaiCustomsStats) return { value: "unknown", provenance: [] };
    if (input.thaiCustomsStats.status === "failed_retryable" || input.thaiCustomsStats.status === "failed_terminal") {
      return { value: "unknown", provenance: [prov({ providerId: "thai-customs-stats", grain: "market_product", explanation: "Thai Customs provider failure; market dimension unknown (never not_observed on failure)." })] };
    }
    return {
      value: input.thaiCustomsStats.marketImportActivity,
      provenance: [prov({
        providerId: "thai-customs-stats",
        sourceUrl: input.thaiCustomsStats.sourceUrl ?? null,
        grain: "market_product",
        capturedAt: input.thaiCustomsStats.retrievedAt ?? null,
        parserVersion: "thai-customs-stats-csv-v1",
        interpretationVersion: "thai-customs-stats-csv-v1:t08-v1",
        explanation: "Market-level Thailand import activity at HS8 09042110.",
      })],
    };
  })();

  // ---------- Dimension 6: india_origin_market_activity ----------
  const indiaOriginMarketActivity: ThailandAggregateDimension<ThailandEvidence["india_origin_market_activity"]> = (() => {
    if (!input.thaiCustomsStats) return { value: "unknown", provenance: [] };
    if (input.thaiCustomsStats.status === "failed_retryable" || input.thaiCustomsStats.status === "failed_terminal") {
      return { value: "unknown", provenance: [] };
    }
    return {
      value: input.thaiCustomsStats.indiaOriginMarketActivity,
      provenance: [prov({
        providerId: "thai-customs-stats",
        sourceUrl: input.thaiCustomsStats.sourceUrl ?? null,
        grain: "market_product_origin",
        capturedAt: input.thaiCustomsStats.retrievedAt ?? null,
        parserVersion: "thai-customs-stats-csv-v1",
        interpretationVersion: "thai-customs-stats-csv-v1:t08-v1",
        explanation: "Market-level India-origin flow at HS8 09042110. Never a candidate-level India-origin claim.",
      })],
    };
  })();

  // ---------- Dimension 7: company_shipment_activity (always UNKNOWN) ----------
  const companyShipmentActivity: ThailandAggregateDimension<"UNKNOWN"> = {
    value: "UNKNOWN",
    provenance: [prov({
      providerId: "",
      grain: "not_available",
      explanation: "Thailand V1 has NO free company-level shipment provider; this dimension is structurally UNKNOWN.",
    })],
  };
  // Invariant check — the aggregator can never emit anything else.
  if (!ThailandEvidenceInvariants.companyShipmentIsUnknown({
    company_identity: companyIdentity.value,
    import_export_registration: importExportRegistration.value,
    food_import_license: foodImportLicense.value,
    product_relevance: companyProduct.value,
    market_import_activity: marketImportActivity.value,
    india_origin_market_activity: indiaOriginMarketActivity.value,
    company_shipment_activity: companyShipmentActivity.value,
    contact_availability: "unavailable",
    coverage: { planned: [], evaluated: [], unavailable: [], failed: [] },
  })) {
    throw new Error("THAILAND_AGGREGATE_INVARIANT_VIOLATION_COMPANY_SHIPMENT");
  }

  // ---------- Dimension 8: contact_availability ----------
  const contactAvailability: ThailandAggregateDimension<ThailandEvidence["contact_availability"]> = (() => {
    if (!input.publicWebsite) return { value: "unavailable", provenance: [] };
    if (input.publicWebsite.observedPublicEmails.length > 0) {
      return {
        value: "public_company_email",
        provenance: [prov({
          providerId: "public-website",
          sourceUrl: input.publicWebsite.sourceUrl ?? null,
          grain: "company_site",
          capturedAt: input.publicWebsite.retrievedAt ?? null,
          parserVersion: input.publicWebsite.parserVersion,
          interpretationVersion: input.publicWebsite.interpretationVersion,
          explanation: `Public company email observed on the candidate's own website. Email count: ${input.publicWebsite.observedPublicEmails.length}.`,
        })],
      };
    }
    // Phone alone is NOT eligible for Buyer conversion (unchanged rule).
    return { value: "unavailable", provenance: [] };
  })();

  // ---------- Coverage ----------
  const coverage: ThailandAggregateCoverage = (() => {
    const planned = ["thai-customs-stats", "public-website", "thai-dbd", "thai-customs-operator", "thai-fda-importer"];
    const evaluated: string[] = [];
    const unavailable: string[] = [];
    const failed: string[] = [];
    const manualPending: string[] = [];
    if (input.thaiCustomsStats) {
      const s = input.thaiCustomsStats.status;
      if (s === "completed" || s === "no_match" || s === "cached") evaluated.push("thai-customs-stats");
      else if (s === "failed_retryable" || s === "failed_terminal") failed.push("thai-customs-stats");
      else unavailable.push("thai-customs-stats");
    } else {
      unavailable.push("thai-customs-stats");
    }
    if (input.publicWebsite) {
      const s = input.publicWebsite.status;
      if (s === "completed" || s === "no_match" || s === "cached") evaluated.push("public-website");
      else if (s === "failed_retryable" || s === "failed_terminal") failed.push("public-website");
      else unavailable.push("public-website");
    } else {
      unavailable.push("public-website");
    }
    for (const mp of ["thai-dbd", "thai-customs-operator", "thai-fda-importer"] as const) {
      const present = mp === "thai-dbd" ? dbd : mp === "thai-customs-operator" ? customsOperator : fdaImporter;
      if (present) evaluated.push(mp);
      else manualPending.push(mp);
    }
    return { planned, evaluated, unavailable, failed, manualPending };
  })();

  // ---------- Provider summaries ----------
  const providerSummaries: ThailandAggregateProviderSummary[] = [];
  if (input.thaiCustomsStats) {
    providerSummaries.push({
      providerId: "thai-customs-stats",
      status: input.thaiCustomsStats.status,
      datasetVersion: input.thaiCustomsStats.datasetVersion ?? null,
      parserVersion: "thai-customs-stats-csv-v1",
      interpretationVersion: "thai-customs-stats-csv-v1:t08-v1",
      sourcePeriod: input.thaiCustomsStats.sourcePeriod ?? null,
      retrievedAt: input.thaiCustomsStats.retrievedAt ?? null,
      observation: (input.thaiCustomsStats.observation ?? "").slice(0, 400) || null,
    });
  }
  if (input.publicWebsite) {
    providerSummaries.push({
      providerId: "public-website",
      status: input.publicWebsite.status,
      datasetVersion: input.publicWebsite.datasetVersion ?? null,
      parserVersion: input.publicWebsite.parserVersion ?? "public-website-html-v2",
      interpretationVersion: input.publicWebsite.interpretationVersion ?? "public-website-html-v2:t08-v1",
      sourcePeriod: input.publicWebsite.sourcePeriod ?? null,
      retrievedAt: input.publicWebsite.retrievedAt ?? null,
      observation: (input.publicWebsite.observation ?? "").slice(0, 400) || null,
    });
  }

  // ---------- Overall state ----------
  const overallState: ThailandAggregateResult["overallState"] = (() => {
    if (coverage.evaluated.length === 0) return "no_evidence";
    if (conflicts.length > 0 || companyIdentity.value === "needs_review") return "needs_review";
    if (coverage.manualPending.length === 0 && coverage.failed.length === 0 && coverage.unavailable.length === 0) {
      return "evidence_complete";
    }
    return "evidence_partial";
  })();

  // Limitations always include the hard structural caveats.
  limitations.push(
    "Thailand V1 never establishes company-level shipment activity (no free company-level shipment source).",
    "Market-level Thai Customs flows are NEVER promoted to candidate-level import claims.",
    "Website-only identity signals never promote to `verified`; strong DBD manual evidence is required.",
  );

  return {
    contractVersion: THAILAND_AGGREGATE_CONTRACT_VERSION,
    companyIdentity,
    importExportRegistration,
    foodImportLicense,
    productRelevance: { companyLevel: companyProduct, marketLevel: marketProduct },
    marketImportActivity,
    indiaOriginMarketActivity,
    companyShipmentActivity,
    contactAvailability,
    coverage,
    providerSummaries,
    conflicts,
    overallState,
    limitations,
  };
}

/** Dimensions emitted on the aggregate — for documentation and tests. */
export const THAILAND_AGGREGATE_DIMENSION_KEYS = DIMENSION_KEYS;
