import type {
  BuyerCandidateRecord,
  BuyerFinderSearchQuery,
  ContactPriorityId,
} from "@/lib/buyerFinder/types";

const RECORDS: BuyerCandidateRecord[] = [
  {
    candidate: {
      id: "cand-abc-foods",
      companyName: "ABC Foods Thailand",
      website: "https://abcfoods.example",
      domain: "abcfoods.example",
      country: "Thailand",
      city: "Bangkok",
      industry: "Food ingredients",
      buyerType: "Importer · Distributor",
      companyLinkedinUrl: "https://www.linkedin.com/company/abc-foods-example",
      companyScore: 91,
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "mock",
    },
    contacts: [
      {
        id: "ctc-abc-somchai",
        candidateId: "cand-abc-foods",
        firstName: "Somchai",
        lastName: "Example",
        fullName: "Somchai Example",
        jobTitle: "Procurement Manager",
        businessEmail: "somchai@abcfoods.example",
        emailStatus: "valid",
        emailConfidence: 96,
        linkedinUrl: "https://www.linkedin.com/in/somchai-example",
        contactScore: 95,
        isPrimary: true,
        source: "mock",
      },
      {
        id: "ctc-abc-niran",
        candidateId: "cand-abc-foods",
        firstName: "Niran",
        lastName: "Example",
        fullName: "Niran Example",
        jobTitle: "Import Manager",
        businessEmail: "niran@abcfoods.example",
        emailStatus: "accept_all",
        emailConfidence: 62,
        linkedinUrl: "https://www.linkedin.com/in/niran-example",
        contactScore: 78,
        isPrimary: false,
        source: "mock",
      },
      {
        id: "ctc-abc-mali",
        candidateId: "cand-abc-foods",
        firstName: "Mali",
        lastName: "Example",
        fullName: "Mali Example",
        jobTitle: "Managing Director",
        businessEmail: "mali@abcfoods.example",
        emailStatus: "unverified",
        emailConfidence: 40,
        contactScore: 71,
        isPrimary: false,
        source: "mock",
      },
    ],
    productMatches: [
      {
        id: "match-abc-chilli",
        candidateId: "cand-abc-foods",
        productKey: "guntur-chilli",
        relevance: 94,
        source: "mock",
        evidence: [
          {
            note: "Product catalogue lists dried red chilli and chilli powder among imported spices.",
            url: "https://abcfoods.example/products",
            confidence: 90,
          },
          {
            note: "Company describes itself as a Thai importer of Indian spices for food manufacturing.",
            url: "https://abcfoods.example/about",
            confidence: 84,
          },
        ],
      },
      {
        id: "match-abc-mango",
        candidateId: "cand-abc-foods",
        productKey: "banganapalli-mango",
        relevance: 71,
        source: "mock",
        evidence: [
          {
            note: "Seasonal fresh-produce page mentions Indian mango programmes.",
            url: "https://abcfoods.example/fresh",
            confidence: 68,
          },
        ],
      },
    ],
  },
  {
    candidate: {
      id: "cand-chao-phraya",
      companyName: "Chao Phraya Spice Co.",
      website: "https://chaophrayaspice.example",
      domain: "chaophrayaspice.example",
      country: "Thailand",
      city: "Samut Sakhon",
      industry: "Spice importer",
      buyerType: "Importer",
      companyLinkedinUrl: "https://www.linkedin.com/company/chao-phraya-spice-example",
      companyScore: 86,
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "mock",
    },
    contacts: [
      {
        id: "ctc-cps-arun",
        candidateId: "cand-chao-phraya",
        firstName: "Arun",
        lastName: "Example",
        fullName: "Arun Example",
        jobTitle: "Purchasing Manager",
        businessEmail: "arun@chaophrayaspice.example",
        emailStatus: "valid",
        emailConfidence: 91,
        linkedinUrl: "https://www.linkedin.com/in/arun-example",
        contactScore: 90,
        isPrimary: true,
        source: "mock",
      },
      {
        id: "ctc-cps-kanya",
        candidateId: "cand-chao-phraya",
        firstName: "Kanya",
        lastName: "Example",
        fullName: "Kanya Example",
        jobTitle: "Sourcing Manager",
        businessEmail: "kanya@chaophrayaspice.example",
        emailStatus: "unverified",
        emailConfidence: 48,
        contactScore: 74,
        isPrimary: false,
        source: "mock",
      },
    ],
    productMatches: [
      {
        id: "match-cps-chilli",
        candidateId: "cand-chao-phraya",
        productKey: "guntur-chilli",
        relevance: 88,
        source: "mock",
        evidence: [
          {
            note: "Wholesale spice list includes stemless dry red chilli from India.",
            url: "https://chaophrayaspice.example/spices",
            confidence: 86,
          },
        ],
      },
    ],
  },
  {
    candidate: {
      id: "cand-krungthep",
      companyName: "Krungthep Fresh Imports",
      website: "https://krungthepfresh.example",
      domain: "krungthepfresh.example",
      country: "Thailand",
      city: "Bangkok",
      industry: "Wholesale produce",
      buyerType: "Importer · Wholesaler",
      companyLinkedinUrl: "https://www.linkedin.com/company/krungthep-fresh-example",
      companyScore: 82,
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "mock",
    },
    contacts: [
      {
        id: "ctc-kfi-pim",
        candidateId: "cand-krungthep",
        firstName: "Pim",
        lastName: "Example",
        fullName: "Pim Example",
        jobTitle: "Import Manager",
        businessEmail: "pim@krungthepfresh.example",
        emailStatus: "valid",
        emailConfidence: 88,
        linkedinUrl: "https://www.linkedin.com/in/pim-example",
        contactScore: 87,
        isPrimary: true,
        source: "mock",
      },
      {
        id: "ctc-kfi-owner",
        candidateId: "cand-krungthep",
        firstName: "Somsak",
        lastName: "Example",
        fullName: "Somsak Example",
        jobTitle: "Owner",
        businessEmail: "somsak@krungthepfresh.example",
        emailStatus: "unverified",
        emailConfidence: 35,
        contactScore: 64,
        isPrimary: false,
        source: "mock",
      },
    ],
    productMatches: [
      {
        id: "match-kfi-pome",
        candidateId: "cand-krungthep",
        productKey: "pomegranate",
        relevance: 85,
        source: "mock",
        evidence: [
          {
            note: "Import programme page lists Indian pomegranate as a winter SKU.",
            url: "https://krungthepfresh.example/imports",
            confidence: 82,
          },
        ],
      },
      {
        id: "match-kfi-mango",
        candidateId: "cand-krungthep",
        productKey: "banganapalli-mango",
        relevance: 79,
        source: "mock",
        evidence: [
          {
            note: "Seasonal mango flyer names Banganapalli among Indian origins.",
            url: "https://krungthepfresh.example/mango",
            confidence: 76,
          },
        ],
      },
    ],
  },
  {
    candidate: {
      id: "cand-siam-produce",
      companyName: "Siam Produce Trading",
      website: "https://siamproduce.example",
      domain: "siamproduce.example",
      country: "Thailand",
      city: "Chiang Mai",
      industry: "Wholesale produce",
      buyerType: "Distributor · Wholesaler",
      companyScore: 74,
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "mock",
    },
    contacts: [
      {
        id: "ctc-spt-dao",
        candidateId: "cand-siam-produce",
        firstName: "Dao",
        lastName: "Example",
        fullName: "Dao Example",
        jobTitle: "Sourcing Manager",
        businessEmail: "dao@siamproduce.example",
        emailStatus: "accept_all",
        emailConfidence: 55,
        contactScore: 72,
        isPrimary: true,
        source: "mock",
      },
    ],
    productMatches: [
      {
        id: "match-spt-apple",
        candidateId: "cand-siam-produce",
        productKey: "indian-apple",
        relevance: 77,
        source: "mock",
        evidence: [
          {
            note: "Northern wholesale board lists Indian apples among imported fruit.",
            url: "https://siamproduce.example/fruit",
            confidence: 74,
          },
        ],
      },
      {
        id: "match-spt-chilli",
        candidateId: "cand-siam-produce",
        productKey: "guntur-chilli",
        relevance: 61,
        source: "mock",
        evidence: [
          {
            note: "Dry-goods assortment includes chilli, though spice is a secondary line.",
            confidence: 58,
          },
        ],
      },
    ],
  },
  {
    candidate: {
      id: "cand-mekong",
      companyName: "Mekong Ingredient House",
      website: "https://mekongingredients.example",
      domain: "mekongingredients.example",
      country: "Thailand",
      city: "Nonthaburi",
      industry: "Food ingredients",
      buyerType: "Distributor",
      companyLinkedinUrl: "https://www.linkedin.com/company/mekong-ingredient-example",
      companyScore: 68,
      discoveryStatus: "enriching",
      reviewStatus: "needs_another_contact",
      source: "mock",
    },
    contacts: [
      {
        id: "ctc-mih-info",
        candidateId: "cand-mekong",
        firstName: "",
        lastName: "",
        fullName: "General inbox",
        jobTitle: "Sales",
        businessEmail: "info@mekongingredients.example",
        emailStatus: "unverified",
        emailConfidence: 22,
        contactScore: 31,
        isPrimary: true,
        source: "mock",
      },
    ],
    productMatches: [
      {
        id: "match-mih-chilli",
        candidateId: "cand-mekong",
        productKey: "guntur-chilli",
        relevance: 70,
        source: "mock",
        evidence: [
          {
            note: "Ingredient catalogue includes chilli powder for food processors.",
            url: "https://mekongingredients.example/catalogue",
            confidence: 66,
          },
        ],
      },
    ],
  },
  {
    candidate: {
      id: "cand-gulf-foods",
      companyName: "Gulf Foods Trading",
      website: "https://gulffoodstrading.example",
      domain: "gulffoodstrading.example",
      country: "United Arab Emirates",
      city: "Dubai",
      industry: "Food ingredients",
      buyerType: "Importer · Distributor",
      companyScore: 80,
      discoveryStatus: "ready",
      reviewStatus: "pending",
      source: "mock",
    },
    contacts: [
      {
        id: "ctc-gft-fatima",
        candidateId: "cand-gulf-foods",
        firstName: "Fatima",
        lastName: "Example",
        fullName: "Fatima Example",
        jobTitle: "Procurement Manager",
        businessEmail: "fatima@gulffoodstrading.example",
        emailStatus: "valid",
        emailConfidence: 93,
        linkedinUrl: "https://www.linkedin.com/in/fatima-example",
        contactScore: 92,
        isPrimary: true,
        source: "mock",
      },
    ],
    productMatches: [
      {
        id: "match-gft-chilli",
        candidateId: "cand-gulf-foods",
        productKey: "guntur-chilli",
        relevance: 83,
        source: "mock",
        evidence: [
          {
            note: "GCC import listing includes Indian dry red chilli for foodservice.",
            url: "https://gulffoodstrading.example/spices",
            confidence: 80,
          },
        ],
      },
    ],
  },
];

