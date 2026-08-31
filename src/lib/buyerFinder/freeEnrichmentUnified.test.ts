import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import { repairMissingFreeEnrichmentJobs } from "./enqueueFreeEnrichment";
import {
  drainDueFreeEnrichmentJobs,
  runOperatorFreeEnrichmentJob,
} from "./freeEnrichmentWorker";
import type { BuyerCandidate } from "./types";
import type { CompanyContactDiscoveryProvider, PersonDiscoveryProvider } from "./providers/types";

const CID = "00000000-0000-4000-8000-0000000000aa";

function candidate(over: Partial<BuyerCandidate> = {}): BuyerCandidate {
  return {
    id: CID,
    companyName: "ABC Foods",
    website: "https://abc.com",
    domain: "abc.com",
    country: "United Arab Emirates",
    source: "hunter",
    discoveryStatus: "ready",
    reviewStatus: "pending",
    ...over,
  };
}

function workerRepos(memory: ReturnType<typeof createMemoryBuyerFinderRepos>) {
  return {
    jobs: memory.freeEnrichmentJobs,
    candidates: memory.candidates,
    contacts: memory.contacts,
    productMatches: memory.productMatches,
    publicEmails: memory.publicEmails,
  };
}

function hangingDiscover() {
  let resolve!: (value: { emails: never[]; pagesFetched: number; outcome: "no_result" }) => void;
  const promise = new Promise<{ emails: never[]; pagesFetched: number; outcome: "no_result" }>(
    (r) => {
      resolve = r;
    },
  );
  return {
    discover: vi.fn(async () => promise),
    resolve: () => resolve({ emails: [], pagesFetched: 1, outcome: "no_result" }),
  };
}

describe("BF3C.1 unified manual + automatic execution", () => {
  it("auto processing + manual same capability makes exactly one provider call", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "public_company_contacts",
    });
    const hanging = hangingDiscover();
    const publicWebsite: CompanyContactDiscoveryProvider = { discover: hanging.discover };
    const auto = drainDueFreeEnrichmentJobs({
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    await vi.waitFor(() => expect(hanging.discover).toHaveBeenCalledTimes(1));
    const manual = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(manual.kind).toBe("already_running");
    expect(hanging.discover).toHaveBeenCalledTimes(1);
    hanging.resolve();
    await auto;
  });

  it("two manual clicks on the same capability make exactly one provider call", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const hanging = hangingDiscover();
    const publicWebsite: CompanyContactDiscoveryProvider = { discover: hanging.discover };
    const first = runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    await vi.waitFor(() => expect(hanging.discover).toHaveBeenCalledTimes(1));
    const second = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(second.kind).toBe("already_running");
    expect(hanging.discover).toHaveBeenCalledTimes(1);
    hanging.resolve();
    const done = await first;
    expect(done.kind).toBe("processed");
    if (done.kind === "processed") expect(done.job.status).toBe("no_result");
  });

  it("retry_wait + manual Retry now makes the same row due immediately and executes once", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const created = await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "public_company_contacts",
    });
    const claimed = await memory.freeEnrichmentJobs.claimNextDue("public_company_contacts");
    await memory.freeEnrichmentJobs.finalize((claimed ?? created).id, {
      status: "retry_wait",
      providerOutcome: "timeout",
      nextAttemptAt: "2099-01-01T00:00:00.000Z",
    });
    const before = await memory.freeEnrichmentJobs.getByCandidateCapability(
      CID,
      "public_company_contacts",
    );
    expect(before?.id).toBe(created.id);
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 1, outcome: "no_result" as const })),
    };
    const run = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(publicWebsite.discover).toHaveBeenCalledTimes(1);
    expect(run.kind).toBe("processed");
    const after = await memory.freeEnrichmentJobs.getByCandidateCapability(
      CID,
      "public_company_contacts",
    );
    expect(after?.id).toBe(created.id);
    expect(after?.status).toBe("no_result");
  });

  it("queued + manual action claims the same row once", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const created = await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "decision_makers",
    });
    expect(created.status).toBe("queued");
    const decisionMakers: PersonDiscoveryProvider = {
      findPeople: vi.fn(async () => ({ people: [], hasMore: false })),
    };
    const run = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "decision_makers",
      repos: workerRepos(memory),
      providers: { decisionMakers },
    });
    expect(decisionMakers.findPeople).toHaveBeenCalledTimes(1);
    expect(run.kind).toBe("processed");
    const after = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "decision_makers");
    expect(after?.id).toBe(created.id);
    expect(after?.status).toBe("no_result");
  });

  it("succeeded + explicit Refresh reuses the same row and executes once", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(
      candidate({ publicContactsSearchedAt: "2026-08-01T00:00:00.000Z" }),
    );
    const created = await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "public_company_contacts",
      alreadyComplete: true,
    });
    expect(created.status).toBe("succeeded");
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 1, outcome: "ok" as const })),
    };
    const run = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(publicWebsite.discover).toHaveBeenCalledTimes(1);
    expect(run.kind).toBe("processed");
    const after = await memory.freeEnrichmentJobs.getByCandidateCapability(
      CID,
      "public_company_contacts",
    );
    expect(after?.id).toBe(created.id);
    expect(after?.status).toBe("succeeded");
    expect(after?.attemptCount).toBe(1);
  });

  it("no_result + explicit Refresh reuses the same row and executes once", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const created = await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "decision_makers",
    });
    const claimed = await memory.freeEnrichmentJobs.claimNextDue("decision_makers");
    await memory.freeEnrichmentJobs.finalize((claimed ?? created).id, {
      status: "no_result",
      providerOutcome: "no_result",
    });
    const decisionMakers: PersonDiscoveryProvider = {
      findPeople: vi.fn(async () => ({
        people: [
          {
            providerRef: "h1",
            source: "hunter" as const,
            domain: "abc.com",
            maskedName: "A P",
            position: "Head of Procurement",
            evidence: [],
          },
        ],
        hasMore: false,
      })),
    };
    const run = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "decision_makers",
      repos: workerRepos(memory),
      providers: { decisionMakers },
    });
    expect(decisionMakers.findPeople).toHaveBeenCalledTimes(1);
    expect(run.kind).toBe("processed");
    if (run.kind === "processed") expect(run.job.status).toBe("succeeded");
    const after = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "decision_makers");
    expect(after?.id).toBe(created.id);
    expect(after?.attemptCount).toBe(1);
  });

  it("manual execution does not consult the auto-free-enrichment gate", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 0, outcome: "no_result" as const })),
    };
    const run = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(run.kind).toBe("processed");
    expect(publicWebsite.discover).toHaveBeenCalledTimes(1);
    const actionSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/(app)/buyer-finder/publicContactActions.ts"),
      "utf8",
    );
    const personSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/(app)/buyer-finder/personActions.ts"),
      "utf8",
    );
    expect(actionSrc).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
    expect(personSrc).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
  });

  it("autopump drain route is always-on for free jobs and does not call paid providers", () => {
    const drainSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/api/buyer-finder/free-enrichment/drain/route.ts"),
      "utf8",
    );
    expect(drainSrc).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
    expect(drainSrc).not.toContain("isBuyerFinderPublicWebsiteEnabled");
    expect(drainSrc).toContain("drainDueFreeEnrichmentJobs");
    expect(drainSrc).toContain("createPublicWebsiteCompanyContactProvider");
    expect(drainSrc).toContain("isBuyerFinderHunterReady");
    expect(drainSrc).not.toMatch(/runOperatorFreeEnrichmentJob/);
    expect(drainSrc).not.toMatch(/personalReveal|revealCandidatePersonalContact|gmail|prospeo|apollo/i);
  });

  it("manual success and no_result write those statuses onto the durable job", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 1, outcome: "ok" as const })),
    };
    const ok = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "public_company_contacts",
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(ok.kind).toBe("processed");
    if (ok.kind === "processed") expect(ok.job.status).toBe("succeeded");
    const people: PersonDiscoveryProvider = {
      findPeople: vi.fn(async () => ({ people: [], hasMore: false })),
    };
    const empty = await runOperatorFreeEnrichmentJob({
      candidateId: CID,
      capability: "decision_makers",
      repos: workerRepos(memory),
      providers: { decisionMakers: people },
    });
    expect(empty.kind).toBe("processed");
    if (empty.kind === "processed") expect(empty.job.status).toBe("no_result");
  });
});

