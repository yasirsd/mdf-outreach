import type { MarketProviderDescriptor } from "./types";

/**
 * Production metadata for the future BACI adapter. No network adapter exists
 * in MI1A. Persistent execution remains blocked because BotMarket service
 * terms have not yet been reviewed and approved for MDF storage.
 */
const baciOecProvider: MarketProviderDescriptor = {
  providerId: "baci_oec",
  displayName: "BACI via OEC BotMarket",
  enabled: true,
  costClass: "free",
  requiresKey: true,
  requiresCard: false,
  quotaPolicy: "free_only_limited",
  unknownQuotaSafe: true,
  coverage: "Global annual bilateral trade",
  geographicCoverage: { scope: "global" },
  latestPeriod: "2024",
  frequency: ["annual"],
  capabilities: ["import_series", "partner_series", "origin_breakdown"],
  sourceTier: "B",
  countryCoding: "iso_alpha3",
  hsRevisions: ["HS17"],
  hsCompatibility: { HS17: "native" },
  queryResultLimit: 1000,
  license: {
    datasetSource: "CEPII BACI",
    datasetLicenseName: "Etalab Open Licence 2.0",
    datasetLicenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    datasetAttributionRequirement: "Attribute CEPII BACI and preserve its source identity.",
    distributionService: "OEC BotMarket",
    distributionCatalogLicenseName: "CC BY 4.0",
    serviceTermsVerified: false,
    storageAllowed: false,
    redistributionAllowed: false,
    licenceVerificationNote:
      "Underlying dataset and catalog licence statements are recorded separately. BotMarket access-service terms still require operator review before persistent ingestion.",
  },
};

export const BACI_OEC_PROVIDER: MarketProviderDescriptor = Object.freeze(baciOecProvider);

export const MARKET_PROVIDER_DESCRIPTORS: readonly MarketProviderDescriptor[] = Object.freeze([
  BACI_OEC_PROVIDER,
]);
