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
 * A single HS classification that (partially or fully) covers an MDF
 * product for a given revision. A product may map to more than one
 * code; the mapping records how each code contributes.
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
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export type MarketDataCostClass = "free" | "free_tier" | "paid";

/**
 * Analytical goals a provider adapter may declare. MI selects the
 * cheapest configured provider that supports the requested goal;
 * providers that do not declare a capability are never called for it.
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
 * Static declaration of what an adapter can do and what it costs. No
 * adapter may be automatically called for a capability it did not
 * declare; no adapter above cost_class `free_tier` may be required.
 */
export interface MarketProviderDescriptor {
  providerId: string;
  displayName: string;
  costClass: MarketDataCostClass;
  requiresKey: boolean;
  requiresCard: boolean;
  freeLimit?: string;
  coverage: string;
  latestPeriod?: string;
  frequency: MarketDataFrequency[];
  capabilities: MarketProviderCapability[];
  sourceTier: MarketSourceTier;
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
