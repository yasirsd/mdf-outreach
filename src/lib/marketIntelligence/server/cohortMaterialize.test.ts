import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MdfMembership } from "@/lib/auth/membership";
import { calibrationCohort } from "../calibration/cohort";
import { DATA_CONFIDENCE_VERSION, MARKET_FIT_VERSION } from "../marketFit";
import { MI_PRODUCT_MAPPING_VERSION } from "../product";
import { MI_PROVIDER_SELECTION_VERSION } from "../providerSelection";
import type {
  MarketReadRepositoryObservation,
  MarketReadRepositoryProductMapping,
  MarketReadRepositoryScore,
  MarketReadRepositoryScoreComponent,
  MarketReadRepositorySource,
} from "../marketReadRepository";
import { PRODUCT_TRADE_MAPPINGS } from "../product";
import type { ScoreRefreshRequest, ScoreRefreshResult } from "./scoreRefresh";
import {
  buildMarketScoreWatermarks,
} from "./scorePersistence";
import {
  COHORT_MATERIALIZE_PRODUCT_ID,
  COHORT_MATERIALIZE_TOTAL_COUNT,
  __resetCohortMaterializeInFlightForTests,
  classifyCohortCountry,
  runCohortMaterializeStep,
  verifyCohortMaterialization,
} from "./cohortMaterialize";

vi.mock("server-only", () => ({}));

const OWNER_SESSION: { membership: MdfMembership } = {
  membership: { workspaceId: "ws-1", role: "owner" },
};
const MEMBER_SESSION: { membership: MdfMembership } = {
  membership: { workspaceId: "ws-1", role: "member" },
};

/** Known-good regression Fit snapshot from MI1H. */
const MI1H_FIT_SNAPSHOT: Record<string, number> = {
  US: 66, TH: 62, MY: 57, VN: 53, LK: 53, NL: 52, SG: 51, CA: 50,
  QA: 46, AU: 44, DE: 44, JP: 43, KW: 40, GB: 40, AE: 36, KR: 34,
  SA: 33, OM: 24,
};

const NOW = new Date("2026-09-23T00:00:00.000Z");

afterEach(() => {
  __resetCohortMaterializeInFlightForTests();
  vi.restoreAllMocks();
});

function sixComponents(): MarketReadRepositoryScoreComponent[] {
  const keys = [
    "demand_size", "demand_growth", "india_position",
    "competitive_opportunity", "price_attractiveness", "demand_stability",
  ];
  const weights = [25, 20, 20, 15, 10, 10];
  return keys.map((key, index) => ({
    id: `${key}-id`,
    componentKey: key,
    rawMetricValue: 1,
    normalizedScore: 50,
    weight: weights[index]!,
    supported: true,
    reason: "",
    metadata: {},
  }));
}

function canonicalMapping(): MarketReadRepositoryProductMapping {
  const registry = PRODUCT_TRADE_MAPPINGS.find(
    (m) => m.mdfProductId === COHORT_MATERIALIZE_PRODUCT_ID && m.hsRevision === "HS17" && m.hsCode === "090421",
  )!;
  return {
    id: "mapping-uuid",
    mdfProductId: registry.mdfProductId,
    hsRevision: registry.hsRevision,
    hsLevel: registry.hsLevel,
    hsCode: registry.hsCode,
    tradeLabel: registry.tradeLabel,
    mappingKind: registry.mappingKind,
    mappingConfidence: registry.mappingConfidence,
    fitEligibility: "proxy_allowed",
    scopeDescription: registry.scopeDescription,
    includedProductsNote: registry.includedProductsNote,
    weight: registry.weight,
    isActive: true,
    registryVersion: MI_PRODUCT_MAPPING_VERSION,
  };
}

