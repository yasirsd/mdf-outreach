import type {
  BuyerTypeOption,
  CandidateEvidence,
  CandidateSource,
  ContactPriorityId,
  EmailStatus,
  PublicMailboxKind,
  PublicMailboxType,
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

/**
 * BF3A.5 — free public company-contact discovery from the company's
 * own website. Distinct from Hunter person discovery and from paid
 * email reveal. Never guesses addresses.
 */
export interface CompanyContactDiscoveryQuery {
  candidateId: string;
  website?: string;
  domain?: string;
}

export interface DiscoveredPublicCompanyEmail {
  email: string;
  mailboxType: PublicMailboxType;
  mailboxKind: PublicMailboxKind;
  source: "company_website";
  sourceUrl: string;
  /** Lower is better. Contact pages beat homepages. */
  pageQuality: number;
}

export type CompanyContactDiscoveryOutcome =
  | "ok"
  | "no_result"
  | "incomplete"
  | "unavailable"
  | "blocked"
  | "timeout"
  | "invalid_input";

/** Server-only per-page attempt. Never sent to the browser. */
export type PublicPageAttemptOutcome =
  | "fetched"
  | "blocked_by_robots"
  | "timeout"
  | "http_error"
  | "invalid_content_type"
  | "too_large"
  | "security_rejected";

export type PublicTransportStage = "dns" | "connect" | "tls" | "redirect" | "headers" | "body";

export type PublicRedirectOutcome =
  | "followed"
  | "dns"
  | "connect"
  | "tls"
  | "rejected"
  | "timeout"
  | "unavailable"
  | "headers"
  | "body";

export interface PublicPageAttempt {
  url: string;
  outcome: PublicPageAttemptOutcome;
  statusCode?: number;
  bytesRead?: number;
  emailsExtracted: number;
  linksDiscovered: number;
  contentType?: string;
  contentEncoding?: string;
  /** Dev diagnostics only. Never includes IPs, certs, or query secrets. */
  transportStage?: PublicTransportStage;
  safeErrorCode?: string;
  redirectOccurred?: boolean;
  redirectTargetHost?: string;
  redirectTargetPath?: string;
  redirectOutcome?: PublicRedirectOutcome;
}

export interface CompanyContactDiscoveryResult {
  emails: DiscoveredPublicCompanyEmail[];
  pagesFetched: number;
  outcome: CompanyContactDiscoveryOutcome;
  /** Development/tests only. Action layer must not return this to the client. */
  pageAttempts?: PublicPageAttempt[];
  rankedPagePaths?: string[];
  selectedPagePaths?: string[];
  preferredOrigin?: string;
  alternateOriginAttempted?: boolean;
  observedWorkingOrigin?: string;
  staticClientRedirectsDiscovered?: number;
  selectedClientRedirect?: string;
  clientRedirectAttempted?: boolean;
  clientRedirectOutcome?: string;
}

export interface CompanyContactDiscoveryProvider {
  discover(query: CompanyContactDiscoveryQuery): Promise<CompanyContactDiscoveryResult>;
}

/**
 * BF3B — paid personal contact reveal. Distinct from free masked
 * person discovery and from Domain Search / Email Finder enrichment.
 * Server-only input: the persisted opaque provider reference.
 */
export interface PersonalContactRevealRequest {
  /** Opaque provider person reference. Server-only. Never from the browser. */
  providerRef: string;
}

export type PersonalRevealHandleOutcome =
  | "revealed"
  | "already_revealed"
  | "not_found"
  | "insufficient_credits";

export interface RevealedPersonalContactDetails {
  firstName?: string;
  lastName?: string;
  position?: string;
  email?: string;
  phoneNumber?: string;
  linkedinUrl?: string;
  type?: "personal" | "generic";
  domain?: string;
}

export type PersonalContactRevealCallOutcome =
  | PersonalRevealHandleOutcome
  | "invalid_response"
  | "contract_violation"
  | "quota_exhausted"
  | "rate_limited";

export interface PersonalContactRevealResult {
  outcome: PersonalContactRevealCallOutcome;
  /** Authoritative provider cost. 0 or 1 for a successful one-handle reveal. */
  creditsCharged: number | null;
  handleOutcome?: PersonalRevealHandleOutcome;
  person?: RevealedPersonalContactDetails;
}

export interface PersonalContactRevealProvider {
  readonly id: "hunter";
  readonly capability: "personal_contact_reveal";
  readonly costKind: "paid";
  readonly maximumCreditsPerAction: 1;
  reveal(input: PersonalContactRevealRequest): Promise<PersonalContactRevealResult>;
}
