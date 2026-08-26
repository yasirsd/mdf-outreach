import "server-only";

import type { ProductKey } from "@/lib/email/themes/types";
import type { BuyerTypeOption } from "@/lib/buyerFinder/types";
import { blankToUndefined } from "@/lib/buyerFinder/normalize";
import type { CompanyDiscoveryProvider, CompanyDiscoveryQuery, DiscoveredCompany } from "../types";

interface MockCompanySeed {
  providerRecordId: string;
  companyName: string;
  website: string;
  domain: string;
  country: string;
  city: string;
  industry: string;
  buyerType: string;
  isImporter: boolean;
  isDistributor: boolean;
  companyLinkedinUrl: string;
  generalEmail: string;
  productKeys: ProductKey[];
  relevanceByProduct: Partial<Record<ProductKey, number>>;
  evidenceNote: string;
}

/**
 * Static fake companies. Domains are `.example` only.
 * Sorted by providerRecordId for deterministic output.
 */
const MOCK_COMPANIES: MockCompanySeed[] = [
  {
    providerRecordId: "mock-ae-desert-fruit",
    companyName: "Desert Fruit Importers",
    website: "https://desert-fruit.example",
    domain: "desert-fruit.example",
    country: "UAE",
    city: "Dubai",
    industry: "Fresh produce import",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: false,
    companyLinkedinUrl: "https://www.linkedin.com/company/desert-fruit-example",
    generalEmail: "info@desert-fruit.example",
    productKeys: ["pomegranate"],
    relevanceByProduct: { pomegranate: 90 },
    evidenceNote: "Mock directory lists pomegranate import for UAE wholesale.",
  },
  {
    providerRecordId: "mock-ae-emirates-fresh",
    companyName: "Emirates Fresh Produce",
    website: "https://emirates-fresh.example",
    domain: "emirates-fresh.example",
    country: "UAE",
    city: "Dubai",
    industry: "Food distribution",
    buyerType: "Distributor",
    isImporter: false,
    isDistributor: true,
    companyLinkedinUrl: "https://www.linkedin.com/company/emirates-fresh-example",
    generalEmail: "sales@emirates-fresh.example",
    productKeys: ["banganapalli-mango", "pomegranate"],
    relevanceByProduct: { "banganapalli-mango": 70, pomegranate: 65 },
    evidenceNote: "Mock catalogue includes mango and pomegranate distribution.",
  },
  {
    providerRecordId: "mock-ae-gulf-spice",
    companyName: "Gulf Spice Trading",
    website: "https://gulf-spice.example",
    domain: "gulf-spice.example",
    country: "UAE",
    city: "Sharjah",
    industry: "Food spices",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: false,
    companyLinkedinUrl: "https://www.linkedin.com/company/gulf-spice-example",
    generalEmail: "purchasing@gulf-spice.example",
    productKeys: ["guntur-chilli"],
    relevanceByProduct: { "guntur-chilli": 83 },
    evidenceNote: "Mock listing: dried chilli importer serving Gulf foodservice.",
  },
  {
    providerRecordId: "mock-th-bangkok-chilli",
    companyName: "Bangkok Chilli Trading",
    website: "https://bangkok-chilli.example",
    domain: "bangkok-chilli.example",
    country: "Thailand",
    city: "Bangkok",
    industry: "Food ingredients",
    buyerType: "Distributor",
    isImporter: false,
    isDistributor: true,
    companyLinkedinUrl: "https://www.linkedin.com/company/bangkok-chilli-example",
    generalEmail: "hello@bangkok-chilli.example",
    productKeys: ["guntur-chilli"],
    relevanceByProduct: { "guntur-chilli": 80 },
    evidenceNote: "Mock Thai distributor catalogue lists dried red chilli.",
  },
  {
    providerRecordId: "mock-th-chaophraya",
    companyName: "Chao Phraya Foods Co., Ltd.",
    website: "https://chaophraya-foods.example",
    domain: "chaophraya-foods.example",
    country: "Thailand",
    city: "Ayutthaya",
    industry: "Food import",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: false,
    companyLinkedinUrl: "https://www.linkedin.com/company/chaophraya-foods-example",
    generalEmail: "info@chaophraya-foods.example",
    productKeys: ["guntur-chilli"],
    relevanceByProduct: { "guntur-chilli": 85 },
    evidenceNote: "Mock importer profile mentions spice and chilli procurement.",
  },
  {
    providerRecordId: "mock-th-mango-house",
    companyName: "Thai Mango House",
    website: "https://thai-mango-house.example",
    domain: "thai-mango-house.example",
    country: "Thailand",
    city: "Chanthaburi",
    industry: "Fresh produce",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: false,
    companyLinkedinUrl: "https://www.linkedin.com/company/thai-mango-house-example",
    generalEmail: "buy@thai-mango-house.example",
    productKeys: ["banganapalli-mango"],
    relevanceByProduct: { "banganapalli-mango": 88 },
    evidenceNote: "Mock produce trader focused on mango import programmes.",
  },
  {
    providerRecordId: "mock-th-pom-importers",
    companyName: "Ayutthaya Pom Imports",
    website: "https://ayutthaya-pom.example",
    domain: "ayutthaya-pom.example",
    country: "Thailand",
    city: "Ayutthaya",
    industry: "Fresh produce",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: false,
    companyLinkedinUrl: "https://www.linkedin.com/company/ayutthaya-pom-example",
    generalEmail: "trade@ayutthaya-pom.example",
    productKeys: ["pomegranate"],
    relevanceByProduct: { pomegranate: 74 },
    evidenceNote: "Mock seasonal pomegranate import listing.",
  },
  {
    providerRecordId: "mock-th-siam-spice",
    companyName: "Siam Spice Imports",
    website: "https://siam-spice.example",
    domain: "siam-spice.example",
    country: "Thailand",
    city: "Bangkok",
    industry: "Food Import & Distribution",
    buyerType: "Importer",
    isImporter: true,
    isDistributor: true,
    companyLinkedinUrl: "https://www.linkedin.com/company/siam-spice-example",
    generalEmail: "purchasing@siam-spice.example",
    productKeys: ["guntur-chilli", "banganapalli-mango"],
    relevanceByProduct: { "guntur-chilli": 92, "banganapalli-mango": 78 },
    evidenceNote: "Mock Thai importer/distributor of spices and tropical fruit.",
  },
];

