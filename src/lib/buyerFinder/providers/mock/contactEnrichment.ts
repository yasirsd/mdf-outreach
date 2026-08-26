import "server-only";

import type { ContactPriorityId } from "@/lib/buyerFinder/types";
import type {
  ContactEnrichmentProvider,
  ContactEnrichmentRequest,
  DiscoveredContact,
} from "../types";

interface MockContactSeed extends DiscoveredContact {
  companyRecordId: string;
}

const MOCK_CONTACTS: MockContactSeed[] = [
  {
    companyRecordId: "mock-ae-desert-fruit",
    firstName: "Layla",
    lastName: "Mock",
    fullName: "Layla Mock",
    jobTitle: "Import Manager",
    businessEmail: "import@desert-fruit.example",
    emailStatus: "valid",
    emailConfidence: 88,
    source: "mock",
  },
  {
    companyRecordId: "mock-ae-emirates-fresh",
    firstName: "Omar",
    lastName: "Mock",
    fullName: "Omar Mock",
    jobTitle: "Managing Director",
    businessEmail: "md@emirates-fresh.example",
    emailStatus: "unverified",
    emailConfidence: 40,
    linkedinUrl: "https://www.linkedin.com/in/omar-mock-example",
    source: "mock",
  },
  {
    companyRecordId: "mock-ae-gulf-spice",
    firstName: "Noor",
    lastName: "Mock",
    fullName: "Noor Mock",
    jobTitle: "Sourcing Manager",
    businessEmail: "sourcing@gulf-spice.example",
    emailStatus: "valid",
    emailConfidence: 90,
    source: "mock",
  },
  {
    companyRecordId: "mock-ae-gulf-spice",
    firstName: "Hassan",
    lastName: "Mock",
    fullName: "Hassan Mock",
    jobTitle: "Owner",
    businessEmail: "owner@gulf-spice.example",
    emailStatus: "accept_all",
    emailConfidence: 55,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-bangkok-chilli",
    firstName: "Krit",
    lastName: "Mock",
    fullName: "Krit Mock",
    jobTitle: "Operations Manager",
    businessEmail: "ops@bangkok-chilli.example",
    emailStatus: "unverified",
    emailConfidence: 35,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-bangkok-chilli",
    firstName: "Pranee",
    lastName: "Mock",
    fullName: "Pranee Mock",
    jobTitle: "Procurement Manager",
    businessEmail: "procurement@bangkok-chilli.example",
    emailStatus: "valid",
    emailConfidence: 94,
    linkedinUrl: "https://www.linkedin.com/in/pranee-mock-example",
    source: "mock",
  },
  {
    companyRecordId: "mock-th-chaophraya",
    firstName: "Somsak",
    lastName: "Mock",
    fullName: "Somsak Mock",
    jobTitle: "Owner",
    businessEmail: "owner@chaophraya-foods.example",
    emailStatus: "valid",
    emailConfidence: 80,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-mango-house",
    firstName: "Anong",
    lastName: "Mock",
    fullName: "Anong Mock",
    jobTitle: "Purchasing Manager",
    businessEmail: "purchasing@thai-mango-house.example",
    emailStatus: "valid",
    emailConfidence: 91,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-pom-importers",
    firstName: "Nid",
    lastName: "Mock",
    fullName: "Nid Mock",
    jobTitle: "Procurement Manager",
    businessEmail: "procurement@ayutthaya-pom.example",
    emailStatus: "accept_all",
    emailConfidence: 60,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-pom-importers",
    firstName: "Bee",
    lastName: "Mock",
    fullName: "Bee Mock",
    jobTitle: "Sales Manager",
    businessEmail: "sales@ayutthaya-pom.example",
    emailStatus: "unverified",
    emailConfidence: 30,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-siam-spice",
    firstName: "Arun",
    lastName: "Mock",
    fullName: "Arun Mock",
    jobTitle: "Procurement Manager",
    businessEmail: "procurement@siam-spice.example",
    emailStatus: "valid",
    emailConfidence: 96,
    linkedinUrl: "https://www.linkedin.com/in/arun-mock-example",
    source: "mock",
  },
  {
    companyRecordId: "mock-th-siam-spice",
    firstName: "Malee",
    lastName: "Mock",
    fullName: "Malee Mock",
    jobTitle: "Import Manager",
    businessEmail: "import@siam-spice.example",
    emailStatus: "accept_all",
    emailConfidence: 62,
    source: "mock",
  },
  {
    companyRecordId: "mock-th-siam-spice",
    firstName: "Wichai",
    lastName: "Mock",
    fullName: "Wichai Mock",
    jobTitle: "Managing Director",
    businessEmail: "md@siam-spice.example",
    emailStatus: "unverified",
    emailConfidence: 40,
    source: "mock",
  },
];

function roleMatches(title: string, role: ContactPriorityId): boolean {
  const t = title.toLowerCase();
  switch (role) {
    case "procurement":
      return /\bprocurement\b/.test(t);
    case "purchasing":
      return /\bpurchas(e|ing)\b/.test(t);
    case "import":
      return /\bimport\b/.test(t);
    case "sourcing":
      return /\bsourcing\b/.test(t);
    case "managing-director":
      return /\bmanaging director\b/.test(t);
    case "owner":
      return /\b(owner|founder)\b/.test(t);
    default:
      return false;
  }
}

function withoutCompanyId(seed: MockContactSeed): DiscoveredContact {
  const { companyRecordId: _id, ...contact } = seed;
  return contact;
}

export function createMockContactEnrichmentProvider(options?: {
  failForProviderRecordId?: string;
}): ContactEnrichmentProvider {
  return {
    async findContacts(input: ContactEnrichmentRequest): Promise<DiscoveredContact[]> {
      const id = input.company.providerRecordId;
      if (options?.failForProviderRecordId && options.failForProviderRecordId === id) {
        throw new Error(`Mock contact enrichment failed for ${id}`);
      }
      const all = MOCK_CONTACTS.filter((c) => c.companyRecordId === id).map(withoutCompanyId);
      const roles = input.roles ?? [];
      if (roles.length === 0) return all;
      const matched = all.filter((c) => roles.some((r) => roleMatches(c.jobTitle, r)));
      return matched.length > 0 ? matched : all;
    },
  };
}
