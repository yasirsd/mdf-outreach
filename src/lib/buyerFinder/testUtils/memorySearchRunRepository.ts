import {
  canTransitionStage,
  type BuyerFinderSearchRun,
  type SearchRunPatch,
} from "../searchRun";
import type {
  BuyerFinderSearchRunCreateInput,
  BuyerFinderSearchRunRepository,
} from "@/lib/repositories/interfaces";
import { SearchRunActiveExistsError } from "@/lib/repositories/interfaces";

function clone<T>(v: T): T {
  return structuredClone(v);
}

export interface MemorySearchRunStore {
  rows: Map<string, BuyerFinderSearchRun>;
}

export function createMemorySearchRunStore(): MemorySearchRunStore {
  return { rows: new Map() };
}

let seq = 0;

function nextId(): string {
  seq += 1;
  const n = seq.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
}

/**
 * In-memory Search Run repo. Workspace isolation is enforced here the
 * same way RLS + constructor workspaceId enforce it in production: a
 * repo constructed for workspace A cannot read or claim workspace B.
 */
export function createMemorySearchRunRepository(
  workspaceId: string,
  store: MemorySearchRunStore = createMemorySearchRunStore(),
  now: () => string = () => new Date().toISOString(),
): BuyerFinderSearchRunRepository {
  function scoped(id: string): BuyerFinderSearchRun | undefined {
    const row = store.rows.get(id);
    if (!row || row.workspaceId !== workspaceId) return undefined;
    return row;
  }

  const repo: BuyerFinderSearchRunRepository = {
    async create(input: BuyerFinderSearchRunCreateInput) {
      for (const row of store.rows.values()) {
        if (
          row.workspaceId === workspaceId &&
          (row.status === "queued" || row.status === "running")
        ) {
          throw new SearchRunActiveExistsError();
        }
      }
      const ts = now();
      const row: BuyerFinderSearchRun = {
        id: nextId(),
        workspaceId,
        country: input.country,
        businessProductId: input.businessProductId,
        desiredBuyerTypes: [...input.desiredBuyerTypes],
        contactPriorities: [...input.contactPriorities],
        provider: "hunter",
        providerStatus: null,
        status: "queued",
        stage: "preparing",
        discoveredCount: 0,
        usableCount: 0,
        processedCount: 0,
        createdCount: 0,
        enrichedExistingCount: 0,
        duplicateCount: 0,
        productMatchesAdded: 0,
        failureCount: 0,
        creditsUsed: 0,
        costClass: "free",
        createdAt: ts,
        updatedAt: ts,
      };
      store.rows.set(row.id, row);
      return clone(row);
    },

    async get(id: string) {
      const row = scoped(id);
      return row ? clone(row) : undefined;
    },

    async update(id: string, patch: SearchRunPatch) {
      const cur = scoped(id);
      if (!cur) throw new Error(`search run missing: ${id}`);
      const nextStage =
        patch.stage && canTransitionStage(cur.stage, patch.stage) ? patch.stage : cur.stage;
      const next: BuyerFinderSearchRun = {
        ...cur,
        ...patch,
        id: cur.id,
        workspaceId: cur.workspaceId,
        provider: "hunter",
        creditsUsed: 0,
        costClass: "free",
        stage: nextStage,
        updatedAt: now(),
      };
      store.rows.set(id, next);
      return clone(next);
    },

    async getLatestActive() {
      const active = [...store.rows.values()]
        .filter(
          (r) =>
            r.workspaceId === workspaceId &&
            (r.status === "queued" || r.status === "running"),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return active[0] ? clone(active[0]) : undefined;
    },

    async claimQueued(id: string) {
      const cur = scoped(id);
      if (!cur || cur.status !== "queued") return undefined;
      const ts = now();
      const next: BuyerFinderSearchRun = {
        ...cur,
        status: "running",
        stage: "preparing",
        startedAt: ts,
        updatedAt: ts,
      };
      store.rows.set(id, next);
      return clone(next);
    },
  };

  return repo;
}
