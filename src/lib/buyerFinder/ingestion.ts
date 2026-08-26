import "server-only";

import { isProductKey } from "@/lib/email/themes/catalogue";
import type { ProductKey } from "@/lib/email/themes/types";
import type { Buyer } from "@/lib/types";
import type {
  BuyerCandidateContactRepository,
  BuyerCandidateProductMatchRepository,
  BuyerCandidateRepository,
} from "@/lib/repositories/interfaces";
import {
  findBuyerDuplicates,
  findCandidateDuplicates,
  isPublicEmailDomain,
  type DuplicateReason,
} from "./dedupe";
import {
  blankToUndefined,
  normalizeDomain,
  normalizeOptionalEmail,
  normalizeOptionalUrl,
} from "./normalize";
import type {
  CompanyDiscoveryProvider,
  CompanyDiscoveryQuery,
  DiscoveredCompany,
  DiscoveredContact,
} from "./providers/types";
import type { ContactEnrichmentProvider } from "./providers/types";
import { scoreBuyerCandidate, scoreContactRole } from "./scoring";
import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidateRecord,
  BuyerTypeOption,
  CandidateEvidence,
  ContactPriorityId,
  EmailStatus,
} from "./types";

export interface IngestionQuery {
  country: string;
  productKey: string;
  buyerTypes?: BuyerTypeOption[];
  industry?: string;
  limit?: number;
  contactPriorities?: ContactPriorityId[];
}

export interface BuyerFinderIngestionRepos {
  candidates: BuyerCandidateRepository;
  contacts: BuyerCandidateContactRepository;
  productMatches: BuyerCandidateProductMatchRepository;
}

export interface IngestionFailure {
  providerRecordId?: string;
  companyName?: string;
  stage: "discovery" | "validation" | "contacts" | "persist";
  message: string;
}

export interface PossibleDuplicateFinding {
  providerRecordId: string;
  companyName: string;
  matchedCandidateId: string;
  confidence: "possible";
  reasons: DuplicateReason[];
}

export interface BuyerDuplicateFinding {
  candidateId: string;
  buyerId: string;
  confidence: "exact" | "high" | "possible";
  reasons: DuplicateReason[];
}

export interface IngestionBatchResult {
  discovered: number;
  created: number;
  enrichedExisting: number;
  skippedExactDuplicates: number;
  possibleDuplicates: PossibleDuplicateFinding[];
  contactsAdded: number;
  productMatchesAdded: number;
  failures: IngestionFailure[];
  buyerDuplicateFindings: BuyerDuplicateFinding[];
}

export interface DiscoverAndIngestInput {
  query: IngestionQuery;
  companyProvider: CompanyDiscoveryProvider;
  contactProvider: ContactEnrichmentProvider;
  repositories: BuyerFinderIngestionRepos;
  /** Optional snapshot for analysis only. Never loaded via BuyerRepository. */
  existingBuyers?: Buyer[];
}