const ROLE_MATCHERS: Record<ContactPriorityId, RegExp> = {
  procurement: /procurement/i,
  purchasing: /purchasing/i,
  import: /import/i,
  sourcing: /sourcing/i,
  "managing-director": /managing director/i,
  owner: /owner|founder/i,
};

export function listMockCandidates(): BuyerCandidateRecord[] {
  return RECORDS;
}

export function getMockCandidate(id: string): BuyerCandidateRecord | undefined {
  return RECORDS.find((r) => r.candidate.id === id);
}

export function searchMockCandidates(query: BuyerFinderSearchQuery): BuyerCandidateRecord[] {
  return RECORDS.filter((record) => {
    const { candidate, contacts, productMatches } = record;
    if (query.country && candidate.country !== query.country) return false;
    if (query.productKey && !productMatches.some((m) => m.productKey === query.productKey)) {
      return false;
    }
    if (query.buyerType && !(candidate.buyerType ?? "").includes(query.buyerType)) return false;
    if (query.industry && candidate.industry !== query.industry) return false;
    if (query.contactPriorities.length > 0) {
      const matched = contacts.some((c) =>
        query.contactPriorities.some((p) => ROLE_MATCHERS[p].test(c.jobTitle)),
      );
      if (!matched) return false;
    }
    return true;
  });
}

export function uniqueMockCountries(): string[] {
  return Array.from(new Set(RECORDS.map((r) => r.candidate.country))).sort();
}

export function uniqueMockIndustries(): string[] {
  return Array.from(
    new Set(RECORDS.map((r) => r.candidate.industry).filter((v): v is string => !!v)),
  ).sort();
}

export function primaryContact(record: BuyerCandidateRecord) {
  return record.contacts.find((c) => c.isPrimary) ?? record.contacts[0];
}

export function otherContacts(record: BuyerCandidateRecord) {
  const primary = primaryContact(record);
  return record.contacts.filter((c) => c.id !== primary?.id);
}
