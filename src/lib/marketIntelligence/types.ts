/**
 * MI0 — shared Market Intelligence types.
 *
 * Market Intelligence is a NEW first-class domain, orthogonal to
 * Buyer Intelligence. Buyer Intelligence is Candidate-scoped
 * ("is this company a real buyer of X?"). Market Intelligence is
 * country × product scoped ("is this country a good market for MDF
 * product X?"). The two domains MUST NOT share tables. Company
 * evidence must never contribute to a country Market Fit score, and
 * country-level statistics must never be attributed to a specific
 * company.
 *
 * MI0 ships only the shared vocabulary and pure calculation helpers.
 * There is no ingestion, no migration, no provider call, and no live
 * data. Every value produced from these types is required to carry
 * source provenance downstream (MI1+).
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** ISO 3166-1 alpha-2 country code. Uppercase, exactly two letters. */
export type CountryAlpha2 = string;

/**
 * ISO 3166-1 alpha-3 country code. Some free trade-data providers
 * (BACI notably) expose lowercase alpha-3 as their reporter/partner
 * identity. MI stores alpha-2 internally; provider adapters translate
 * at their boundary and MUST never surface alpha-3 into the domain.
 */
export type CountryAlpha3 = string;

/** Canonical MDF business product id from `src/lib/catalogue/products.ts`. */
export type MdfProductId = string;

/**
 * HS classification revision. Trade datasets report in one of several
 * long-lived revisions; MI must never compare codes across revisions
 * blindly (`0904.21` in HS17 is not automatically the same coverage as
 * `0904.20` in HS02). Aggregations that span revisions must be
 * explicit and versioned.
 */
export type HsRevision = "HS92" | "HS96" | "HS02" | "HS07" | "HS12" | "HS17" | "HS22";

/** HS hierarchy level. `2` = chapter, `4` = heading, `6` = subheading. */
export type HsLevel = 2 | 4 | 6;

/**
 * MI0.1 — how tightly a given HS classification actually corresponds
 * to the MDF business product.
 *
 * `exact` — the HS code isolates the MDF product with negligible
 * spillover from other products (e.g. HS 080810 = "Fresh apples";
 * origin still determines "Indian"). Full Market Fit publishing is
 * eligible for this code.
 *
 * `proxy` — the HS code covers the MDF product AND close cousins
 * that MDF does not sell (e.g. HS 090421 = "dried Capsicum/Pimenta"
 * — Guntur chilli plus every other dried chilli). Market Fit may be
 * published but must be labelled as a trade proxy in the UI.
 *
 * `composite` — the HS code is a broad bucket where the MDF product
 * is one of many unrelated items (e.g. HS 080450 = mango + guava +
 * mangosteen; HS 081090 = "other fresh fruit"). Publishing a
 * numeric Market Fit from a composite code would misrepresent the
 * market. MI publishes proxy metrics and lowers recommendation
 * status accordingly.
 */
export type MappingKind = "exact" | "proxy" | "composite";

/**
 * How specifically the MDF product may be scored from this code.
 * Populated deterministically from `mappingKind` in
 * `mappingFitEligibility()` — never set by hand at ingest time.
 */
export type MappingFitEligibility =
  | "exact"                    // suitable for actionable score
  | "proxy_allowed"            // usable but must be UI-labelled
  | "insufficient_specificity"; // must gate the numeric score

/**
 * A single HS classification that (partially or fully) covers an MDF
 * product for a given revision. A product may map to more than one
 * code; the mapping records how each code contributes AND how
 * confidently it represents the MDF product itself.
 *
 * `form` describes what the code covers in operator-readable terms
 * ("dried", "fresh", "powdered", …). `weight` allows a future
 * aggregation to be documented and versioned rather than silently
 * summed — MI0 does not aggregate across codes automatically.
 */
