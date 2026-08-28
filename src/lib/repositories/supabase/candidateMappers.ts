import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  CandidateEvidence,
  DiscoveryStatus,
  EmailStatus,
  ReviewStatus,
} from "@/lib/buyerFinder/types";
import {
  assertScore,
  blankToUndefined,
  normalizeDomain,
  normalizeOptionalEmail,
  normalizeOptionalUrl,
} from "@/lib/buyerFinder/normalize";
import { requireBusinessProductId } from "@/lib/buyerFinder/productKey";

export interface BuyerCandidateRow {
  id: string;
  workspace_id: string;
  company_name: string;
  website: string | null;
  domain: string | null;
  country: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  general_email: string | null;
  company_linkedin_url: string | null;
  industry: string | null;
  buyer_type: string | null;
  source: string | null;
  source_url: string | null;
  is_importer: boolean | null;
  is_distributor: boolean | null;
  evidence: CandidateEvidence[] | null;
  buyer_score: number | null;
  discovery_status: DiscoveryStatus;
  review_status: ReviewStatus;
  rejection_reason: string | null;
  people_searched_at: string | null;
  people_has_more: boolean;
  created_at: string;
  updated_at: string;
}

export interface BuyerCandidateContactRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  business_email: string | null;
  email_status: EmailStatus | null;
  email_confidence: number | null;
  linkedin_url: string | null;
  contact_score: number | null;
  is_primary: boolean;
  source: string | null;
  provider_ref: string | null;
  department: string | null;
  seniority: string | null;
  is_decision_maker: boolean | null;
  email_type: string | null;
  verification_status: string | null;
  full_name_available: boolean | null;
  linkedin_available: boolean | null;
  phone_available: boolean | null;
  evidence: CandidateEvidence[] | null;
  discovered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuyerCandidateProductMatchRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  product_key: string;
  country: string | null;
  query: string | null;
  relevance: number | null;
  evidence: CandidateEvidence[] | null;
  source: string | null;
  discovered_at: string;
  created_at: string;
  updated_at: string;
}

const has = <T extends object>(obj: T, key: keyof T) =>
  Object.prototype.hasOwnProperty.call(obj, key);

export function evidenceFromJson(raw: unknown): CandidateEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: CandidateEvidence[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const note = typeof rec.note === "string" ? rec.note.trim().slice(0, 2000) : "";
    if (!note) continue;
    const confidence =
      typeof rec.confidence === "number" && Number.isFinite(rec.confidence)
        ? Math.min(100, Math.max(0, rec.confidence))
        : 0;
    const url = typeof rec.url === "string" ? normalizeOptionalUrl(rec.url) : undefined;
    out.push(url ? { note, confidence, url } : { note, confidence });
  }
  return out;
}

export function evidenceToJson(evidence: CandidateEvidence[] | undefined): CandidateEvidence[] {
  return evidenceFromJson(evidence ?? []);
}

