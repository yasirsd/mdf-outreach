import "server-only";

import { isActiveBusinessProductId } from "./businessCatalogue";
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
import { newEntityId } from "./ids";
import { resolveBuyerFinderProcessCap } from "./searchRun";
import { normalizeCandidateSource, preferCandidateSource } from "./source";
import type {
  BusinessProductId,
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidateRecord,
  BuyerTypeOption,
  CandidateEvidence,
  CandidateSource,
  ContactPriorityId,
  EmailStatus,
} from "./types";

export interface IngestionQuery {
  country: string;
  productId: BusinessProductId;
  buyerTypes?: BuyerTypeOption[];
  industry?: string;
  /**
   * Optional LOWER bound on companies processed. Cannot raise the
   * server cap (BUYER_FINDER_PROCESS_CAP). Never forwarded to the
   * company provider — Hunter free Discover does not accept request limit.
   */
  limit?: number;
  contactPriorities?: ContactPriorityId[];
}

/**
 * BF2.1 — Progress reporter injected by the orchestration layer.
 * Domain logic emits stage-boundary and per-record events; the caller
 * decides how / how often to persist them.
 */
export interface IngestionProgressReporter {
  discoveryStarted?: (info: { provider: string }) => void | Promise<void>;
  discoveryCompleted?: (info: { discovered: number; usable: number }) => void | Promise<void>;
  candidateProcessed?: (info: { processed: number; total: number }) => void | Promise<void>;
  complete?: (info: { summary: IngestionBatchResult }) => void | Promise<void>;
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
  /** Optional provider error code (e.g. Hunter `rate_limited`). Never a raw body. */
  code?: string;
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
  /**
   * Normalized/valid provider company records that entered the
   * candidate-processing loop (BF2.2A: ≤ BUYER_FINDER_PROCESS_CAP).
   * Not "unique" (dedupe happens inside the loop) and not "qualified".
   * May be lower than discovered when the provider returned more rows
   * than the server processes, or when some rows failed validation.
   */
  usable: number;
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
  /**
   * OPTIONAL — BF2.
   *
   * When absent, ingestion runs in "no-enrichment" mode: contacts are
   * NOT fetched, `contacts` for every persisted candidate is `[]`, and
   * `contactsAdded` remains 0. The candidate is still persisted with
   * its company score (contactQuality contributes zero naturally); the
   * operator sees an intentional "contact enrichment not run yet"
   * state in the UI.
   *
   * The BF2 Hunter production path deliberately runs in this mode so
   * we NEVER attach fabricated / mock people or emails to real
   * companies. Mock enrichment is only injected here by tests and by
   * legacy demo flows.
   */
  contactProvider?: ContactEnrichmentProvider;
  repositories: BuyerFinderIngestionRepos;
  /** Optional snapshot for analysis only. Never loaded via BuyerRepository. */
  existingBuyers?: Buyer[];
  /**
   * BF2.2 — injected by Search Run orchestration. Ingestion emits
   * truthful events; the reporter decides how often to persist them.
   * Reporter exceptions are swallowed so they cannot break ingestion.
   */
  progress?: IngestionProgressReporter;
  /** Provider id reported on `discoveryStarted` (e.g. "hunter"). */
  progressProvider?: string;
  /**
   * BF3C — enqueue durable free-enrichment jobs after persist.
   * Must be DB-only (no website/Hunter calls). Failures are swallowed.
   */
  enqueueFreeEnrichment?: (candidate: BuyerCandidate) => Promise<void>;
}

function emptyResult(): IngestionBatchResult {
  return {
    discovered: 0,
    usable: 0,
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

async function emitProgress(fn: undefined | (() => void | Promise<void>)): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch {
    // Reporter failure must never break ingestion.
  }
}

async function enqueueAfterPersist(
  enqueue: DiscoverAndIngestInput["enqueueFreeEnrichment"],
  candidate: BuyerCandidate | undefined,
): Promise<void> {
  if (!enqueue || !candidate) return;
  try {
    await enqueue(candidate);
  } catch {
    // Queue insert must never fail the Search Run persist path.
  }
}

function errorCodeOf(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0 && code.length <= 64) return code;
  }
  return undefined;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
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
  source: CandidateSource;
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
    source: normalizeCandidateSource(raw.source),
    sourceUrl: normalizeOptionalUrl(raw.sourceUrl),
    // Placeholder when the provider omitted relevance — not a measured
    // Hunter score. UI must not present this as precise "50% relevance".
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
    source: normalizeCandidateSource(c.source),
  })).filter((c) => Boolean(c.jobTitle || c.businessEmail || c.fullName));
}