export interface ProductTradeMapping {
  mdfProductId: MdfProductId;
  hsRevision: HsRevision;
  hsLevel: HsLevel;
  /** Digits only; no separator. `090421` not `09.04.21`. */
  hsCode: string;
  tradeLabel: string;
  form?: string;
  notes?: string;
  /**
   * Fractional coverage this code contributes to the MDF product's
   * total market (1 = exclusive coverage; <1 = shared coverage). MI0
   * does not compute aggregate values from this; MI1+ ingestion may
   * only combine codes with an explicitly documented weight sum.
   */
  weight?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  /** MI0.1 — specificity of this classification for the MDF product. */
  mappingKind: MappingKind;
  /**
   * MI0.1 — 0..1 subjective confidence that this HS bucket represents
   * the MDF product. Feeds directly into Market Fit's
   * `hs_mapping_certainty` confidence axis.
   *   • exact           → 0.9..1.0
   *   • proxy           → 0.5..0.8
   *   • composite       → 0.2..0.4
   */
  mappingConfidence: number;
  /** MI0.1 — plain-English scope shown in the UI ("Trade proxy: …"). */
  scopeDescription: string;
  /**
   * MI0.1 — plain-English hint listing the non-MDF items the code
   * also captures. UI may render as "Also includes: …" so the
   * operator understands what dilutes the number.
   */
  includedProductsNote?: string;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export type MarketDataCostClass = "free" | "free_tier" | "paid";

export type MarketProviderQuotaState =
  | "unlimited"
  | "available"
  | "unknown"
  | "exhausted";

export type MarketProviderQuotaPolicy = "unlimited" | "free_only_limited";

export type MarketHsCompatibility = "native" | "harmonized";

export type MarketGeographicCoverage =
  | { scope: "global" }
  | { scope: "countries"; reporterCountries: CountryAlpha2[] };

/**
 * Analytical goals a provider adapter may declare. MI filters eligibility
 * first, then ranks free providers by the versioned selection policy.
 * Providers that do not declare a capability are never called for it.
 */
export type MarketProviderCapability =
  | "import_series"       // World-imports value / quantity time series
  | "partner_series"      // Bilateral trade with a named partner over time
  | "origin_breakdown"    // Origin-country shares for a period
  | "tariff_data"         // Applied MFN / preferential tariffs (WITS/TRAINS)
  | "seasonality"         // Monthly frequency
  ;

/** Data-source authority tier — drives Market Fit's Data Confidence input. */
export type MarketSourceTier =
  | "A" // Official government / intergovernmental (UN Comtrade direct, national customs)
  | "B" // Normalized research datasets (BACI, OEC harmonized)
  | "C" // Commercial customs/shipment (Volza, ImportYeti, Panjiva — never required)
  | "D" // Company-reported (annual reports, filings)
  | "E" // Directory / discovery signals
  ;

/**
 * Dataset and distribution-service rights remain separate. Persistent
 * ingestion requires explicit service-term verification and storage approval;
 * missing fields never imply permission.
 */
export interface MarketProviderLicense {
  datasetSource: string;
  datasetLicenseName?: string;
  datasetLicenseUrl?: string;
  datasetAttributionRequirement?: string;
  distributionService: string;
  distributionServiceTermsUrl?: string;
  distributionCatalogLicenseName?: string;
  serviceTermsVerified: boolean;
  storageAllowed?: boolean;
  redistributionAllowed?: boolean;
  licenceVerifiedAt?: string;
  licenceVerificationNote?: string;
}

/**
 * MI0.1 — reporter-side country coding used by the provider on the
 * wire. MI's canonical identity is always alpha-2 uppercase; the
 * adapter must translate at the boundary and never leak alpha-3 into
 * the domain.
 */
export type ProviderCountryCoding = "iso_alpha2" | "iso_alpha3";

/**
 * Static declaration of what an adapter can do and what it costs. No
 * adapter may be automatically called for a capability it did not
 * declare; no adapter above cost_class `free_tier` may be required.
 */
export interface MarketProviderDescriptor {
  providerId: string;
  displayName: string;
  enabled: boolean;
  costClass: MarketDataCostClass;
  requiresKey: boolean;
  requiresCard: boolean;
  quotaPolicy: MarketProviderQuotaPolicy;
  /** Allows an unknown quota state only when there is no metered paid fallback. */
  unknownQuotaSafe: boolean;
  freeLimit?: string;
  coverage: string;
  geographicCoverage: MarketGeographicCoverage;
  latestPeriod?: string;
  /** Dataset release/update time when the provider publishes one. */
  datasetUpdatedAt?: string;
  frequency: MarketDataFrequency[];
  capabilities: MarketProviderCapability[];
  sourceTier: MarketSourceTier;
  /** MI0.1 — provider wire coding (translated at adapter boundary). */
  countryCoding: ProviderCountryCoding;
  /** MI0.1 — HS revision(s) the provider actually serves. */
  hsRevisions: HsRevision[];
  hsCompatibility: Partial<Record<HsRevision, MarketHsCompatibility>>;
  queryResultLimit?: number;
  /** MI0.1 — dataset licence, when the provider publishes one. */
  license?: MarketProviderLicense;
}

// ---------------------------------------------------------------------------
// Observations and metrics
// ---------------------------------------------------------------------------

export type MarketDataFrequency = "annual" | "quarterly" | "monthly";

export type MarketTradeFlow = "import" | "export" | "re_import" | "re_export";

export type MarketQuantityUnit = "kg" | "tonne" | "unit" | "litre" | "cubic_metre" | "other";

/**
 * A raw market trade observation as reported by one provider. Missing
 * values MUST stay null — 0 means "the source reported zero", never
 * "unknown". `source_period` records the vintage of the underlying
 * dataset if a provider reports revisions.
 */
export interface MarketTradeObservation {
  providerId: string;
  datasetId: string;
  reporterCountry: CountryAlpha2;
  /** null = world / all-partners aggregate for that reporter. */
  partnerCountry: CountryAlpha2 | null;
  tradeFlow: MarketTradeFlow;
  hsRevision: HsRevision;
  hsCode: string;
  frequency: MarketDataFrequency;
  /** ISO period label — "2024", "2024-Q4", "2024-06". */
  period: string;
  tradeValueUsd?: number | null;
  quantity?: number | null;
  quantityUnit?: MarketQuantityUnit | null;
  netWeightKg?: number | null;
  retrievedAt: string;
  sourcePeriod?: string | null;
  sourceUrl?: string | null;
  safeReference?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * A calculated metric derived from one or more observations. Metrics
 * are rebuildable projections — never persisted as fake source rows.
 * `supportCount` records how many observations actually participated
 * in the formula so a partial series can still be displayed truthfully.
 */
export interface MarketMetric {
  metricKey: string;
  valueType: "number" | "text" | "json";
  numericValue?: number | null;
  textValue?: string | null;
  structuredValue?: unknown;
  unit?: string;
  calculationWindow: string;
  supportCount: number;
  observationWatermark?: string;
  calculatedAt: string;
  calculationVersion: string;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * The Market Fit component vocabulary. Weights are proposed in
 * `marketFit.ts` and are always applied through
 * `MARKET_FIT_WEIGHT_VERSION` so a future change never silently
 * rewrites history — a superseding score is persisted, the old one is
 * marked superseded, and both are traceable.
 */
export type MarketFitComponentKey =
  | "demand_size"
  | "demand_growth"
  | "india_position"
  | "competitive_opportunity"
  | "price_attractiveness"
  | "demand_stability";

export interface MarketFitComponent {
  key: MarketFitComponentKey;
  /** 0..100 or null when there is not enough evidence for this component. */
  value: number | null;
  weight: number;
  reason: string;
  supportCount: number;
}

export type MarketFitClassification =
  | "excellent_opportunity"
  | "strong_opportunity"
  | "moderate_opportunity"
  | "weak_opportunity"
  | "low_opportunity"
  | "insufficient_evidence";

export interface MarketFitScore {
  score: number | null;
  classification: MarketFitClassification;
  components: MarketFitComponent[];
  positiveReasons: string[];
  negativeReasons: string[];
  calculationVersion: string;
  calculatedAt: string;
}

/**
 * MI0.1 — deterministic recommendation state that lives ALONGSIDE
 * (never inside) Market Fit and Data Confidence. The gate is
 * evaluated by `recommendationStatus()` in `marketFit.ts` from:
 *   • hasNumericScore (Fit is not null)
 *   • hasDemandSizeEvidence (any positive market total)
 *   • hasHistoricalEvidence (a trend or CAGR/YoY exists)
 *   • mappingFitEligibility (exact / proxy_allowed / insufficient)
 *   • dataConfidenceScore
 * The three states are mutually exclusive.
 */
export type MarketRecommendationStatus =
  | "actionable"
  | "indicative"
  | "insufficient_evidence";

/**
 * MI0.1 — freshness triangle. `analysisDate` is when MI computed the
 * result the operator sees now. `retrievedAt` is when the underlying
 * observation last hit the provider. `latestSourcePeriod` is the
 * period the provider actually reports for. Three distinct facts;
 * the UI must never conflate them (a 2024 BACI figure retrieved in
 * Sep 2026 is not "current market activity").
 */
export interface MarketDataFreshness {
  analysisDate: string;
  retrievedAt?: string;
  latestSourcePeriod?: string;
  frequency?: MarketDataFrequency;
  providerId?: string;
}

/**
 * MI0.1 — durable provider fetch/cache ledger. MI0 does NOT persist
 * these; the type defines the future MI1 table so architecture
 * discussion is grounded in real fields. Never carries API keys,
 * cookies, tokens, or paid-provider raw payloads.
 */
export interface MarketProviderFetchLedgerEntry {
  providerId: string;
  datasetId: string;
  /**
   * Stable canonical key derived from every material query dimension,
   * including provider/dataset, reporter/partner, flow, HS revision/code
   * set, frequency, coverage, and provider-selection version. A repeat
   * call resolves to the same ledger identity without ambiguity.
   */
  queryFingerprint: string;
  reporterCountry: CountryAlpha2;
  tradeFlow: MarketTradeFlow;
  hsRevision: HsRevision;
  hsCodes: string[];
  partnerCountry?: CountryAlpha2 | null;
  frequency: MarketDataFrequency;
  providerSelectionVersion: string;
  coverageStart: string;
  coverageEnd: string;
  fetchedAt: string;
  freshUntil: string;
  outcome:
    | "success"
    | "partial"
    | "empty"
    | "quota_exhausted"
    | "timeout"
    | "provider_error"
    | "invalid_request"
    | "unavailable";
  rowsReceived: number;
  /** Earliest safe retry time for quota/unavailable outcomes, when known. */
  retryAfter?: string;
  safeMetadata?: Record<string, unknown>;
}

export interface DataConfidenceScore {
  score: number;
  components: {
    key:
      | "source_authority"
      | "coverage_completeness"
      | "data_recency"
      | "period_continuity"
      | "quantity_availability"
      | "partner_completeness"
      | "hs_mapping_certainty";
    value: number;
    weight: number;
    reason: string;
  }[];
  calculationVersion: string;
  calculatedAt: string;
}