function countryMatches(seed: MockCompanySeed, country: string): boolean {
  return seed.country.toLowerCase() === country.trim().toLowerCase();
}

function industryMatches(seed: MockCompanySeed, industry: string | undefined): boolean {
  const q = blankToUndefined(industry)?.toLowerCase();
  if (!q) return true;
  return seed.industry.toLowerCase().includes(q);
}

function buyerTypeMatches(seed: MockCompanySeed, types: BuyerTypeOption[] | undefined): boolean {
  if (!types || types.length === 0) return true;
  return types.some((t) => {
    if (t === "Importer") return seed.isImporter || /importer/i.test(seed.buyerType);
    if (t === "Distributor") return seed.isDistributor || /distributor/i.test(seed.buyerType);
    return new RegExp(t, "i").test(seed.buyerType);
  });
}

function toHit(seed: MockCompanySeed, productKey: ProductKey): DiscoveredCompany {
  return {
    providerRecordId: seed.providerRecordId,
    companyName: seed.companyName,
    website: seed.website,
    domain: seed.domain,
    country: seed.country,
    city: seed.city,
    industry: seed.industry,
    buyerType: seed.buyerType,
    isImporter: seed.isImporter,
    isDistributor: seed.isDistributor,
    companyLinkedinUrl: seed.companyLinkedinUrl,
    generalEmail: seed.generalEmail,
    source: "mock",
    productRelevance: seed.relevanceByProduct[productKey] ?? 50,
    evidence: [
      {
        note: seed.evidenceNote,
        confidence: seed.relevanceByProduct[productKey] ?? 50,
        url: `${seed.website}/products`,
      },
    ],
  };
}

export function createMockCompanyDiscoveryProvider(options?: {
  fail?: boolean;
}): CompanyDiscoveryProvider {
  return {
    async discover(query: CompanyDiscoveryQuery): Promise<DiscoveredCompany[]> {
      if (options?.fail) {
        throw new Error("Mock company discovery failed");
      }
      const country = blankToUndefined(query.country);
      if (!country) return [];
      const limitRaw = query.limit;
      const limit =
        limitRaw == null || !Number.isFinite(limitRaw) ? 20 : Math.max(0, Math.floor(limitRaw));

      return MOCK_COMPANIES.filter(
        (s) =>
          countryMatches(s, country) &&
          s.productKeys.includes(query.productKey) &&
          buyerTypeMatches(s, query.buyerTypes) &&
          industryMatches(s, query.industry),
      )
        .slice(0, limit)
        .map((s) => toHit(s, query.productKey));
    },
  };
}
