import type { ProductKey } from "@/lib/email/themes/types";
import type {
  BuyerTypeOption,
  CandidateEvidence,
  ContactPriorityId,
  EmailStatus,
} from "@/lib/buyerFinder/types";

/** Discovery query for company providers. Uses existing MDF ProductKey only. */
export interface CompanyDiscoveryQuery {
  country: string;
  productKey: ProductKey;
  buyerTypes?: BuyerTypeOption[];
  industry?: string;
  limit?: number;
  contactPriorities?: ContactPriorityId[];
}

export interface DiscoveredCompany {
  providerRecordId: string;
  companyName: string;
  website?: string;
  domain?: string;
  country: string;
  city?: string;
  industry?: string;
  buyerType?: string;
  isImporter?: boolean;
  isDistributor?: boolean;
  companyLinkedinUrl?: string;
  generalEmail?: string;
  evidence: CandidateEvidence[];
  source: "mock";
  sourceUrl?: string;
  /** Relevance of this company to the query product (0–100). */
  productRelevance?: number;
}

export interface CompanyDiscoveryProvider {
  discover(query: CompanyDiscoveryQuery): Promise<DiscoveredCompany[]>;
}

export interface DiscoveredContact {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  jobTitle: string;
  businessEmail?: string;
  emailStatus?: EmailStatus;
  emailConfidence?: number;
  linkedinUrl?: string;
  source: "mock";
}

export interface ContactEnrichmentRequest {
  company: DiscoveredCompany;
  roles?: ContactPriorityId[];
}

export interface ContactEnrichmentProvider {
  findContacts(input: ContactEnrichmentRequest): Promise<DiscoveredContact[]>;
}