function toContactRow(
  candidateId: string,
  c: DiscoveredContact,
  isPrimary: boolean,
): BuyerCandidateContact {
  return {
    id: newEntityId(),
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
    source: normalizeCandidateSource(c.source),
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
  const nextSource = preferCandidateSource(existing.source, incoming.source);
  if (nextSource !== existing.source) patch.source = nextSource;
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
  productId: BusinessProductId,
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
    targetProductId: productId,
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
  productId: BusinessProductId,
  queryCountry: string,
  hit: NormalizedHit,
): Promise<boolean> {
  const existing = await repos.productMatches.findByCandidateAndProduct(candidateId, productId);
  if (existing) return false;
  const row: BuyerCandidateProductMatch = {
    id: newEntityId(),
    candidateId,
    productId,
    country: hit.country,
    query: `${queryCountry} ${productId}`,
    relevance: hit.productRelevance,
    evidence: hit.evidence,
    source: hit.source,
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
  const { query, companyProvider, repositories: repos } = input;
  const contactProvider = input.contactProvider;

  if (!blankToUndefined(query.country)) {
    result.failures.push({ stage: "validation", message: "country is required" });
    return result;
  }
  if (!isActiveBusinessProductId(query.productId)) {
    result.failures.push({
      stage: "validation",
      message: `Invalid MDF business product id: ${String(query.productId || "(empty)")}`,
    });
    return result;
  }
  const productId = query.productId;
  // Do not forward process-cap as query.limit. Hunter's free Discover
  // contract does not accept request limit; applying it locally would
  // silently shrink `discovered` and hide leftover provider rows.
  const discoveryQuery: CompanyDiscoveryQuery = {
    country: query.country,
    productId,
    buyerTypes: query.buyerTypes,
    industry: query.industry,
    contactPriorities: query.contactPriorities,
  };
  const reporter = input.progress;

  await emitProgress(() =>
    reporter?.discoveryStarted?.({ provider: input.progressProvider ?? "company" }),
  );

  let hits: DiscoveredCompany[];
  try {
    hits = await companyProvider.discover(discoveryQuery);
  } catch (err) {
    result.failures.push({
      stage: "discovery",
      message: err instanceof Error ? err.message : "Company discovery failed",
      code: errorCodeOf(err),
    });
    return result;
  }

  result.discovered = hits.length;

  const allUsable: Array<{ raw: DiscoveredCompany; normalized: NormalizedHit }> = [];
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
    allUsable.push({ raw, normalized });
  }
  const cap = resolveBuyerFinderProcessCap(query.limit);
  const usableHits = allUsable.slice(0, cap);
  result.usable = usableHits.length;

  await emitProgress(() =>
    reporter?.discoveryCompleted?.({
      discovered: result.discovered,
      usable: result.usable,
    }),
  );

  let processed = 0;
  for (const { raw, normalized } of usableHits) {
    let people: DiscoveredContact[] = [];
    // BF2 — when no contactProvider is supplied, we deliberately skip
    // enrichment. The candidate is still persisted with empty contacts;
    // this is the normal path for the Hunter production flow. Zero
    // contacts is NOT treated as a failure.
    if (contactProvider) {
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
        processed += 1;
        await emitProgress(() =>
          reporter?.candidateProcessed?.({ processed, total: result.usable }),
        );
        continue;
      }
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
        } else {
          const patch = fillMissingCandidate(existing, normalized);
          const hadPatch = Object.keys(patch).length > 0;
          if (hadPatch) await repos.candidates.update(existing.id, patch);

          const contactsAdded = await addNewContacts(repos, existing.id, people);
          const productAdded = await addProductMatch(
            repos,
            existing.id,
            productId,
            query.country,
            normalized,
          );
          await rescore(repos, existing.id, productId, query.country);

          if (hadPatch || contactsAdded > 0 || productAdded) {
            result.enrichedExisting += 1;
            result.contactsAdded += contactsAdded;
            if (productAdded) result.productMatchesAdded += 1;
          } else {
            result.skippedExactDuplicates += 1;
          }
          const latest = await repos.candidates.get(existing.id);
          await enqueueAfterPersist(input.enqueueFreeEnrichment, latest ?? existing);
        }
        processed += 1;
        await emitProgress(() =>
          reporter?.candidateProcessed?.({ processed, total: result.usable }),
        );
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

      // DB identity is a random UUID. Idempotency is the dedupe layer
      // above (exact/high → update existing). Possible matches stay as
      // separate rows pending human review — still with a UUID id.
      const id = newEntityId();
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

      if (await addProductMatch(repos, id, productId, query.country, normalized)) {
        result.productMatchesAdded += 1;
      }
      await rescore(repos, id, productId, query.country);
      result.created += 1;
      await enqueueAfterPersist(input.enqueueFreeEnrichment, candidate);
    } catch (err) {
      result.failures.push({
        providerRecordId: normalized.providerRecordId,
        companyName: normalized.companyName,
        stage: "persist",
        message: err instanceof Error ? err.message : "Persist failed",
      });
    }
    processed += 1;
    await emitProgress(() =>
      reporter?.candidateProcessed?.({ processed, total: result.usable }),
    );
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

  await emitProgress(() => reporter?.complete?.({ summary: result }));
  return result;
}
