import { describe, expect, it } from "vitest";
import {
  CANONICAL_PROVIDER_BY_CAPABILITY,
  MI_PROVIDER_SELECTION_VERSION,
  selectProvider,
} from "./providerSelection";
import {
  assertFreeMarketProviderExecution,
  checkFreeMarketProviderExecution,
  MarketProviderExecutionBlockedError,
} from "./providerExecution";
import { BACI_OEC_PROVIDER } from "./providers";
import type { MarketProviderDescriptor, MarketProviderQuotaState } from "./types";

function descriptor(overrides: Partial<MarketProviderDescriptor> = {}): MarketProviderDescriptor {
  return {
    providerId: "test_provider", displayName: "Test provider", enabled: true,
    costClass: "free", requiresKey: true, requiresCard: false,
    quotaPolicy: "free_only_limited", unknownQuotaSafe: false,
    coverage: "global", geographicCoverage: { scope: "global" }, latestPeriod: "2024",
    frequency: ["annual"], capabilities: ["import_series"], sourceTier: "B",
    countryCoding: "iso_alpha3", hsRevisions: ["HS17"], hsCompatibility: { HS17: "native" },
    license: {
      datasetSource: "Test dataset", datasetLicenseName: "Test open licence",
      datasetAttributionRequirement: "Attribute test source", distributionService: "Test service",
      serviceTermsVerified: true, storageAllowed: true, redistributionAllowed: false,
      licenceVerifiedAt: "2026-09-06T00:00:00.000Z",
    },
    ...overrides,
  };
}

function query(overrides: {
  hasKey?: (id: string) => boolean;
  quotaState?: (id: string) => MarketProviderQuotaState;
  reporterCountry?: string;
  frequency?: "annual" | "quarterly" | "monthly";
  hsRevision?: "HS17" | "HS22";
} = {}) {
  return {
    capability: "import_series" as const,
    reporterCountry: overrides.reporterCountry ?? "MY",
    hsRevision: overrides.hsRevision ?? "HS17",
    frequency: overrides.frequency ?? "annual",
    hasKey: overrides.hasKey,
    quotaState: overrides.quotaState ?? (() => "available" as const),
    persistentIngestion: true,
  };
}

describe("MI1A free-only provider eligibility", () => {
  it("fails closed when a required-key provider has no key callback", () => {
    expect(selectProvider([descriptor()], query({ hasKey: undefined }))).toBeUndefined();
  });

  it("rejects hasKey=false and accepts hasKey=true", () => {
    expect(selectProvider([descriptor()], query({ hasKey: () => false }))).toBeUndefined();
    expect(selectProvider([descriptor()], query({ hasKey: () => true }))?.descriptor.providerId)
      .toBe("test_provider");
  });

  it("rejects exhausted quota while accepting available quota", () => {
    expect(selectProvider([descriptor()], query({ hasKey: () => true, quotaState: () => "exhausted" }))).toBeUndefined();
    expect(selectProvider([descriptor()], query({ hasKey: () => true, quotaState: () => "available" }))).toBeDefined();
  });

  it("allows unknown quota only for a documented free-only provider", () => {
    expect(selectProvider([descriptor()], query({ hasKey: () => true, quotaState: () => "unknown" }))).toBeUndefined();
    expect(selectProvider([descriptor({ unknownQuotaSafe: true })], query({ hasKey: () => true, quotaState: () => "unknown" }))).toBeDefined();
  });

  it("derives unlimited quota when an unlimited provider has no quota callback", () => {
    const unlimited = descriptor({
      requiresKey: false,
      quotaPolicy: "unlimited",
      unknownQuotaSafe: false,
    });
    const result = selectProvider([unlimited], {
      ...query({ hasKey: undefined }),
      quotaState: undefined,
    });
    expect(result?.descriptor.providerId).toBe("test_provider");
    expect(result?.reasons).toContain("quota unlimited");
  });

  it("rejects paid, card-required, and disabled providers", () => {
    for (const row of [descriptor({ costClass: "paid" }), descriptor({ requiresCard: true }), descriptor({ enabled: false })]) {
      expect(selectProvider([row], query({ hasKey: () => true }))).toBeUndefined();
    }
  });

  it("rejects unsupported geography, frequency, HS revision, and capability", () => {
    const row = descriptor({ geographicCoverage: { scope: "countries", reporterCountries: ["MY"] } });
    expect(selectProvider([row], query({ hasKey: () => true, reporterCountry: "AE" }))).toBeUndefined();
    expect(selectProvider([row], query({ hasKey: () => true, frequency: "monthly" }))).toBeUndefined();
    expect(selectProvider([row], query({ hasKey: () => true, hsRevision: "HS22" }))).toBeUndefined();
    expect(checkFreeMarketProviderExecution(row, {
      capability: "tariff_data", reporterCountry: "MY", hsRevision: "HS17", frequency: "annual",
      hasKey: true, quotaState: "available", persistentIngestion: true,
    })).toEqual({ ok: false, reason: "unsupported_capability" });
  });

  it("blocks persistent ingestion without verified service terms and storage approval", () => {
    expect(checkFreeMarketProviderExecution(BACI_OEC_PROVIDER, {
      capability: "import_series", reporterCountry: "MY", hsRevision: "HS17", frequency: "annual",
      hasKey: true, quotaState: "unknown", persistentIngestion: true,
    })).toEqual({ ok: false, reason: "licence_unverified" });

    expect(checkFreeMarketProviderExecution(descriptor({
      license: {
        datasetSource: "Test dataset",
        datasetLicenseName: "Test open licence",
        distributionService: "Test service",
        serviceTermsVerified: true,
        storageAllowed: false,
        licenceVerifiedAt: "2026-09-06T00:00:00.000Z",
      },
    }), {
      capability: "import_series", reporterCountry: "MY", hsRevision: "HS17", frequency: "annual",
      hasKey: true, quotaState: "available", persistentIngestion: true,
    })).toEqual({ ok: false, reason: "storage_not_approved" });
  });

  it("assertion guard throws a stable typed reason before an adapter can execute", () => {
    expect(() => assertFreeMarketProviderExecution(descriptor(), {
      capability: "import_series", reporterCountry: "MY", hsRevision: "HS17", frequency: "annual",
      hasKey: false, quotaState: "available", persistentIngestion: true,
    })).toThrow(MarketProviderExecutionBlockedError);
  });
});