function verifiedSource(): MarketReadRepositorySource {
  return {
    id: "source-uuid",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    sourceTier: "A",
    datasetSource: "OEC/BACI",
    distributionService: "BotMarket",
    serviceTermsVerified: true,
    storageAllowed: true,
    redistributionAllowed: false,
    licenceVerifiedAt: "2026-01-01T00:00:00.000Z",
    sourceUrl: "https://botmarket.oec.world/dataset/baci-hs17",
    retrievedAt: "2026-01-01T00:00:00.000Z",
  };
}

function buildObservation(country: string, year: number, partner: string, id: string, seed = 1): MarketReadRepositoryObservation {
  return {
    id,
    sourceId: "source-uuid",
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    reporterCountry: country,
    partnerCountry: partner,
    tradeFlow: "import",
    hsRevision: "HS17",
    hsCode: "090421",
    frequency: "annual",
    period: String(year),
    tradeValueUsd: seed * 1000,
    quantity: seed,
    quantityUnit: "tonne",
    netWeightKg: null,
    retrievedAt: "2026-09-20T00:00:00.000Z",
  };
}

function observationsFor(country: string): MarketReadRepositoryObservation[] {
  const rows: MarketReadRepositoryObservation[] = [];
  const partners = ["IN", "CN", "TH"];
  for (const year of [2018, 2019, 2020, 2021, 2022, 2023, 2024]) {
    for (const partner of partners) {
      rows.push(buildObservation(country, year, partner, `${country}-${year}-${partner}`, year - 2017));
    }
  }
  return rows;
}

function freshLedger(country: string) {
  return {
    providerId: "baci_oec",
    datasetId: "baci-hs17",
    queryFingerprint: `fp-${country}`,
    reporterCountry: country,
    partnerCountry: null,
    tradeFlow: "import" as const,
    hsRevision: "HS17" as const,
    hsCodes: ["090421"],
    frequency: "annual" as const,
    providerSelectionVersion: MI_PROVIDER_SELECTION_VERSION,
    coverageStart: "2018",
    coverageEnd: "2024",
    fetchedAt: "2026-09-20T00:00:00.000Z",
    freshUntil: "2026-10-20T00:00:00.000Z",
    outcome: "success" as const,
    rowsReceived: 21,
  };
}

/** Build a persisted score whose watermarks match the fresh evidence for the same country. */
function scoreRow(country: string, overrides: Partial<MarketReadRepositoryScore> = {}): MarketReadRepositoryScore {
  const observations = observationsFor(country);
  const ledger = freshLedger(country);
  const watermarks = buildMarketScoreWatermarks({
    countryAlpha2: country,
    mdfProductId: COHORT_MATERIALIZE_PRODUCT_ID,
    mapping: canonicalMapping(),
    source: verifiedSource(),
    observations,
    ledger,
  });
  return {
    id: `score-${country}`,
    supersededAt: null,
    countryAlpha2: country,
    mdfProductId: COHORT_MATERIALIZE_PRODUCT_ID,
    diagnosticFitScore: MI1H_FIT_SNAPSHOT[country] ?? 50,
    publishedFitScore: MI1H_FIT_SNAPSHOT[country] ?? 50,
    dataConfidenceScore: 80,
    recommendationStatus: "indicative",
    mappingKind: "proxy",
    mappingConfidence: 0.7,
    fitEligibility: "proxy_allowed",
    isTradeProxy: true,
    marketFitVersion: MARKET_FIT_VERSION,
    confidenceVersion: DATA_CONFIDENCE_VERSION,
    providerSelectionVersion: MI_PROVIDER_SELECTION_VERSION,
    recommendationReason: null,
    positiveReasons: [],
    negativeReasons: [],
    sourceCoverage: {
      mapping_registry_version: MI_PRODUCT_MAPPING_VERSION,
      mapping_watermark: watermarks.mappingWatermark,
      evidence_watermark: watermarks.evidenceWatermark,
      persistence_fingerprint: "pf",
    },
    calculatedAt: "2026-09-20T00:00:00.000Z",
    components: sixComponents(),
    ...overrides,
  };
}

