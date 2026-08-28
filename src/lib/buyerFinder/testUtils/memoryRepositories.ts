import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
} from "@/lib/buyerFinder/types";
import { isEntityUuid } from "@/lib/buyerFinder/ids";
import { normalizeDomain, normalizeOptionalEmail } from "@/lib/buyerFinder/normalize";
import type { ProductKey } from "@/lib/email/themes/types";
import type {
  BuyerCandidateContactRepository,
  BuyerCandidateProductMatchRepository,
  BuyerCandidateRepository,
} from "@/lib/repositories/interfaces";

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** In-memory Buyer Finder repos for Phase 4 tests. Not a production store. */
export function createMemoryBuyerFinderRepos() {
  const candidates = new Map<string, BuyerCandidate>();
  const contacts = new Map<string, BuyerCandidateContact>();
  const matches = new Map<string, BuyerCandidateProductMatch>();

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
    async findByCandidateAndProduct(candidateId: string, productId: ProductKey) {
      const found = [...matches.values()].find(
        (m) => m.candidateId === candidateId && m.productId === productId,
      );
      return found ? clone(found) : undefined;
    },
  };

  return {
    candidates: candidateRepo,
    contacts: contactRepo,
    productMatches: matchRepo,
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
    async findByCandidateAndProduct(candidateId, productId) {
      assertUuid(candidateId, "candidate");
      return inner.productMatches.findByCandidateAndProduct(candidateId, productId);
    },
  };

  return { candidates, contacts, productMatches };
}
