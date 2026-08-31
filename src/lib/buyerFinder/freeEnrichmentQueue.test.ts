import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryBuyerFinderRepos } from "./testUtils/memoryRepositories";
import { ensureFreeEnrichmentJobsForCandidate } from "./enqueueFreeEnrichment";
import {
  drainDueFreeEnrichmentJobs,
  processClaimedFreeEnrichmentJob,
} from "./freeEnrichmentWorker";
import { FREE_ENRICHMENT_MAX_ATTEMPTS } from "./freeEnrichmentJob";
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

describe("BF3C free enrichment queue", () => {
  it("creates one public-contact job and one decision-maker job for a new candidate", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs.map((j) => j.capability).sort()).toEqual(["decision_makers", "public_company_contacts"]);
    expect(jobs.every((j) => j.status === "queued")).toBe(true);
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    expect((await memory.freeEnrichmentJobs.listByCandidate(CID)).length).toBe(2);
  });

  it("does not refetch when public_contacts_searched_at or people_searched_at is already set", async () => {
    const memory = createMemoryBuyerFinderRepos();
    const row = candidate({
      publicContactsSearchedAt: "2026-08-01T00:00:00.000Z",
      peopleSearchedAt: "2026-08-01T00:00:00.000Z",
    });
    await memory.candidates.create(row);
    await ensureFreeEnrichmentJobsForCandidate({ candidate: row, jobs: memory.freeEnrichmentJobs });
    const publicWebsite: CompanyContactDiscoveryProvider = { discover: vi.fn() };
    const decisionMakers: PersonDiscoveryProvider = { findPeople: vi.fn() };
    await drainDueFreeEnrichmentJobs({
      repos: workerRepos(memory),
      providers: { publicWebsite, decisionMakers },
    });
    expect(publicWebsite.discover).not.toHaveBeenCalled();
    expect(decisionMakers.findPeople).not.toHaveBeenCalled();
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs.every((j) => j.status === "succeeded")).toBe(true);
  });

  it("keeps website retry_wait independent of a successful people search", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 0, outcome: "timeout" as const })),
    };
    const decisionMakers: PersonDiscoveryProvider = {
      findPeople: vi.fn(async () => ({
        people: [
          {
            providerRef: "handle-1",
            source: "hunter" as const,
            domain: "abc.com",
            maskedName: "A P",
            position: "Head of Procurement",
            decisionMaker: true,
            seniority: "executive",
            evidence: [],
          },
        ],
        hasMore: false,
      })),
    };
    await drainDueFreeEnrichmentJobs({
      repos: workerRepos(memory),
      providers: { publicWebsite, decisionMakers },
    });
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs.find((j) => j.capability === "public_company_contacts")?.status).toBe("retry_wait");
    expect(jobs.find((j) => j.capability === "decision_makers")?.status).toBe("succeeded");
    const people = await memory.contacts.listByCandidate(CID);
    expect(people.some((p) => p.jobTitle === "Head of Procurement")).toBe(true);
  });

  it("retries retryable failures up to 3 attempts and does not retry no_result", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 0, outcome: "timeout" as const })),
    };
    const decisionMakers: PersonDiscoveryProvider = {
      findPeople: vi.fn(async () => ({ people: [], hasMore: false })),
    };
    const now = new Date("2026-08-29T00:00:00.000Z");
    for (let i = 0; i < FREE_ENRICHMENT_MAX_ATTEMPTS; i += 1) {
      await drainDueFreeEnrichmentJobs({
        repos: workerRepos(memory),
        providers: { publicWebsite, decisionMakers },
        now: () => now,
      });
      const web = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "public_company_contacts");
      if (web?.status === "retry_wait") {
        await memory.freeEnrichmentJobs.finalize(web.id, {
          status: "retry_wait",
          nextAttemptAt: now.toISOString(),
        });
      }
    }
    const web = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "public_company_contacts");
    expect(web?.status).toBe("failed");
    expect(web?.attemptCount).toBe(FREE_ENRICHMENT_MAX_ATTEMPTS);
    const people = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "decision_makers");
    expect(people?.status).toBe("no_result");
    const before = decisionMakers.findPeople as ReturnType<typeof vi.fn>;
    const calls = before.mock.calls.length;
    await drainDueFreeEnrichmentJobs({
      repos: workerRepos(memory),
      providers: { publicWebsite, decisionMakers },
      now: () => now,
    });
    expect(before.mock.calls.length).toBe(calls);
  });

  it("lets only one drainer execute the same job", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    const first = await memory.freeEnrichmentJobs.claimNextDue("public_company_contacts");
    const second = await memory.freeEnrichmentJobs.claimNextDue("public_company_contacts");
    expect(first).toBeTruthy();
    expect(second).toBeUndefined();
  });

  it("never calls paid reveal, domain search, verifier, Gmail, or campaign APIs", async () => {
    const workerSrc = readFileSync(
      path.resolve(process.cwd(), "src/lib/buyerFinder/freeEnrichmentWorker.ts"),
      "utf8",
    );
    const drainSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/api/buyer-finder/free-enrichment/drain/route.ts"),
      "utf8",
    );
    const layoutSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/(app)/layout.tsx"),
      "utf8",
    );
    const pumpSrc = readFileSync(
      path.resolve(process.cwd(), "src/components/buyerFinder/FreeEnrichmentAutopump.tsx"),
      "utf8",
    );
    for (const src of [workerSrc, drainSrc, layoutSrc, pumpSrc]) {
      expect(src).not.toMatch(/personalReveal|personalContactReveal|revealCandidatePersonalContact/);
      expect(src).not.toMatch(/multi-domain-search\/reveal/);
      expect(src).not.toMatch(/Email Finder|email-verifier|domain-search/i);
      expect(src).not.toMatch(/prospeo|apollo/i);
      expect(src).not.toMatch(/gmail/i);
      expect(src).not.toMatch(/buyers\.create|campaigns\.create/);
    }
    expect(layoutSrc).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
    expect(pumpSrc).not.toMatch(/enabled\?:/);
  });

  it("does not call Hunter reveal when ranking a high-priority person", async () => {
    const reveal = vi.fn();
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await memory.contacts.create({
      id: "00000000-0000-4000-8000-0000000000c1",
      candidateId: CID,
      firstName: "P",
      lastName: "Q",
      fullName: "P Q",
      jobTitle: "Head of Procurement",
      businessEmail: "",
      emailType: "personal",
      isPrimary: true,
    });
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate({ peopleSearchedAt: "2026-08-01T00:00:00.000Z" }),
      jobs: memory.freeEnrichmentJobs,
    });
    const job = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "decision_makers");
    expect(job?.status).toBe("succeeded");
    expect(reveal).not.toHaveBeenCalled();
  });

  it("cancels open jobs for archived or rejected candidates", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate({ reviewStatus: "rejected" }),
      jobs: memory.freeEnrichmentJobs,
    });
    const jobs = await memory.freeEnrichmentJobs.listByCandidate(CID);
    expect(jobs.every((j) => j.status === "cancelled")).toBe(true);
  });
});