function refreshStub(country: string, refreshOutcome: ScoreRefreshResult["outcome"] = "unchanged"): ScoreRefreshResult {
  const observations = observationsFor(country);
  const watermarks = buildMarketScoreWatermarks({
    countryAlpha2: country,
    mdfProductId: COHORT_MATERIALIZE_PRODUCT_ID,
    mapping: canonicalMapping(),
    source: verifiedSource(),
    observations,
    ledger: freshLedger(country),
  });
  return {
    outcome: refreshOutcome,
    dryRun: false,
    country,
    product: COHORT_MATERIALIZE_PRODUCT_ID,
    marketFitVersion: MARKET_FIT_VERSION,
    dataConfidenceVersion: DATA_CONFIDENCE_VERSION,
    fit: MI1H_FIT_SNAPSHOT[country] ?? null,
    confidence: 80,
    recommendationStatus: "indicative",
    supportedWeight: 100,
    componentCount: 6,
    evidenceWatermark: watermarks.evidenceWatermark,
    mappingWatermark: watermarks.mappingWatermark,
    scoreId: `score-${country}`,
    providerCalls: 0,
    databaseWrites:
      refreshOutcome === "unchanged" || refreshOutcome === "insufficient_evidence" ? 0 : 1,
    stale: refreshOutcome !== "unchanged",
    staleReasons: refreshOutcome === "unchanged" ? [] : ["evidence_watermark_missing"],
    preRefreshStale: refreshOutcome !== "unchanged",
    preRefreshStaleReasons: refreshOutcome === "unchanged" ? [] : ["evidence_watermark_missing"],
    resultingScoreStale: false,
  };
}

function buildRepo(scores: Map<string, MarketReadRepositoryScore | undefined>, options: {
  mapping?: MarketReadRepositoryProductMapping | null;
  source?: MarketReadRepositorySource | null;
  observationsPer?: (country: string) => MarketReadRepositoryObservation[];
  ledgerFor?: (country: string) => Array<ReturnType<typeof freshLedger>>;
} = {}) {
  const mapping = options.mapping === null ? undefined : (options.mapping ?? canonicalMapping());
  const source = options.source === null ? undefined : (options.source ?? verifiedSource());
  return {
    getCurrentMarketScore: vi.fn(async (country: string, product: string) => {
      expect(product).toBe(COHORT_MATERIALIZE_PRODUCT_ID);
      return scores.get(country);
    }),
    listActiveProductMappings: vi.fn(async () => (mapping ? [mapping] : [])),
    getSourceByProviderDataset: vi.fn(async (_p: string, _d: string) => source),
    listBilateralAnnualObservations: vi.fn(async (country: string) =>
      (options.observationsPer ?? observationsFor)(country)),
    listRecentLedgerEntriesForFingerprint: vi.fn(async (_p: string, _d: string, fp: string) => {
      const match = fp.match(/\|([A-Z]{2})\|/);
      const country = match ? match[1]! : "MY";
      return (options.ledgerFor ?? ((c: string) => [freshLedger(c)]))(country);
    }),
    listRecentLedgerEntriesForReporter: vi.fn(async () => []),
  };
}

// ---------------------------------------------------------------------------
// Deep classifier — the MI1J.1 fix
// ---------------------------------------------------------------------------

