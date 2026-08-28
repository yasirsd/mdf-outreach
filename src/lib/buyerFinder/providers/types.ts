import type {
  BuyerTypeOption,
  CandidateEvidence,
  CandidateSource,
  ContactPriorityId,
  EmailStatus,
} from "@/lib/buyerFinder/types";

/**
 * BF2.1 — Provider layer speaks in BUSINESS product ids only.
 *
 * The Buyer Finder domain is decoupled from `@/lib/email/themes/*`.
 * Business ids come from `@/lib/catalogue/products.ts`; the email theme
 * bridge lives only in `businessCatalogue.ts` and is used at display /
 * conversion boundaries — never inside providers.
 */
export type BusinessProductId = string;

export interface CompanyDiscoveryQuery {
  country: string;
  /** Business product id (e.g. "guntur-dry-red-chilli"). */
  productId: BusinessProductId;
  /**
   * Operator SEARCH INTENT. Passed to the provider as a hint only.
   * The provider MUST NOT infer factual `candidate.buyerType` /
   * `candidate.isImporter` / `candidate.isDistributor` from these values.
   */
  buyerTypes?: BuyerTypeOption[];
  industry?: string;
  limit?: number;
  contactPriorities?: ContactPriorityId[];
  /**
   * Hunter Discover keyword strategy only. Mock provider ignores this.
   * `product-led` omits generic import/export/logistics terms.
   */
  keywordIntent?: "product-led" | "food-trade" | "hybrid";
}

export interface DiscoveredCompany {
  providerRecordId: string;
  companyName: string;
  website?: string;
  domain?: string;
  country: string;
  city?: string;
  industry?: string;
  /**
   * FACT-only. The provider populates this only when its own evidence
   * says the company IS an importer/distributor. It is NOT the same as
   * the operator's search intent.
   */
  buyerType?: string;
  isImporter?: boolean;
  isDistributor?: boolean;
  companyLinkedinUrl?: string;
  generalEmail?: string;
  evidence: CandidateEvidence[];
  source: CandidateSource;
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
  source: CandidateSource;
}

export interface ContactEnrichmentRequest {
  company: DiscoveredCompany;
  roles?: ContactPriorityId[];
}

export interface ContactEnrichmentProvider {
  findContacts(input: ContactEnrichmentRequest): Promise<DiscoveredContact[]>;
}

/**
 * BF3A — free masked person discovery. Distinct from paid email reveal
 * (`ContactEnrichmentProvider` / email_enrichment).
 */
export interface PersonDiscoveryQuery {
  companyName: string;
  domain: string;
  limit?: number;
}

export interface MaskedPerson {
  /** Opaque provider reference. Server-only. Never an email. */
  providerRef: string;
  source: CandidateSource;
  domain: string;
  companyName?: string;
  maskedName: string;
  firstName?: string;
  lastName?: string;
  position: string;
  department?: string;
  seniority?: string;
  emailType?: "personal" | "generic";
  decisionMaker?: boolean;
  verificationStatus?: string;
  fullNameAvailable?: boolean;
  linkedinAvailable?: boolean;
  phoneAvailable?: boolean;
  evidence: CandidateEvidence[];
}

export interface PersonDiscoveryResult {
  people: MaskedPerson[];
  hasMore: boolean;
}

export interface PersonDiscoveryProvider {
  findPeople(query: PersonDiscoveryQuery): Promise<PersonDiscoveryResult>;
}