export function candidateFromRow(r: BuyerCandidateRow): BuyerCandidate {
  return {
    id: r.id,
    companyName: r.company_name,
    website: r.website ?? undefined,
    domain: r.domain ?? undefined,
    country: r.country,
    city: r.city ?? undefined,
    address: r.address ?? undefined,
    phone: r.phone ?? undefined,
    generalEmail: r.general_email ?? undefined,
    companyLinkedinUrl: r.company_linkedin_url ?? undefined,
    industry: r.industry ?? undefined,
    buyerType: r.buyer_type ?? undefined,
    source: r.source ?? undefined,
    sourceUrl: r.source_url ?? undefined,
    isImporter: r.is_importer ?? undefined,
    isDistributor: r.is_distributor ?? undefined,
    evidence: evidenceFromJson(r.evidence),
    companyScore: r.buyer_score ?? undefined,
    discoveryStatus: r.discovery_status,
    reviewStatus: r.review_status,
    rejectionReason: r.rejection_reason ?? undefined,
    peopleSearchedAt: r.people_searched_at ?? undefined,
    peopleHasMore: r.people_has_more ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function candidateToRow(
  c: Partial<BuyerCandidate>,
  workspaceId: string,
): Omit<BuyerCandidateRow, "created_at" | "updated_at"> {
  return {
    id: c.id!,
    workspace_id: workspaceId,
    company_name: c.companyName ?? "",
    website: normalizeOptionalUrl(c.website) ?? null,
    domain: normalizeDomain(c.domain) ?? normalizeDomain(c.website) ?? null,
    country: c.country ?? "",
    city: blankToUndefined(c.city) ?? null,
    address: blankToUndefined(c.address) ?? null,
    phone: blankToUndefined(c.phone) ?? null,
    general_email: normalizeOptionalEmail(c.generalEmail) ?? null,
    company_linkedin_url: normalizeOptionalUrl(c.companyLinkedinUrl) ?? null,
    industry: blankToUndefined(c.industry) ?? null,
    buyer_type: blankToUndefined(c.buyerType) ?? null,
    source: blankToUndefined(c.source) ?? null,
    source_url: normalizeOptionalUrl(c.sourceUrl) ?? null,
    is_importer: c.isImporter ?? null,
    is_distributor: c.isDistributor ?? null,
    evidence: evidenceToJson(c.evidence),
    buyer_score: assertScore(c.companyScore, "buyer_score") ?? null,
    discovery_status: (c.discoveryStatus ?? "new") as DiscoveryStatus,
    review_status: (c.reviewStatus ?? "pending") as ReviewStatus,
    rejection_reason: blankToUndefined(c.rejectionReason) ?? null,
    people_searched_at: blankToUndefined(c.peopleSearchedAt) ?? null,
    people_has_more: c.peopleHasMore ?? false,
  };
}

export function candidateToPatchRow(
  patch: Partial<BuyerCandidate>,
): Partial<Omit<BuyerCandidateRow, "id" | "workspace_id" | "created_at" | "updated_at">> {
  const row: Record<string, unknown> = {};
  if (has(patch, "companyName")) row.company_name = patch.companyName ?? "";
  if (has(patch, "website")) row.website = normalizeOptionalUrl(patch.website) ?? null;
  if (has(patch, "domain")) row.domain = normalizeDomain(patch.domain) ?? null;
  if (has(patch, "country")) row.country = patch.country ?? "";
  if (has(patch, "city")) row.city = blankToUndefined(patch.city) ?? null;
  if (has(patch, "address")) row.address = blankToUndefined(patch.address) ?? null;
  if (has(patch, "phone")) row.phone = blankToUndefined(patch.phone) ?? null;
  if (has(patch, "generalEmail")) row.general_email = normalizeOptionalEmail(patch.generalEmail) ?? null;
  if (has(patch, "companyLinkedinUrl")) {
    row.company_linkedin_url = normalizeOptionalUrl(patch.companyLinkedinUrl) ?? null;
  }
  if (has(patch, "industry")) row.industry = blankToUndefined(patch.industry) ?? null;
  if (has(patch, "buyerType")) row.buyer_type = blankToUndefined(patch.buyerType) ?? null;
  if (has(patch, "source")) row.source = blankToUndefined(patch.source) ?? null;
  if (has(patch, "sourceUrl")) row.source_url = normalizeOptionalUrl(patch.sourceUrl) ?? null;
  if (has(patch, "isImporter")) row.is_importer = patch.isImporter ?? null;
  if (has(patch, "isDistributor")) row.is_distributor = patch.isDistributor ?? null;
  if (has(patch, "evidence")) row.evidence = evidenceToJson(patch.evidence);
  if (has(patch, "companyScore")) row.buyer_score = assertScore(patch.companyScore, "buyer_score") ?? null;
  if (has(patch, "discoveryStatus")) row.discovery_status = patch.discoveryStatus;
  if (has(patch, "reviewStatus")) row.review_status = patch.reviewStatus;
  if (has(patch, "rejectionReason")) row.rejection_reason = blankToUndefined(patch.rejectionReason) ?? null;
  if (has(patch, "peopleSearchedAt")) row.people_searched_at = blankToUndefined(patch.peopleSearchedAt) ?? null;
  if (has(patch, "peopleHasMore")) row.people_has_more = patch.peopleHasMore ?? false;
  return row as Partial<Omit<BuyerCandidateRow, "id" | "workspace_id" | "created_at" | "updated_at">>;
}

export function contactFromRow(r: BuyerCandidateContactRow): BuyerCandidateContact {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    fullName: r.full_name ?? "",
    jobTitle: r.job_title ?? "",
    businessEmail: r.business_email ?? "",
    emailStatus: r.email_status ?? undefined,
    emailConfidence: r.email_confidence ?? undefined,
    linkedinUrl: r.linkedin_url ?? undefined,
    contactScore: r.contact_score ?? undefined,
    isPrimary: r.is_primary,
    source: r.source ?? undefined,
    providerRef: r.provider_ref ?? undefined,
    department: r.department ?? undefined,
    seniority: r.seniority ?? undefined,
    isDecisionMaker: r.is_decision_maker ?? undefined,
    emailType: r.email_type === "personal" || r.email_type === "generic" ? r.email_type : undefined,
    verificationStatus: r.verification_status ?? undefined,
    fullNameAvailable: r.full_name_available ?? undefined,
    linkedinAvailable: r.linkedin_available ?? undefined,
    phoneAvailable: r.phone_available ?? undefined,
    evidence: evidenceFromJson(r.evidence),
    discoveredAt: r.discovered_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function contactToRow(
  c: Partial<BuyerCandidateContact>,
  workspaceId: string,
): Omit<BuyerCandidateContactRow, "created_at" | "updated_at"> {
  return {
    id: c.id!,
    workspace_id: workspaceId,
    candidate_id: c.candidateId!,
    first_name: blankToUndefined(c.firstName) ?? null,
    last_name: blankToUndefined(c.lastName) ?? null,
    full_name: blankToUndefined(c.fullName) ?? null,
    job_title: blankToUndefined(c.jobTitle) ?? null,
    business_email: normalizeOptionalEmail(c.businessEmail) ?? null,
    email_status: c.emailStatus ?? null,
    email_confidence: assertScore(c.emailConfidence, "email_confidence") ?? null,
    linkedin_url: normalizeOptionalUrl(c.linkedinUrl) ?? null,
    contact_score: assertScore(c.contactScore, "contact_score") ?? null,
    is_primary: c.isPrimary ?? false,
    source: blankToUndefined(c.source) ?? null,
    provider_ref: blankToUndefined(c.providerRef) ?? null,
    department: blankToUndefined(c.department) ?? null,
    seniority: blankToUndefined(c.seniority) ?? null,
    is_decision_maker: c.isDecisionMaker ?? null,
    email_type: c.emailType === "personal" || c.emailType === "generic" ? c.emailType : null,
    verification_status: blankToUndefined(c.verificationStatus) ?? null,
    full_name_available: c.fullNameAvailable ?? null,
    linkedin_available: c.linkedinAvailable ?? null,
    phone_available: c.phoneAvailable ?? null,
    evidence: evidenceToJson(c.evidence),
    discovered_at: c.discoveredAt ?? null,
  };
}

export function contactToPatchRow(
  patch: Partial<BuyerCandidateContact>,
): Partial<
  Omit<BuyerCandidateContactRow, "id" | "workspace_id" | "candidate_id" | "created_at" | "updated_at">
> {
  const row: Record<string, unknown> = {};
  if (has(patch, "firstName")) row.first_name = blankToUndefined(patch.firstName) ?? null;
  if (has(patch, "lastName")) row.last_name = blankToUndefined(patch.lastName) ?? null;
  if (has(patch, "fullName")) row.full_name = blankToUndefined(patch.fullName) ?? null;
  if (has(patch, "jobTitle")) row.job_title = blankToUndefined(patch.jobTitle) ?? null;
  if (has(patch, "businessEmail")) row.business_email = normalizeOptionalEmail(patch.businessEmail) ?? null;
  if (has(patch, "emailStatus")) row.email_status = patch.emailStatus ?? null;
  if (has(patch, "emailConfidence")) {
    row.email_confidence = assertScore(patch.emailConfidence, "email_confidence") ?? null;
  }
  if (has(patch, "linkedinUrl")) row.linkedin_url = normalizeOptionalUrl(patch.linkedinUrl) ?? null;
  if (has(patch, "contactScore")) row.contact_score = assertScore(patch.contactScore, "contact_score") ?? null;
  if (has(patch, "isPrimary")) row.is_primary = patch.isPrimary ?? false;
  if (has(patch, "source")) row.source = blankToUndefined(patch.source) ?? null;
  if (has(patch, "providerRef")) row.provider_ref = blankToUndefined(patch.providerRef) ?? null;
  if (has(patch, "department")) row.department = blankToUndefined(patch.department) ?? null;
  if (has(patch, "seniority")) row.seniority = blankToUndefined(patch.seniority) ?? null;
  if (has(patch, "isDecisionMaker")) row.is_decision_maker = patch.isDecisionMaker ?? null;
  if (has(patch, "emailType")) {
    row.email_type = patch.emailType === "personal" || patch.emailType === "generic" ? patch.emailType : null;
  }
  if (has(patch, "verificationStatus")) {
    row.verification_status = blankToUndefined(patch.verificationStatus) ?? null;
  }
  if (has(patch, "fullNameAvailable")) row.full_name_available = patch.fullNameAvailable ?? null;
  if (has(patch, "linkedinAvailable")) row.linkedin_available = patch.linkedinAvailable ?? null;
  if (has(patch, "phoneAvailable")) row.phone_available = patch.phoneAvailable ?? null;
  if (has(patch, "evidence")) row.evidence = evidenceToJson(patch.evidence);
  if (has(patch, "discoveredAt")) row.discovered_at = patch.discoveredAt ?? null;
  return row as Partial<
    Omit<BuyerCandidateContactRow, "id" | "workspace_id" | "candidate_id" | "created_at" | "updated_at">
  >;
}

export function productMatchFromRow(r: BuyerCandidateProductMatchRow): BuyerCandidateProductMatch {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    productId: requireBusinessProductId(r.product_key),
    country: r.country ?? undefined,
    query: r.query ?? undefined,
    relevance: r.relevance ?? undefined,
    evidence: evidenceFromJson(r.evidence),
    source: r.source ?? undefined,
    discoveredAt: r.discovered_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function productMatchToRow(
  m: Partial<BuyerCandidateProductMatch>,
  workspaceId: string,
): Omit<BuyerCandidateProductMatchRow, "created_at" | "updated_at"> {
  return {
    id: m.id!,
    workspace_id: workspaceId,
    candidate_id: m.candidateId!,
    product_key: requireBusinessProductId(m.productId),
    country: blankToUndefined(m.country) ?? null,
    query: blankToUndefined(m.query) ?? null,
    relevance: assertScore(m.relevance, "relevance") ?? null,
    evidence: evidenceToJson(m.evidence),
    source: blankToUndefined(m.source) ?? null,
    discovered_at: m.discoveredAt ?? new Date().toISOString(),
  };
}

export function productMatchToPatchRow(
  patch: Partial<BuyerCandidateProductMatch>,
): Partial<
  Omit<
    BuyerCandidateProductMatchRow,
    "id" | "workspace_id" | "candidate_id" | "created_at" | "updated_at"
  >
> {
  const row: Record<string, unknown> = {};
  if (has(patch, "productId")) row.product_key = requireBusinessProductId(patch.productId);
  if (has(patch, "country")) row.country = blankToUndefined(patch.country) ?? null;
  if (has(patch, "query")) row.query = blankToUndefined(patch.query) ?? null;
  if (has(patch, "relevance")) row.relevance = assertScore(patch.relevance, "relevance") ?? null;
  if (has(patch, "evidence")) row.evidence = evidenceToJson(patch.evidence);
  if (has(patch, "source")) row.source = blankToUndefined(patch.source) ?? null;
  if (has(patch, "discoveredAt")) row.discovered_at = patch.discoveredAt ?? null;
  return row as Partial<
    Omit<
      BuyerCandidateProductMatchRow,
      "id" | "workspace_id" | "candidate_id" | "created_at" | "updated_at"
    >
  >;
}
