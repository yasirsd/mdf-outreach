import type { ProductKey } from "@/lib/email/themes/types";

export type DiscoveryStatus = "new" | "enriching" | "ready" | "archived";

export type ReviewStatus = "pending" | "approved" | "rejected" | "needs_another_contact";

export type EmailStatus = "unverified" | "valid" | "invalid" | "accept_all";

export type CandidateSource = "mock" | "apollo" | "hunter" | "directory" | "website" | "other";

export const DISCOVERY_STATUS_LABELS: Record<DiscoveryStatus, string> = {
  new: "New",
  enriching: "Enriching",
  ready: "Ready",
  archived: "Archived",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  needs_another_contact: "Needs another contact",
};

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  unverified: "Unverified",
  valid: "Verified",
  invalid: "Invalid",
  accept_all: "Accept-all",
};

export interface CandidateEvidence {
  url?: string;
  note: string;
  confidence: number;
}

export interface BuyerCandidateContact {
  id: string;
  candidateId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string;
  businessEmail: string;
  emailStatus?: EmailStatus;
  emailConfidence?: number;
  linkedinUrl?: string;
  contactScore?: number;
  isPrimary: boolean;
  source?: CandidateSource | string;
  discoveredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BuyerCandidateProductMatch {
  id: string;
  candidateId: string;
  productKey: ProductKey;
  country?: string;
  query?: string;
  relevance?: number;
  evidence: CandidateEvidence[];
  source?: CandidateSource | string;
  discoveredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BuyerCandidate {
  id: string;
  companyName: string;
  website?: string;
  domain?: string;
  country: string;
  city?: string;
  address?: string;
  phone?: string;
  generalEmail?: string;
  companyLinkedinUrl?: string;
  industry?: string;
  buyerType?: string;
  source?: CandidateSource | string;
  sourceUrl?: string;
  isImporter?: boolean;
  isDistributor?: boolean;
  evidence?: CandidateEvidence[];
  companyScore?: number;
  discoveryStatus: DiscoveryStatus;
  reviewStatus: ReviewStatus;
  rejectionReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BuyerCandidateRecord {
  candidate: BuyerCandidate;
  contacts: BuyerCandidateContact[];
  productMatches: BuyerCandidateProductMatch[];
}

export const BUYER_TYPE_OPTIONS = ["Importer", "Distributor", "Wholesaler"] as const;
export type BuyerTypeOption = (typeof BUYER_TYPE_OPTIONS)[number];

export const CONTACT_PRIORITY_OPTIONS = [
  { id: "procurement", label: "Procurement" },
  { id: "purchasing", label: "Purchasing" },
  { id: "import", label: "Import" },
  { id: "sourcing", label: "Sourcing" },
  { id: "managing-director", label: "Managing Director" },
  { id: "owner", label: "Owner" },
] as const;
export type ContactPriorityId = (typeof CONTACT_PRIORITY_OPTIONS)[number]["id"];

export interface BuyerFinderSearchQuery {
  country: string;
  productKey: ProductKey | "";
  buyerType: BuyerTypeOption | "";
  industry: string;
  contactPriorities: ContactPriorityId[];
}