describe("MI1J.1 classifyCohortCountry (deep contract via assessMarketScoreStaleness)", () => {
  it("no score row → needs_create", async () => {
    const repo = buildRepo(new Map());
    const row = await classifyCohortCountry(repo, "AE", NOW);
    expect(row.classification).toBe("needs_create");
    expect(row.reasons).toContain("no_current_score");
  });

  it("stale Fit version → needs_refresh (market_fit_version_changed)", async () => {
    const scores = new Map([["MY", scoreRow("MY", { marketFitVersion: "mi-fit-v1" })]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("market_fit_version_changed");
  });

  it("stale confidence version → needs_refresh", async () => {
    const scores = new Map([["MY", scoreRow("MY", { confidenceVersion: "mi-conf-v0" })]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("data_confidence_version_changed");
  });

  it("stale provider-selection version → needs_refresh", async () => {
    const scores = new Map([["MY", scoreRow("MY", { providerSelectionVersion: "mi-select-v1" })]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("provider_selection_version_changed");
  });

  it("stale mapping-registry version → needs_refresh (mapping_registry_version_changed)", async () => {
    const stale = scoreRow("MY");
    (stale.sourceCoverage as Record<string, unknown>).mapping_registry_version = "old";
    const scores = new Map([["MY", stale]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("mapping_registry_version_changed");
  });

  it("versions match BUT evidence watermark mismatches → needs_refresh (evidence_watermark_changed)", async () => {
    const stale = scoreRow("MY");
    (stale.sourceCoverage as Record<string, unknown>).evidence_watermark = "sha256:different";
    const scores = new Map([["MY", stale]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("evidence_watermark_changed");
  });

  it("versions match BUT mapping watermark mismatches → needs_refresh (mapping_watermark_changed)", async () => {
    const stale = scoreRow("MY");
    (stale.sourceCoverage as Record<string, unknown>).mapping_watermark = "sha256:different";
    const scores = new Map([["MY", stale]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("mapping_watermark_changed");
  });

  it("versions match BUT evidence watermark missing → needs_refresh (evidence_watermark_missing)", async () => {
    const stale = scoreRow("MY");
    delete (stale.sourceCoverage as Record<string, unknown>).evidence_watermark;
    const scores = new Map([["MY", stale]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("needs_refresh");
    expect(row.reasons).toContain("evidence_watermark_missing");
  });

  it("versions + evidence + mapping all match → current, no reasons", async () => {
    const scores = new Map([["MY", scoreRow("MY")]]);
    const row = await classifyCohortCountry(buildRepo(scores), "MY", NOW);
    expect(row.classification).toBe("current");
    expect(row.reasons).toEqual([]);
  });

  it("canonical mapping missing → blocked with canonical_mapping_missing", async () => {
    const scores = new Map([["MY", scoreRow("MY")]]);
    const row = await classifyCohortCountry(buildRepo(scores, { mapping: null }), "MY", NOW);
    expect(row.classification).toBe("blocked");
    expect(row.reasons).toContain("canonical_mapping_missing");
  });

  it("verified BACI source rights missing → blocked with verified_source_rights_missing", async () => {
    const scores = new Map([["MY", scoreRow("MY")]]);
    const row = await classifyCohortCountry(buildRepo(scores, { source: null }), "MY", NOW);
    expect(row.classification).toBe("blocked");
    expect(row.reasons).toContain("verified_source_rights_missing");
  });
});

// ---------------------------------------------------------------------------
// Cohort orchestration — authority, selection, terminal, dry-run
// ---------------------------------------------------------------------------

describe("MI1J.1 runCohortMaterializeStep — authority", () => {
  it("unauthenticated → outcome unauthorised", async () => {
    const repo = buildRepo(new Map());
    const refresh = vi.fn();
    const result = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => { throw new Error("unauth"); },
      loadRepository: async () => repo,
      refreshScore: refresh,
    });
    expect(result.outcome).toBe("unauthorised");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("member → forbidden", async () => {
    const repo = buildRepo(new Map());
    const result = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => MEMBER_SESSION,
      loadRepository: async () => repo,
      refreshScore: vi.fn(),
    });
    expect(result.outcome).toBe("forbidden");
  });
});

describe("MI1J.1 runCohortMaterializeStep — selection & terminal", () => {
  it("all 18 deeply current → cohort_complete, remainingCountries=[], zero writes, refresh not called", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    const refresh = vi.fn();
    const result = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(result.outcome).toBe("cohort_complete");
    expect(result.remainingCountries).toEqual([]);
    expect(result.currentCount).toBe(COHORT_MATERIALIZE_TOTAL_COUNT);
    expect(result.databaseWrites).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("evidence-drifted country prevents cohort_complete even though versions match", async () => {
    const cohort = calibrationCohort();
    const scores = new Map<string, MarketReadRepositoryScore>();
    for (const c of cohort) {
      const s = scoreRow(c.countryAlpha2);
      if (c.countryAlpha2 === "US") {
        (s.sourceCoverage as Record<string, unknown>).evidence_watermark = "sha256:drift";
      }
      scores.set(c.countryAlpha2, s);
    }
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "superseded_and_created"));
    const result = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(result.outcome).toBe("country_refreshed");
    expect(result.processedCountry).toBe("US");
  });

  it("first non-current country in canonical order is chosen", async () => {
    const cohort = calibrationCohort();
    const scores = new Map<string, MarketReadRepositoryScore | undefined>();
    for (const c of cohort) {
      scores.set(c.countryAlpha2, c.countryAlpha2 === "MY" ? scoreRow("MY") : undefined);
    }
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "created"));
    const result = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(
      { country: "AE", product: COHORT_MATERIALIZE_PRODUCT_ID, dryRun: false },
      {},
    );
    expect(result.processedCountry).toBe("AE");
    expect(result.outcome).toBe("country_created");
  });

  it("deep-stale MY (mi-fit-v1) is chosen FIRST in canonical order", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [
      c.countryAlpha2,
      scoreRow(c.countryAlpha2, c.countryAlpha2 === "MY" ? { marketFitVersion: "mi-fit-v1" } : {}),
    ]));
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "superseded_and_created"));
    const result = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(result.processedCountry).toBe("MY");
  });

  it("exactly ONE country is materialized per invocation", async () => {
    const scores = new Map<string, MarketReadRepositoryScore | undefined>();
    scores.set("MY", scoreRow("MY"));
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "created"));
    await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Dry-run semantics — MI1J.1 fix
// ---------------------------------------------------------------------------

describe("MI1J.1 dry-run does NOT rewrite cohort progress state", () => {
  it("selected country remains in remainingCountries; currentCount unchanged; 0 writes", async () => {
    const cohort = calibrationCohort();
    const scores = new Map<string, MarketReadRepositoryScore | undefined>();
    scores.set("MY", scoreRow("MY"));
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => ({
      ...refreshStub(req.country, "created"),
      dryRun: true,
      databaseWrites: 0 as const,
    }));
    const result = await runCohortMaterializeStep({ dryRun: true }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(result.dryRun).toBe(true);
    expect(result.databaseWrites).toBe(0);
    expect(result.selectedCountry).toBe("AE");
    expect(result.projectedOutcome).toBe("country_created");
    // AE MUST still be in remainingCountries after dry-run.
    expect(result.remainingCountries).toContain("AE");
    // Only actually-current countries in currentCountries.
    expect(result.currentCountries).not.toContain("AE");
    expect(result.currentCount).toBe(1); // only MY
    expect(result.remainingCount).toBe(cohort.length - 1);
    // processedCountry MUST NOT be set on dry-run — it only appears live.
    expect(result.processedCountry).toBeUndefined();
  });

  it("dry-run of a deep-stale country does NOT mark it current or blocked", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [
      c.countryAlpha2,
      scoreRow(c.countryAlpha2, c.countryAlpha2 === "MY" ? { marketFitVersion: "mi-fit-v1" } : {}),
    ]));
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => ({
      ...refreshStub(req.country, "superseded_and_created"),
      dryRun: true,
      databaseWrites: 0 as const,
    }));
    const result = await runCohortMaterializeStep({ dryRun: true }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(result.dryRun).toBe(true);
    expect(result.selectedCountry).toBe("MY");
    expect(result.projectedOutcome).toBe("country_refreshed");
    // MY was needs_refresh BEFORE and is still needs_refresh AFTER a dry-run.
    expect(result.remainingCountries).toContain("MY");
    expect(result.currentCountries).not.toContain("MY");
    expect(result.databaseWrites).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("MI1J.1 idempotency", () => {
  it("rerun of an all-current cohort yields cohort_complete both times with zero writes", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const first = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    const second = await runCohortMaterializeStep({ dryRun: false }, {
      requireSession: async () => OWNER_SESSION,
      loadRepository: async () => buildRepo(scores),
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(first.outcome).toBe("cohort_complete");
    expect(second.outcome).toBe("cohort_complete");
    expect(first.databaseWrites).toBe(0);
    expect(second.databaseWrites).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrency proof (behavioural test of the DB-level contract)
// ---------------------------------------------------------------------------

describe("MI1J.1 concurrent same-country selection is safe (DB-level advisory + uidx)", () => {
  it("two parallel invocations that both pick AE produce one created + one unchanged", async () => {
    const cohort = calibrationCohort();
    const scores = new Map<string, MarketReadRepositoryScore | undefined>();
    scores.set("MY", scoreRow("MY"));
    const created = { didCreate: false };
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => {
      // Model the DB advisory lock: the first call in flight wins the
      // create; every subsequent call for the same (country, product)
      // sees a matching persistence fingerprint and returns unchanged.
      if (req.country === "AE" && !created.didCreate) {
        created.didCreate = true;
        return refreshStub("AE", "created");
      }
      return refreshStub(req.country, "unchanged");
    });
    __resetCohortMaterializeInFlightForTests();
    const [a, b] = await Promise.all([
      runCohortMaterializeStep({ dryRun: false }, {
        requireSession: async () => OWNER_SESSION,
        loadRepository: async () => buildRepo(scores),
        refreshScore: refresh,
        now: () => NOW,
      }),
      runCohortMaterializeStep({ dryRun: false }, {
        requireSession: async () => OWNER_SESSION,
        loadRepository: async () => buildRepo(scores),
        refreshScore: refresh,
        now: () => NOW,
      }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["country_created", "country_current"]);
    // A total of one write across the two parallel invocations.
    expect(a.databaseWrites + b.databaseWrites).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

describe("MI1J.1 verifyCohortMaterialization (deep read-only)", () => {
  it("all 18 deeply current + authoritative recompute matches → allPass true, allCurrent true, currentCount 18", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    const repo = buildRepo(scores);
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const report = await verifyCohortMaterialization({
      repository: repo,
      refreshScore: refresh,
      now: () => NOW,
    });
    expect(report.currentCount).toBe(COHORT_MATERIALIZE_TOTAL_COUNT);
    expect(report.allCurrent).toBe(true);
    expect(report.allPass).toBe(true);
    expect(report.providerCalls).toBe(0);
    for (const row of report.countries) {
      expect(row.passes.scoreExists).toBe(true);
      expect(row.passes.scoreNotStale).toBe(true);
      expect(row.passes.evidenceWatermarkMatches).toBe(true);
      expect(row.passes.mappingWatermarkMatches).toBe(true);
      expect(row.passes.fitMatchesAuthoritative).toBe(true);
      expect(row.passes.confidenceMatchesAuthoritative).toBe(true);
      expect(row.passes.supportedWeightMatchesAuthoritative).toBe(true);
      expect(row.passes.hasSixComponents).toBe(true);
      expect(row.passes.componentWeightSumIs100).toBe(true);
      expect(row.passes.isTradeProxyTrue).toBe(true);
      expect(row.passes.recommendationIsIndicative).toBe(true);
    }
  });

  it("verifier catches evidence-watermark drift", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    const usScore = scores.get("US")!;
    (usScore.sourceCoverage as Record<string, unknown>).evidence_watermark = "sha256:drift";
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const report = await verifyCohortMaterialization({
      repository: buildRepo(scores), refreshScore: refresh, now: () => NOW,
    });
    expect(report.allPass).toBe(false);
    const us = report.countries.find((c) => c.country === "US")!;
    expect(us.passes.evidenceWatermarkMatches).toBe(false);
  });

  it("verifier catches mapping-watermark drift", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    (scores.get("US")!.sourceCoverage as Record<string, unknown>).mapping_watermark = "sha256:drift";
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const report = await verifyCohortMaterialization({
      repository: buildRepo(scores), refreshScore: refresh, now: () => NOW,
    });
    expect(report.allPass).toBe(false);
    expect(report.countries.find((c) => c.country === "US")!.passes.mappingWatermarkMatches).toBe(false);
  });

  it("verifier catches persisted-Fit mismatch against authoritative recompute", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    scores.get("US")!.publishedFitScore = 99;
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const report = await verifyCohortMaterialization({
      repository: buildRepo(scores), refreshScore: refresh, now: () => NOW,
    });
    expect(report.allPass).toBe(false);
    const us = report.countries.find((c) => c.country === "US")!;
    expect(us.passes.fitMatchesAuthoritative).toBe(false);
  });

  it("verifier catches persisted-Confidence mismatch", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    scores.get("US")!.dataConfidenceScore = 5;
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const report = await verifyCohortMaterialization({
      repository: buildRepo(scores), refreshScore: refresh, now: () => NOW,
    });
    expect(report.allPass).toBe(false);
    const us = report.countries.find((c) => c.country === "US")!;
    expect(us.passes.confidenceMatchesAuthoritative).toBe(false);
  });

  it("verifier catches missing component (5 instead of 6)", async () => {
    const cohort = calibrationCohort();
    const scores = new Map(cohort.map((c) => [c.countryAlpha2, scoreRow(c.countryAlpha2)]));
    scores.get("US")!.components = scores.get("US")!.components.slice(0, 5);
    const refresh = vi.fn(async (req: ScoreRefreshRequest) => refreshStub(req.country, "unchanged"));
    const report = await verifyCohortMaterialization({
      repository: buildRepo(scores), refreshScore: refresh, now: () => NOW,
    });
    expect(report.allPass).toBe(false);
    const us = report.countries.find((c) => c.country === "US")!;
    expect(us.passes.hasSixComponents).toBe(false);
    expect(us.passes.componentWeightSumIs100).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Known Fit snapshot regression
// ---------------------------------------------------------------------------

describe("MI1J.1 known 18-country Fit snapshot regression", () => {
  it("persisted Fit matches the MI1H authoritative snapshot", () => {
    for (const [country, expected] of Object.entries(MI1H_FIT_SNAPSHOT)) {
      expect(scoreRow(country).publishedFitScore).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-code safety
// ---------------------------------------------------------------------------

describe("MI1J.1 code-source safety", () => {
  const HERE = process.cwd();
  const files = [
    "src/lib/marketIntelligence/server/cohortMaterialize.ts",
    "src/app/api/internal/market-intelligence/scores/materialize-cohort/route.ts",
  ];
  const bodies = files.map((f) => readFileSync(path.resolve(HERE, f), "utf8"));

  it("no BACI adapter, no cohortFetch, no Buyer Intelligence/Finder/Gmail, no bare fetch()", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/providers\/baci\/server|fetchBaciYearMembers|fetchBaciImporterMembers|fetchBaciQuery|cohortFetch/);
      expect(body).not.toMatch(/buyer_trade_observations|buyer_intelligence|buyerFinder|BUYER_SEND_ENABLED|gmail/i);
      expect(body).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("route accepts only optional dryRun and rejects extra keys", () => {
    const routeBody = bodies[1]!;
    expect(routeBody).toContain("Only an optional boolean `dryRun` field is accepted.");
    expect(routeBody).toContain("isSameOriginPost");
    expect(routeBody).not.toMatch(/export async function GET/);
  });

  it("no 090422 reference", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/090422/);
    }
  });
});
