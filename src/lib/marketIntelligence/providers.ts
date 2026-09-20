import type { MarketProviderDescriptor } from "./types";

/** Current, verified BACI-through-BotMarket production metadata. */
const baciOecProvider: MarketProviderDescriptor = {
  providerId: "baci_oec",
  displayName: "BACI via OEC BotMarket",
  enabled: true,
  costClass: "free",
  requiresKey: true,
  requiresCard: false,
  quotaPolicy: "free_only_limited",
  unknownQuotaSafe: true,
  coverage: "Global annual bilateral trade; MDF's native-HS17 proof window is 2017-2024",
  geographicCoverage: { scope: "global" },
  latestPeriod: "2024",
  datasetUpdatedAt: "2026-01-30",
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
    datasetLicenseUrl: "https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf",
    datasetAttributionRequirement:
      "Attribute CEPII BACI and OEC BotMarket, cite Gaulier & Zignago (2010), identify the 202601 release and its 2024 latest period, link the sources and licences, and indicate MDF aggregation/normalization.",
    distributionService: "OEC BotMarket",
    distributionServiceTermsUrl: "https://oec.world/en/resources/terms",
    distributionCatalogLicenseName: "CC BY 4.0",
    serviceTermsVerified: true,
    storageAllowed: true,
    redistributionAllowed: false,
    licenceVerifiedAt: "2026-09-20T00:00:00.000Z",
    licenceVerificationNote:
      "Verified for MDF internal institutional use only. CEPII labels BACI Etalab 2.0; BotMarket labels baci-hs17 CC BY 4.0. OEC terms last updated 2026-05-14 allow internal use but exclude dissemination outside the institutional unit, so MDF persistence is approved and redistribution remains disabled.",
  },
};

export const BACI_OEC_PROVIDER: MarketProviderDescriptor = Object.freeze(baciOecProvider);

export const MARKET_PROVIDER_DESCRIPTORS: readonly MarketProviderDescriptor[] = Object.freeze([
  BACI_OEC_PROVIDER,
]);