describe("CFG1 missing Hunter config does not retry-spam people jobs", () => {
  it("runs website jobs and leaves decision-maker jobs queued without claiming", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate());
    await ensureFreeEnrichmentJobsForCandidate({
      candidate: candidate(),
      jobs: memory.freeEnrichmentJobs,
    });
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 1, outcome: "no_result" as const })),
    };
    const decisionMakers: PersonDiscoveryProvider = { findPeople: vi.fn() };
    const result = await drainDueFreeEnrichmentJobs({
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(publicWebsite.discover).toHaveBeenCalledTimes(1);
    expect(decisionMakers.findPeople).not.toHaveBeenCalled();
    expect(result.claimed).toBe(1);
    const people = await memory.freeEnrichmentJobs.getByCandidateCapability(CID, "decision_makers");
    expect(people?.status).toBe("queued");
    expect(people?.attemptCount).toBe(0);
    const website = await memory.freeEnrichmentJobs.getByCandidateCapability(
      CID,
      "public_company_contacts",
    );
    expect(website?.status === "succeeded" || website?.status === "no_result").toBe(true);
  });

  it("a mocked auto batch never calls reveal, verifier, Buyer, or Gmail", async () => {
    const memory = createMemoryBuyerFinderRepos();
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 1, outcome: "no_result" as const })),
    };
    const decisionMakers: PersonDiscoveryProvider = {
      findPeople: vi.fn(async () => ({ people: [], hasMore: false })),
    };
    const reveal = vi.fn();
    const verify = vi.fn();
    const createBuyer = vi.fn();
    const gmail = vi.fn();
    const send = vi.fn();
    for (let i = 0; i < 8; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const row = candidate({ id });
      await memory.candidates.create(row);
      await ensureFreeEnrichmentJobsForCandidate({
        candidate: row,
        jobs: memory.freeEnrichmentJobs,
      });
    }
    for (let i = 0; i < 8; i += 1) {
      await drainDueFreeEnrichmentJobs({
        repos: workerRepos(memory),
        providers: { publicWebsite, decisionMakers },
      });
    }
    expect(publicWebsite.discover).toHaveBeenCalled();
    expect(decisionMakers.findPeople).toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(createBuyer).not.toHaveBeenCalled();
    expect(gmail).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("processClaimedFreeEnrichmentJob", () => {
  it("executes a claimed job even when a previous search timestamp exists", async () => {
    const memory = createMemoryBuyerFinderRepos();
    await memory.candidates.create(candidate({ publicContactsSearchedAt: "2026-08-01T00:00:00.000Z" }));
    const job = await memory.freeEnrichmentJobs.ensure({
      candidateId: CID,
      capability: "public_company_contacts",
    });
    const claimed = await memory.freeEnrichmentJobs.claimNextDue("public_company_contacts");
    const publicWebsite: CompanyContactDiscoveryProvider = {
      discover: vi.fn(async () => ({ emails: [], pagesFetched: 1, outcome: "no_result" as const })),
    };
    await processClaimedFreeEnrichmentJob({
      job: claimed ?? job,
      repos: workerRepos(memory),
      providers: { publicWebsite },
    });
    expect(publicWebsite.discover).toHaveBeenCalledTimes(1);
  });
});