describe("MI1A provider ranking", () => {
  const canonical = descriptor({ providerId: "baci_oec", sourceTier: "B" });

  it("uses the bumped policy and stable canonical registry", () => {
    expect(MI_PROVIDER_SELECTION_VERSION).toBe("mi-select-v2");
    expect(CANONICAL_PROVIDER_BY_CAPABILITY.import_series).toBe("baci_oec");
  });

  it("lets Tier A authority beat the Tier B canonical provider", () => {
    const official = descriptor({ providerId: "official", sourceTier: "A" });
    expect(selectProvider([canonical, official], query({ hasKey: () => true }))?.descriptor.providerId).toBe("official");
  });

  it("uses canonical preference only after earlier quality dimensions tie", () => {
    const peer = descriptor({ providerId: "peer", sourceTier: "B" });
    expect(selectProvider([peer, canonical], query({ hasKey: () => true }))?.descriptor.providerId).toBe("baci_oec");
  });

  it("ranks HS compatibility, geography, recency, and quota before canonical preference", () => {
    const harmonizedCanonical = descriptor({
      providerId: "baci_oec",
      hsCompatibility: { HS17: "harmonized" },
    });
    const native = descriptor({ providerId: "native" });
    expect(selectProvider([harmonizedCanonical, native], query({ hasKey: () => true }))?.descriptor.providerId)
      .toBe("native");

    const globalCanonical = descriptor({ providerId: "baci_oec" });
    const countrySpecific = descriptor({
      providerId: "country_specific",
      geographicCoverage: { scope: "countries", reporterCountries: ["MY"] },
    });
    expect(selectProvider([globalCanonical, countrySpecific], query({ hasKey: () => true }))?.descriptor.providerId)
      .toBe("country_specific");

    const recent = descriptor({ providerId: "recent", latestPeriod: "2025" });
    expect(selectProvider([globalCanonical, recent], query({ hasKey: () => true }))?.descriptor.providerId)
      .toBe("recent");

    const available = descriptor({ providerId: "available", unknownQuotaSafe: true });
    expect(selectProvider([globalCanonical, available], query({
      hasKey: () => true,
      quotaState: (id) => id === "available" ? "available" : "unknown",
    }))?.descriptor.providerId).toBe("available");
  });

  it("uses provider id as the final deterministic tie-break", () => {
    const a = descriptor({ providerId: "alpha" });
    const z = descriptor({ providerId: "zulu" });
    expect(selectProvider([z, a], query({ hasKey: () => true }))?.descriptor.providerId).toBe("alpha");
  });
});

describe("MI1A BACI production descriptor", () => {
  it("records access facts and keeps source and distribution licences distinct", () => {
    expect(BACI_OEC_PROVIDER).toMatchObject({
      providerId: "baci_oec", displayName: "BACI via OEC BotMarket", costClass: "free",
      requiresKey: true, requiresCard: false, latestPeriod: "2024", countryCoding: "iso_alpha3",
      hsRevisions: ["HS17"], queryResultLimit: 1000,
    });
    expect(BACI_OEC_PROVIDER.license?.datasetSource).toBe("CEPII BACI");
    expect(BACI_OEC_PROVIDER.license?.datasetLicenseName).toBe("Etalab Open Licence 2.0");
    expect(BACI_OEC_PROVIDER.license?.distributionService).toBe("OEC BotMarket");
    expect(BACI_OEC_PROVIDER.license?.distributionCatalogLicenseName).toBe("CC BY 4.0");
    expect(BACI_OEC_PROVIDER.license?.serviceTermsVerified).toBe(false);
    expect(BACI_OEC_PROVIDER.license?.storageAllowed).toBe(false);
  });
});
