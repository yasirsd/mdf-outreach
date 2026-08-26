import type {
  BuyerCandidate,
  BuyerCandidateContact,
  BuyerCandidateProductMatch,
} from "@/lib/buyerFinder/types";
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
    async findByCandidateAndProduct(candidateId: string, productKey: ProductKey) {
      const found = [...matches.values()].find(
        (m) => m.candidateId === candidateId && m.productKey === productKey,
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