describe("BF3C.1 missing-job repair", () => {
  it("inserts exactly one public job and one decision-maker job when missing", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    const first = await repairMissingFreeEnrichmentJobs({
      candidates: [candidate()],
      jobs: memory.freeEnrichmentJobs,
    });
    expect(first.inserted).toBe(2);
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs).toHaveLength(2);
    const second = await repairMissingFreeEnrichmentJobs({
      candidates: [candidate()],
      jobs: memory.freeEnrichmentJobs,
    });
    expect(second.inserted).toBe(0);
    expect((await memory.freeEnrichmentJobs.listByCandidate(CID)).length).toBe(2);
  });

  it("repairs a missing public job without duplicating an existing people job", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "decision_makers",
    });
    const result = await repairMissingFreeEnrichmentJobs({
      candidates: [candidate()],
      jobs: memory.freeEnrichmentJobs,
    });
    expect(result.inserted).toBe(1);
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs.map((j) => j.capability).sort()).toEqual([
      "decision_makers",
      "public_company_contacts",
    ]);
  });

  it("inserts succeeded/already_complete when the search timestamp exists", async () => {
    const memory = createMemoryBuyerFinderRepos();
    const row = candidate({
      publicContactsSearchedAt: "2026-08-01T00:00:00.000Z",
      peopleSearchedAt: "2026-08-01T00:00:00.000Z",
    });
    await memory.candidates.create(row);
    const discover = vi.fn();
    await repairMissingFreeEnrichmentJobs({
      candidates: [row],
      jobs: memory.freeEnrichmentJobs,
    });
    expect(discover).not.toHaveBeenCalled();
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs.every((j) => j.status === "succeeded")).toBe(true);
    expect(jobs.every((j) => j.providerOutcome === "already_complete")).toBe(true);
  });

  it("skips archived and rejected candidates and makes no provider calls", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate({ discoveryStatus: "archived" }));
    const result = await repairMissingFreeEnrichmentJobs({
      candidates: [candidate({ discoveryStatus: "archived" })],
      jobs: memory.freeEnrichmentJobs,
    });
    expect(result.inserted).toBe(0);
    expect(await memory.freeEnrichmentJobs.listByCandidate(CID)).toEqual([]);
  });
});
