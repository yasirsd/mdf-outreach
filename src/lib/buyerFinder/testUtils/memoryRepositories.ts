import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
  BuyerCandidatePublicEmail,
} from "@/lib/buyerFinder/types";
import { isEntityUuid, newEntityId } from "@/lib/buyerFinder/ids";
import { normalizeDomain, normalizeOptionalEmail } from "@/lib/buyerFinder/normalize";
import type { ProductKey } from "@/lib/email/themes/types";
import type {
  BuyerCandidateContactRepository,
  BuyerCandidateProductMatchRepository,
  BuyerCandidatePublicEmailRepository,
  BuyerCandidateRepository,
  BuyerFinderContactRevealEventRepository,
  BuyerFinderFreeEnrichmentJobRepository,
  FreeEnrichmentJobFinalizeInput,
  RevealEventFinalizeInput,
} from "@/lib/repositories/interfaces";
import { RevealEventActiveExistsError } from "@/lib/repositories/interfaces";
import type { BuyerFinderContactRevealEvent } from "@/lib/buyerFinder/contactRevealEvent";
import { isActiveRevealStatus } from "@/lib/buyerFinder/contactRevealEvent";
import type { FreeEnrichmentJob } from "@/lib/buyerFinder/freeEnrichmentJob";
import { FREE_ENRICHMENT_CLAIMABLE_STATUSES, FREE_ENRICHMENT_STALE_PROCESSING_MS } from "@/lib/buyerFinder/freeEnrichmentJob";

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** In-memory Buyer Finder repos for Phase 4 tests. Not a production store. */
export function createMemoryBuyerFinderRepos() {
  const candidates = new Map<string, BuyerCandidate>();
  const contacts = new Map<string, BuyerCandidateContact>();
  const matches = new Map<string, BuyerCandidateProductMatch>();
  const publicEmails = new Map<string, BuyerCandidatePublicEmail>();
  const revealEvents = new Map<string, BuyerFinderContactRevealEvent>();
  const freeEnrichmentJobs = new Map<string, FreeEnrichmentJob>();

  const candidateRepo: BuyerCandidateRepository = {
    async list() {
      return [...candidates.values()].map(clone).sort((a, b) => a.id.localeCompare(b.id));
    },
    async get(id) {
      const row = candidates.get(id);
      return row ? clone(row) : undefined;
    },
    async create(input) {
      if (candidates.has(input.id)) throw new Error(`candidate exists: ${input.id}`);
      candidates.set(input.id, clone(input));
      return clone(input);
    },
    async update(id, patch) {
      const cur = candidates.get(id);
      if (!cur) throw new Error(`candidate missing: ${id}`);
      const next = { ...cur, ...patch, id };
      candidates.set(id, next);
      return clone(next);
    },
    async delete(id) {
      candidates.delete(id);
      for (const job of [...freeEnrichmentJobs.values()]) {
        if (job.candidateId === id) freeEnrichmentJobs.delete(job.id);
      }
    },
    async findByDomain(domain) {
      const n = normalizeDomain(domain);
      if (!n) return undefined;
      const found = [...candidates.values()].find((c) => normalizeDomain(c.domain) === n);
      return found ? clone(found) : undefined;
    },
  };

  const contactRepo: BuyerCandidateContactRepository = {
    async listByCandidate(candidateId) {
      return [...contacts.values()]
        .filter((c) => c.candidateId === candidateId)
        .map(clone)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async get(id) {
      const row = contacts.get(id);
      return row ? clone(row) : undefined;
    },
    async create(input) {
      if (contacts.has(input.id)) throw new Error(`contact exists: ${input.id}`);
      contacts.set(input.id, clone(input));
      return clone(input);
    },
    async update(id, patch) {
      const cur = contacts.get(id);
      if (!cur) throw new Error(`contact missing: ${id}`);
      const next = { ...cur, ...patch, id };
      contacts.set(id, next);
      return clone(next);
    },
    async delete(id) {
      contacts.delete(id);
    },
    async findByEmail(email) {
      const n = normalizeOptionalEmail(email);
      if (!n) return undefined;
      const found = [...contacts.values()].find((c) => normalizeOptionalEmail(c.businessEmail) === n);
      return found ? clone(found) : undefined;
    },
    async findByProviderRef(source, providerRef) {
      const src = source.trim();
      const ref = providerRef.trim();
      if (!src || !ref) return undefined;
      const found = [...contacts.values()].find((c) => c.source === src && c.providerRef === ref);
      return found ? clone(found) : undefined;
    },
  };

  const matchRepo: BuyerCandidateProductMatchRepository = {
    async listByCandidate(candidateId) {
      return [...matches.values()]
        .filter((m) => m.candidateId === candidateId)
        .map(clone)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async create(input) {
      if (matches.has(input.id)) throw new Error(`match exists: ${input.id}`);
      matches.set(input.id, clone(input));
      return clone(input);
    },
    async update(id, patch) {
      const cur = matches.get(id);
      if (!cur) throw new Error(`match missing: ${id}`);
      const next = { ...cur, ...patch, id };
      matches.set(id, next);
      return clone(next);
    },
    async delete(id) {
      matches.delete(id);
    },
    async     findByCandidateAndProduct(candidateId: string, productId: ProductKey) {
      const found = [...matches.values()].find(
        (m) => m.candidateId === candidateId && m.productId === productId,
      );
      return found ? clone(found) : undefined;
    },
  };

  const publicEmailRepo: BuyerCandidatePublicEmailRepository = {
    async listByCandidate(candidateId) {
      return [...publicEmails.values()]
        .filter((e) => e.candidateId === candidateId)
        .map(clone)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async get(id) {
      const row = publicEmails.get(id);
      return row ? clone(row) : undefined;
    },
    async create(input) {
      if (publicEmails.has(input.id)) throw new Error(`public email exists: ${input.id}`);
      publicEmails.set(input.id, clone(input));
      return clone(input);
    },
    async update(id, patch) {
      const cur = publicEmails.get(id);
      if (!cur) throw new Error(`public email missing: ${id}`);
      const next = { ...cur, ...patch, id };
      publicEmails.set(id, next);
      return clone(next);
    },
    async delete(id) {
      publicEmails.delete(id);
    },
  };

  const revealEventRepo: BuyerFinderContactRevealEventRepository = {
    async insertPending(input) {
      const contact = contacts.get(input.contactId);
      if (contact && contact.candidateId !== input.candidateId) {
        throw new Error("reveal event contact does not belong to candidate");
      }
      const active = [...revealEvents.values()].find(
        (e) => e.contactId === input.contactId && isActiveRevealStatus(e.status),
      );
      if (active) throw new RevealEventActiveExistsError();
      const now = new Date().toISOString();
      const row: BuyerFinderContactRevealEvent = {
        id: input.contactId + "-reveal-" + String(revealEvents.size + 1),
        workspaceId: "memory",
        candidateId: input.candidateId,
        contactId: input.contactId,
        provider: "hunter",
        status: "pending",
        createdAt: now,
      };
      revealEvents.set(row.id, clone(row));
      return clone(row);
    },
    async get(id) {
      const row = revealEvents.get(id);
      return row ? clone(row) : undefined;
    },
    async getActiveForContact(contactId) {
      const found = [...revealEvents.values()]
        .filter((e) => e.contactId === contactId && isActiveRevealStatus(e.status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return found ? clone(found) : undefined;
    },
    async getLatestForContact(contactId) {
      const found = [...revealEvents.values()]
        .filter((e) => e.contactId === contactId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return found ? clone(found) : undefined;
    },
    async claimProcessing(id) {
      const cur = revealEvents.get(id);
      if (!cur || cur.status !== "pending") return undefined;
      const next: BuyerFinderContactRevealEvent = {
        ...cur,
        status: "processing",
        startedAt: new Date().toISOString(),
      };
      revealEvents.set(id, next);
      return clone(next);
    },
    async claimReconciliation(id) {
      const cur = revealEvents.get(id);
      if (!cur || cur.status !== "reconciliation_required") return undefined;
      const next: BuyerFinderContactRevealEvent = {
        ...cur,
        status: "processing",
        startedAt: new Date().toISOString(),
        completedAt: undefined,
        errorCode: undefined,
        providerOutcome: undefined,
        creditsCharged: null,
      };
      revealEvents.set(id, next);
      return clone(next);
    },
    async markReconciliationRequired(id) {
      const cur = revealEvents.get(id);
      if (!cur) throw new Error(`reveal event missing: ${id}`);
      const next: BuyerFinderContactRevealEvent = {
        ...cur,
        status: "reconciliation_required",
        completedAt: new Date().toISOString(),
        errorCode: "stale_processing",
      };
      revealEvents.set(id, next);
      return clone(next);
    },
    async finalize(id, patch: RevealEventFinalizeInput) {
      const cur = revealEvents.get(id);
      if (!cur) throw new Error(`reveal event missing: ${id}`);
      const next: BuyerFinderContactRevealEvent = {
        ...cur,
        status: patch.status,
        completedAt: new Date().toISOString(),
      };
      if (patch.providerOutcome !== undefined) {
        next.providerOutcome = patch.providerOutcome ?? undefined;
      }
      if (patch.creditsCharged !== undefined) next.creditsCharged = patch.creditsCharged;
      if (patch.errorCode !== undefined) next.errorCode = patch.errorCode ?? undefined;
      revealEvents.set(id, next);
      return clone(next);
    },
  };

  const freeEnrichmentJobRepo: BuyerFinderFreeEnrichmentJobRepository = {
    async ensure(input) {
      const existing = [...freeEnrichmentJobs.values()].find(
        (j) => j.candidateId === input.candidateId && j.capability === input.capability,
      );
      if (existing) return clone(existing);
      const now = new Date().toISOString();
      const row: FreeEnrichmentJob = {
        id: newEntityId(),
        workspaceId: "memory",
        candidateId: input.candidateId,
        capability: input.capability,
        status: input.alreadyComplete ? "succeeded" : "queued",
        attemptCount: 0,
        providerOutcome: input.alreadyComplete ? "already_complete" : undefined,
        createdAt: now,
        updatedAt: now,
        completedAt: input.alreadyComplete ? now : undefined,
      };
      freeEnrichmentJobs.set(row.id, row);
      return clone(row);
    },
    async get(id) {
      const row = freeEnrichmentJobs.get(id);
      return row ? clone(row) : undefined;
    },
    async getByCandidateCapability(candidateId, capability) {
      const found = [...freeEnrichmentJobs.values()].find(
        (j) => j.candidateId === candidateId && j.capability === capability,
      );
      return found ? clone(found) : undefined;
    },
    async listByCandidate(candidateId) {
      return [...freeEnrichmentJobs.values()]
        .filter((j) => j.candidateId === candidateId)
        .map(clone);
    },
    async listAll() {
      return [...freeEnrichmentJobs.values()].map(clone);
    },
    async claimNextDue(capability, now = new Date()) {
      const nowIso = now.toISOString();
      const processing = [...freeEnrichmentJobs.values()].filter(
        (j) => j.capability === capability && j.status === "processing",
      );
      if (processing.length > 0) return undefined;
      const due = [...freeEnrichmentJobs.values()]
        .filter((j) => j.capability === capability)
        .filter((j) => FREE_ENRICHMENT_CLAIMABLE_STATUSES.includes(j.status))
        .filter((j) => !j.nextAttemptAt || j.nextAttemptAt <= nowIso)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const next = due[0];
      if (!next) return undefined;
      next.status = "processing";
      next.startedAt = nowIso;
      next.attemptCount += 1;
      next.updatedAt = nowIso;
      freeEnrichmentJobs.set(next.id, next);
      return clone(next);
    },
    async prepareForManualExecution(id, now = new Date()) {
      const cur = freeEnrichmentJobs.get(id);
      if (!cur) return undefined;
      if (cur.status === "processing") return clone(cur);
      const nowIso = now.toISOString();
      if (cur.status === "queued" || cur.status === "retry_wait") {
        cur.nextAttemptAt = nowIso;
        cur.updatedAt = nowIso;
        freeEnrichmentJobs.set(id, cur);
        return clone(cur);
      }
      cur.status = "queued";
      cur.attemptCount = 0;
      cur.nextAttemptAt = undefined;
      cur.errorCode = undefined;
      cur.startedAt = undefined;
      cur.completedAt = undefined;
      cur.updatedAt = nowIso;
      freeEnrichmentJobs.set(id, cur);
      return clone(cur);
    },
    async claimById(id, now = new Date()) {
      const cur = freeEnrichmentJobs.get(id);
      if (!cur) return undefined;
      if (cur.status !== "queued" && cur.status !== "retry_wait") return undefined;
      const processing = [...freeEnrichmentJobs.values()].some(
        (j) => j.capability === cur.capability && j.status === "processing",
      );
      if (processing) return undefined;
      const nowIso = now.toISOString();
      cur.status = "processing";
      cur.startedAt = nowIso;
      cur.attemptCount += 1;
      cur.updatedAt = nowIso;
      freeEnrichmentJobs.set(id, cur);
      return clone(cur);
    },
    async reclaimStaleProcessing(now = new Date(), staleMs = FREE_ENRICHMENT_STALE_PROCESSING_MS) {
      const cutoff = new Date(now.getTime() - staleMs).toISOString();
      let n = 0;
      for (const job of freeEnrichmentJobs.values()) {
        if (job.status !== "processing" || !job.startedAt || job.startedAt >= cutoff) continue;
        job.status = "retry_wait";
        job.nextAttemptAt = now.toISOString();
        job.errorCode = "stale_processing";
        job.updatedAt = now.toISOString();
        n += 1;
      }
      return n;
    },
    async finalize(id, patch: FreeEnrichmentJobFinalizeInput) {
      const cur = freeEnrichmentJobs.get(id);
      if (!cur) throw new Error(`free enrichment job missing: ${id}`);
      const now = new Date().toISOString();
      const next: FreeEnrichmentJob = {
        ...cur,
        status: patch.status,
        updatedAt: now,
        providerOutcome:
          patch.providerOutcome === undefined ? cur.providerOutcome : patch.providerOutcome ?? undefined,
        errorCode: patch.errorCode === undefined ? cur.errorCode : patch.errorCode ?? undefined,
        nextAttemptAt:
          patch.nextAttemptAt === undefined ? cur.nextAttemptAt : patch.nextAttemptAt ?? undefined,
      };
      if (
        patch.status === "succeeded" ||
        patch.status === "no_result" ||
        patch.status === "failed" ||
        patch.status === "cancelled"
      ) {
        next.completedAt = patch.completedAt ?? now;
      }
      freeEnrichmentJobs.set(id, next);
      return clone(next);
    },
    async requeue(id) {
      const cur = freeEnrichmentJobs.get(id);
      if (!cur) return undefined;
      if (cur.status !== "failed" && cur.status !== "cancelled" && cur.status !== "retry_wait") {
        return undefined;
      }
      const now = new Date().toISOString();
      const next: FreeEnrichmentJob = {
        ...cur,
        status: "queued",
        attemptCount: 0,
        nextAttemptAt: undefined,
        errorCode: undefined,
        startedAt: undefined,
        completedAt: undefined,
        updatedAt: now,
      };
      freeEnrichmentJobs.set(id, next);
      return clone(next);
    },
    async cancelOpenForCandidate(candidateId) {
      let n = 0;
      const now = new Date().toISOString();
      for (const job of freeEnrichmentJobs.values()) {
        if (job.candidateId !== candidateId) continue;
        if (job.status !== "queued" && job.status !== "retry_wait" && job.status !== "processing") continue;
        job.status = "cancelled";
        job.completedAt = now;
        job.updatedAt = now;
        job.errorCode = "candidate_ineligible";
        n += 1;
      }
      return n;
    },
  };

  return {
    candidates: candidateRepo,
    contacts: contactRepo,
    productMatches: matchRepo,
    publicEmails: publicEmailRepo,
    revealEvents: revealEventRepo,
    freeEnrichmentJobs: freeEnrichmentJobRepo,
  };
}

export class InvalidEntityIdError extends Error {
  constructor(label: string, id: string) {
    super(`${label} id is not a UUID: ${id}`);
    this.name = "InvalidEntityIdError";
  }
}

function assertUuid(id: string, label: string): void {
  if (!isEntityUuid(id)) throw new InvalidEntityIdError(label, id);
}

/**
 * Memory repos that reject non-UUID ids the way Postgres UUID columns would.
 * Use this in tests that must not regress the slug-id production blocker.
 */
export function createUuidStrictBuyerFinderRepos() {
  const inner = createMemoryBuyerFinderRepos();

  const candidates: BuyerCandidateRepository = {
    list: () => inner.candidates.list(),
    findByDomain: (domain) => inner.candidates.findByDomain(domain),
    async get(id) {
      assertUuid(id, "candidate");
      return inner.candidates.get(id);
    },
    async create(input) {
      assertUuid(input.id, "candidate");
      return inner.candidates.create(input);
    },
    async update(id, patch) {
      assertUuid(id, "candidate");
      return inner.candidates.update(id, patch);
    },
    async delete(id) {
      assertUuid(id, "candidate");
      return inner.candidates.delete(id);
    },
  };

  const contacts: BuyerCandidateContactRepository = {
    async listByCandidate(candidateId) {
      assertUuid(candidateId, "candidate");
      return inner.contacts.listByCandidate(candidateId);
    },
    async get(id) {
      assertUuid(id, "contact");
      return inner.contacts.get(id);
    },
    async create(input) {
      assertUuid(input.id, "contact");
      assertUuid(input.candidateId, "candidate");
      return inner.contacts.create(input);
    },
    async update(id, patch) {
      assertUuid(id, "contact");
      return inner.contacts.update(id, patch);
    },
    async delete(id) {
      assertUuid(id, "contact");
      return inner.contacts.delete(id);
    },
    findByEmail: (email) => inner.contacts.findByEmail(email),
    findByProviderRef: (source, providerRef) => inner.contacts.findByProviderRef(source, providerRef),
  };

  const productMatches: BuyerCandidateProductMatchRepository = {
    async listByCandidate(candidateId) {
      assertUuid(candidateId, "candidate");
      return inner.productMatches.listByCandidate(candidateId);
    },
    async create(input) {
      assertUuid(input.id, "product match");
      assertUuid(input.candidateId, "candidate");
      return inner.productMatches.create(input);
    },
    async update(id, patch) {
      assertUuid(id, "product match");
      return inner.productMatches.update(id, patch);
    },
    async delete(id) {
      assertUuid(id, "product match");
      return inner.productMatches.delete(id);
    },
    async     findByCandidateAndProduct(candidateId, productId) {
      assertUuid(candidateId, "candidate");
      return inner.productMatches.findByCandidateAndProduct(candidateId, productId);
    },
  };

  const publicEmails: BuyerCandidatePublicEmailRepository = {
    async listByCandidate(candidateId) {
      assertUuid(candidateId, "candidate");
      return inner.publicEmails.listByCandidate(candidateId);
    },
    async get(id) {
      assertUuid(id, "public email");
      return inner.publicEmails.get(id);
    },
    async create(input) {
      assertUuid(input.id, "public email");
      assertUuid(input.candidateId, "candidate");
      return inner.publicEmails.create(input);
    },
    async update(id, patch) {
      assertUuid(id, "public email");
      return inner.publicEmails.update(id, patch);
    },
    async delete(id) {
      assertUuid(id, "public email");
      return inner.publicEmails.delete(id);
    },
  };

  return { candidates, contacts, productMatches, publicEmails, revealEvents: inner.revealEvents, freeEnrichmentJobs: inner.freeEnrichmentJobs };
}