function emptyResult(): IngestionBatchResult {
  return {
    discovered: 0,
    created: 0,
    enrichedExisting: 0,
    skippedExactDuplicates: 0,
    possibleDuplicates: [],
    contactsAdded: 0,
    productMatchesAdded: 0,
    failures: [],
    buyerDuplicateFindings: [],
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function candidateIdFor(company: { domain?: string; companyName: string; country: string }): string {
  if (company.domain && !isPublicEmailDomain(company.domain)) return `cand-${slug(company.domain)}`;
  return `cand-${slug(company.companyName)}-${slug(company.country)}`;
}

function contactIdFor(candidateId: string, email: string | undefined, jobTitle: string): string {
  const key = email ? slug(email) : slug(jobTitle);
  return `ctc-${candidateId}-${key}`;
}

function matchIdFor(candidateId: string, productKey: ProductKey): string {
  return `match-${candidateId}-${productKey}`;
}

function clampScore(n: number | undefined): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function evidenceSafe(raw: CandidateEvidence[] | undefined): CandidateEvidence[] {
  if (!Array.isArray(raw)) return [];
  const out: CandidateEvidence[] = [];
  for (const item of raw.slice(0, 20)) {
    const note = blankToUndefined(item?.note)?.slice(0, 2000);
    if (!note) continue;
    const confidence = clampScore(item.confidence) ?? 0;
    const url = normalizeOptionalUrl(item.url);
    out.push(url ? { note, confidence, url } : { note, confidence });
  }
  return out;
}

interface NormalizedHit {
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
  productRelevance: number;
}

function validateAndNormalize(raw: DiscoveredCompany): NormalizedHit | string {
  const companyName = blankToUndefined(raw?.companyName);
  const country = blankToUndefined(raw?.country);
  if (!companyName) return "company name is required";
  if (!country) return "country is required";
  const website = normalizeOptionalUrl(raw.website);
  const domain = normalizeDomain(raw.domain) ?? normalizeDomain(website);
  return {
    providerRecordId: blankToUndefined(raw.providerRecordId) ?? slug(companyName),
    companyName,
    website,
    domain,
    country,
    city: blankToUndefined(raw.city),
    industry: blankToUndefined(raw.industry),
    buyerType: blankToUndefined(raw.buyerType),
    isImporter: raw.isImporter,
    isDistributor: raw.isDistributor,
    companyLinkedinUrl: normalizeOptionalUrl(raw.companyLinkedinUrl),
    generalEmail: normalizeOptionalEmail(raw.generalEmail),
    evidence: evidenceSafe(raw.evidence),
    source: "mock",
    sourceUrl: normalizeOptionalUrl(raw.sourceUrl),
    productRelevance: clampScore(raw.productRelevance) ?? 50,
  };
}

function emailRank(status: EmailStatus | undefined): number {
  if (status === "valid") return 3;
  if (status === "accept_all") return 2;
  if (status === "unverified") return 1;
  return 0;
}

function contactStrength(c: { jobTitle: string; emailStatus?: EmailStatus }): number {
  return scoreContactRole(c.jobTitle).points * 10 + emailRank(c.emailStatus);
}

function pickPrimaryIndex(contacts: Array<{ jobTitle: string; emailStatus?: EmailStatus }>): number {
  if (contacts.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < contacts.length; i++) {
    if (contactStrength(contacts[i]!) > contactStrength(contacts[best]!)) best = i;
  }
  return best;
}

function normalizeDiscoveredContacts(raw: DiscoveredContact[]): DiscoveredContact[] {
  return raw.map((c) => ({
    ...c,
    firstName: blankToUndefined(c.firstName),
    lastName: blankToUndefined(c.lastName),
    fullName: blankToUndefined(c.fullName) ?? [c.firstName, c.lastName].filter(Boolean).join(" "),
    jobTitle: blankToUndefined(c.jobTitle) ?? "",
    businessEmail: normalizeOptionalEmail(c.businessEmail),
    emailConfidence: clampScore(c.emailConfidence),
    linkedinUrl: normalizeOptionalUrl(c.linkedinUrl),
    source: "mock" as const,
  })).filter((c) => Boolean(c.jobTitle || c.businessEmail || c.fullName));
}

function toContactRow(
  candidateId: string,
  c: DiscoveredContact,
  isPrimary: boolean,
): BuyerCandidateContact {
  return {
    id: contactIdFor(candidateId, c.businessEmail, c.jobTitle),
    candidateId,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    fullName: c.fullName ?? "",
    jobTitle: c.jobTitle,
    businessEmail: c.businessEmail ?? "",
    emailStatus: c.emailStatus,
    emailConfidence: c.emailConfidence,
    linkedinUrl: c.linkedinUrl,
    isPrimary,
    source: "mock",
  };
}

function fillMissingCandidate(existing: BuyerCandidate, incoming: NormalizedHit): Partial<BuyerCandidate> {
  const patch: Partial<BuyerCandidate> = {};
  if (!blankToUndefined(existing.website) && incoming.website) patch.website = incoming.website;
  if (!blankToUndefined(existing.domain) && incoming.domain && !isPublicEmailDomain(incoming.domain)) {
    patch.domain = incoming.domain;
  }
  if (!blankToUndefined(existing.city) && incoming.city) patch.city = incoming.city;
  if (!blankToUndefined(existing.industry) && incoming.industry) patch.industry = incoming.industry;
  if (!blankToUndefined(existing.buyerType) && incoming.buyerType) patch.buyerType = incoming.buyerType;
  if (existing.isImporter == null && incoming.isImporter != null) patch.isImporter = incoming.isImporter;
  if (existing.isDistributor == null && incoming.isDistributor != null) {
    patch.isDistributor = incoming.isDistributor;
  }
  if (!blankToUndefined(existing.companyLinkedinUrl) && incoming.companyLinkedinUrl) {
    patch.companyLinkedinUrl = incoming.companyLinkedinUrl;
  }
  if (!normalizeOptionalEmail(existing.generalEmail) && incoming.generalEmail) {
    patch.generalEmail = incoming.generalEmail;
  }
  if ((!existing.evidence || existing.evidence.length === 0) && incoming.evidence.length > 0) {
    patch.evidence = incoming.evidence;
  } else if (existing.evidence && incoming.evidence.length > 0) {
    const notes = new Set(existing.evidence.map((e) => e.note));
    const extra = incoming.evidence.filter((e) => !notes.has(e.note));
    if (extra.length > 0) patch.evidence = [...existing.evidence, ...extra].slice(0, 20);
  }
  if (!blankToUndefined(existing.source) && incoming.source) patch.source = incoming.source;
  return patch;
}

async function loadRecords(repos: BuyerFinderIngestionRepos): Promise<BuyerCandidateRecord[]> {
  const list = await repos.candidates.list();
  const records: BuyerCandidateRecord[] = [];
  for (const candidate of list) {
    records.push({
      candidate,
      contacts: await repos.contacts.listByCandidate(candidate.id),
      productMatches: await repos.productMatches.listByCandidate(candidate.id),
    });
  }
  return records;
}

async function applyPrimary(repos: BuyerFinderIngestionRepos, candidateId: string): Promise<void> {
  const all = await repos.contacts.listByCandidate(candidateId);
  if (all.length === 0) return;
  const idx = pickPrimaryIndex(all);
  for (let i = 0; i < all.length; i++) {
    const should = i === idx;
    if (all[i]!.isPrimary !== should) {
      await repos.contacts.update(all[i]!.id, { isPrimary: should });
    }
  }
}

async function rescore(
  repos: BuyerFinderIngestionRepos,
  candidateId: string,
  productKey: ProductKey,
  country: string,
): Promise<void> {
  const candidate = await repos.candidates.get(candidateId);
  if (!candidate) return;
  const contacts = await repos.contacts.listByCandidate(candidateId);
  const productMatches = await repos.productMatches.listByCandidate(candidateId);
  const score = scoreBuyerCandidate({
    candidate,
    contacts,
    productMatches,
    targetProductKey: productKey,
    targetCountry: country,
  });
  await repos.candidates.update(candidateId, {
    companyScore: score.total,
    discoveryStatus: candidate.discoveryStatus === "archived" ? "archived" : "ready",
  });
}

async function addProductMatch(
  repos: BuyerFinderIngestionRepos,
  candidateId: string,
  productKey: ProductKey,
  queryCountry: string,
  hit: NormalizedHit,
): Promise<boolean> {
  const existing = await repos.productMatches.findByCandidateAndProduct(candidateId, productKey);
  if (existing) return false;
  const row: BuyerCandidateProductMatch = {
    id: matchIdFor(candidateId, productKey),
    candidateId,
    productKey,
    country: hit.country,
    query: `${queryCountry} ${productKey}`,
    relevance: hit.productRelevance,
    evidence: hit.evidence,
    source: "mock",
  };
  await repos.productMatches.create(row);
  return true;
}

async function addNewContacts(
  repos: BuyerFinderIngestionRepos,
  candidateId: string,
  discovered: DiscoveredContact[],
): Promise<number> {
  let added = 0;
  for (const c of discovered) {
    const email = c.businessEmail;
    if (email) {
      const taken = await repos.contacts.findByEmail(email);
      if (taken) continue;
    }
    const existingForCandidate = await repos.contacts.listByCandidate(candidateId);
    const dupTitle =
      !email &&
      existingForCandidate.some(
        (e) => e.jobTitle === c.jobTitle && !normalizeOptionalEmail(e.businessEmail),
      );
    if (dupTitle) continue;
    await repos.contacts.create(toContactRow(candidateId, c, false));
    added += 1;
  }
  if (added > 0) await applyPrimary(repos, candidateId);
  return added;
}

function probeRecord(hit: NormalizedHit, people: DiscoveredContact[]): BuyerCandidateRecord {
  const id = "probe";
  return {
    candidate: {
      id,
      companyName: hit.companyName,
      website: hit.website,
      domain: hit.domain,
      country: hit.country,
      generalEmail: hit.generalEmail,
      discoveryStatus: "new",
      reviewStatus: "pending",
    },
    contacts: people.map((p, i) => toContactRow(id, p, i === 0)),
    productMatches: [],
  };
}

/**
 * Server-only orchestration. Callers inject providers + Buyer Finder repos.
 * Does not call serverRepositories(), create Supabase, or write Buyers.
 */
export async function discoverAndIngestCandidates(
  input: DiscoverAndIngestInput,
): Promise<IngestionBatchResult> {
  const result = emptyResult();
  const { query, companyProvider, contactProvider, repositories: repos } = input;

  if (!blankToUndefined(query.country)) {
    result.failures.push({ stage: "validation", message: "country is required" });
    return result;
  }
  if (!isProductKey(query.productKey)) {
    result.failures.push({
      stage: "validation",
      message: `Invalid MDF product key: ${String(query.productKey || "(empty)")}`,
    });
    return result;
  }
  const productKey = query.productKey;
  const discoveryQuery: CompanyDiscoveryQuery = { ...query, productKey };

  let hits: DiscoveredCompany[];
  try {
    hits = await companyProvider.discover(discoveryQuery);
  } catch (err) {
    result.failures.push({
      stage: "discovery",
      message: err instanceof Error ? err.message : "Company discovery failed",
    });
    return result;
  }

  result.discovered = hits.length;

  for (const raw of hits) {
    const normalized = validateAndNormalize(raw);
    if (typeof normalized === "string") {
      result.failures.push({
        providerRecordId: raw?.providerRecordId,
        companyName: raw?.companyName,
        stage: "validation",
        message: normalized,
      });
      continue;
    }

    let people: DiscoveredContact[] = [];
    try {
      people = normalizeDiscoveredContacts(
        await contactProvider.findContacts({
          company: raw,
          roles: query.contactPriorities,
        }),
      );
    } catch (err) {
      result.failures.push({
        providerRecordId: normalized.providerRecordId,
        companyName: normalized.companyName,
        stage: "contacts",
        message: err instanceof Error ? err.message : "Contact enrichment failed",
      });
      continue;
    }

    try {
      const existingRecords = await loadRecords(repos);
      const dup = findCandidateDuplicates(probeRecord(normalized, people), existingRecords);
      const strong = dup.matches.find((m) => m.confidence === "exact" || m.confidence === "high");
      const possibles = dup.matches.filter((m) => m.confidence === "possible");

      if (strong) {
        const existing = await repos.candidates.get(strong.candidateId);
        if (!existing) {
          result.failures.push({
            providerRecordId: normalized.providerRecordId,
            companyName: normalized.companyName,
            stage: "persist",
            message: "Matched candidate disappeared",
          });
          continue;
        }
        const patch = fillMissingCandidate(existing, normalized);
        const hadPatch = Object.keys(patch).length > 0;
        if (hadPatch) await repos.candidates.update(existing.id, patch);

        const contactsAdded = await addNewContacts(repos, existing.id, people);
        const productAdded = await addProductMatch(
          repos,
          existing.id,
          productKey,
          query.country,
          normalized,
        );
        await rescore(repos, existing.id, productKey, query.country);

        if (hadPatch || contactsAdded > 0 || productAdded) {
          result.enrichedExisting += 1;
          result.contactsAdded += contactsAdded;
          if (productAdded) result.productMatchesAdded += 1;
        } else {
          result.skippedExactDuplicates += 1;
        }
        continue;
      }

      for (const p of possibles) {
        result.possibleDuplicates.push({
          providerRecordId: normalized.providerRecordId,
          companyName: normalized.companyName,
          matchedCandidateId: p.candidateId,
          confidence: "possible",
          reasons: p.reasons,
        });
      }

      const id = candidateIdFor(normalized);
      const already = await repos.candidates.get(id);
      if (already) {
        const patch = fillMissingCandidate(already, normalized);
        if (Object.keys(patch).length > 0) await repos.candidates.update(id, patch);
        const contactsAdded = await addNewContacts(repos, id, people);
        const productAdded = await addProductMatch(repos, id, productKey, query.country, normalized);
        await rescore(repos, id, productKey, query.country);
        result.enrichedExisting += 1;
        result.contactsAdded += contactsAdded;
        if (productAdded) result.productMatchesAdded += 1;
        continue;
      }

      const candidate: BuyerCandidate = {
        id,
        companyName: normalized.companyName,
        website: normalized.website,
        domain: isPublicEmailDomain(normalized.domain) ? undefined : normalized.domain,
        country: normalized.country,
        city: normalized.city,
        industry: normalized.industry,
        buyerType: normalized.buyerType,
        isImporter: normalized.isImporter,
        isDistributor: normalized.isDistributor,
        companyLinkedinUrl: normalized.companyLinkedinUrl,
        generalEmail: normalized.generalEmail,
        evidence: normalized.evidence,
        source: normalized.source,
        sourceUrl: normalized.sourceUrl,
        discoveryStatus: "ready",
        reviewStatus: "pending",
      };
      await repos.candidates.create(candidate);

      const primaryIdx = pickPrimaryIndex(people);
      for (let i = 0; i < people.length; i++) {
        const email = people[i]!.businessEmail;
        if (email && (await repos.contacts.findByEmail(email))) continue;
        await repos.contacts.create(toContactRow(id, people[i]!, i === primaryIdx));
        result.contactsAdded += 1;
      }
      await applyPrimary(repos, id);

      if (await addProductMatch(repos, id, productKey, query.country, normalized)) {
        result.productMatchesAdded += 1;
      }
      await rescore(repos, id, productKey, query.country);
      result.created += 1;
    } catch (err) {
      result.failures.push({
        providerRecordId: normalized.providerRecordId,
        companyName: normalized.companyName,
        stage: "persist",
        message: err instanceof Error ? err.message : "Persist failed",
      });
    }
  }

  if (input.existingBuyers) {
    const records = await loadRecords(repos);
    for (const rec of records) {
      const found = findBuyerDuplicates({
        candidate: rec.candidate,
        contacts: rec.contacts,
        existingBuyers: input.existingBuyers,
      });
      for (const m of found.matches) {
        result.buyerDuplicateFindings.push({
          candidateId: rec.candidate.id,
          buyerId: m.buyerId,
          confidence: m.confidence,
          reasons: m.reasons,
        });
      }
    }
  }

  return result;
}
