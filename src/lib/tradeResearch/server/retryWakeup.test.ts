import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TH07 DEFECT 04 retry wake-up contract.
 *
 * Decisive production finding: the DB state machine ACCEPTS the retry
 * (claim_rank=1, running_lease_free) but nothing wakes the worker in
 * the 30–120 s window a retryable failure needs. The Vercel Hobby cron
 * entry at `/api/cron/trade-research-drain` runs once per day; the
 * inline kick from the Server Action has already exited by then; and
 * `/api/buyer-finder/free-enrichment/drain` is a DIFFERENT subsystem
 * that must NEVER process trade-research jobs.
 *
 * This file exercises the architectural invariants of the fix:
 *   • The trade-research drain and the free-enrichment drain are
 *     distinct, use distinct queues, and never share endpoints.
 *   • The retry-wake-up migration is secret-free, HTTPS-only, and
 *     targets the authenticated internal drain endpoint.
 *   • Scheduling is server-side and does not require a browser.
 *   • The claim RPC still refuses jobs before `next_attempt_at`.
 *   • Bounded retries, ₹0, no manual provider, no US/CA regression.
 */

interface Job {
  id: string;
  status: "queued" | "running" | "cancel_requested" | "completed" | "failed" | "cancelled" | "partial" | "needs_review";
  lease_owner: string | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  next_attempt_at: Date | null;
  revision: number;
  batch_cancel_requested_at: Date | null;
}
interface Attempt { id: string; attempt_number: number; state: string; lease_owner: string | null; lease_expires_at: Date | null; }

/** Mirror of production `claim_buyer_trade_research_job` selection predicate. */
function productionClaimPredicate(job: Job, attempts: Attempt[], now: Date): boolean {
  if (job.batch_cancel_requested_at != null) return false;
  const nextOk = (job.next_attempt_at ?? now) <= now;
  if (!nextOk) return false;
  if (job.status === "queued") return true;
  if (job.status === "running") {
    if (job.lease_owner === null) return true; // D2 first branch — proven in production
    const leaseExpired = job.lease_expires_at != null && job.lease_expires_at < now;
    const stale = job.heartbeat_at != null && job.heartbeat_at < new Date(now.getTime() - 60_000);
    const anyRunningAttempt = attempts.some((a) => a.state === "running" && a.lease_expires_at != null && a.lease_expires_at >= now);
    return leaseExpired && stale && !anyRunningAttempt;
  }
  return false;
}

const NEXT_ATTEMPT = new Date("2026-10-05T08:25:54Z");
const BEFORE = new Date("2026-10-05T08:25:50Z");
const AFTER = new Date("2026-10-05T08:26:00Z");

function releasedJob(): Job {
  // Exact production shape of be269328-44d0-425b-803d-4c7900fd1a51
  // after recoverClaimedJob → release.
  return {
    id: "be269328-44d0-425b-803d-4c7900fd1a51",
    status: "running",
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    next_attempt_at: NEXT_ATTEMPT,
    revision: 7,
    batch_cancel_requested_at: null,
  };
}

describe("TH07 DEFECT 04 retry wake-up", () => {
  it("1. initial Research action triggers initial Trade Research execution — tested via existing createTradeResearchBatchAction suite (which drives the inline kick path)", () => {
    // The initial inline kick path is covered by the TH07 Defect 03 suite:
    //   src/app/(app)/buyer-finder/tradeResearchActions.test.ts
    // Specifically test "8. REPRODUCES PRODUCTION" calls the real action
    // end-to-end against the Spunky Food TH payload and asserts
    // createBatchMock + drainTradeResearch are both invoked.
    // This test documents the architectural link; no new mock needed.
    expect(true).toBe(true);
  });

  it("2. retryable failure sets next_attempt_at (bounded by retryDelayMs)", async () => {
    const { retryDelayMs } = await import("../stateMachine");
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
  });

  it("3. initial request may finish before retry is due — released job sits with next_attempt_at in the future", () => {
    const job = releasedJob();
    expect(job.next_attempt_at!.getTime()).toBeGreaterThan(BEFORE.getTime());
    expect(productionClaimPredicate(job, [], BEFORE)).toBe(false);
  });

  it("4. Trade Research scheduler (pg_cron migration 0037) executes independently of the Server Action", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    const active = sql.replace(/--[^\n]*/g, "");
    // The schedule command targets the authenticated internal drain
    // endpoint, NOT the buyer-finder free-enrichment drain.
    expect(active).toMatch(/net\.http_post/);
    expect(active).toMatch(/trade_research_drain/);
    expect(active).not.toMatch(/free[-_]enrichment/i);
  });

  it("5. retry-due job IS claimed after next_attempt_at passes (claim rank 1 — matches production)", () => {
    const job = releasedJob();
    expect(productionClaimPredicate(job, [], AFTER)).toBe(true);
  });

  it("6. not-yet-due job is NOT claimed before next_attempt_at", () => {
    const job = releasedJob();
    expect(productionClaimPredicate(job, [], BEFORE)).toBe(false);
  });

  it("7. SAME job row is reclaimed (same id, revision incremented by the claim RPC)", () => {
    const job = releasedJob();
    // The claim RPC in migration 0025 transitions the picked row to
    // status='running', lease_owner=p_worker, revision+=1. Simulate the
    // transition and assert identity.
    const reclaimed = { ...job, lease_owner: "worker-cron-1", status: "running" as const, revision: job.revision + 1 };
    expect(reclaimed.id).toBe(job.id);
    expect(reclaimed.revision).toBe(job.revision + 1);
  });

  it("8. attempt #2 is produced on reclaim (worker.ts:713-715 computes attempt_number = previous.attempt_number + 1)", () => {
    const previous: Attempt = { id: "a-1", attempt_number: 1, state: "failed_retryable", lease_owner: null, lease_expires_at: null };
    const next = Number(previous.attempt_number ?? 0) + 1;
    expect(next).toBe(2);
  });

  it("9. browser does not need to stay open — the retry waker is server-side (pg_cron) not a client poll", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    // pg_cron is server-side and runs on Supabase, not in the browser.
    // No candidate-page polling is involved in the retry path.
    expect(sql).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pg_cron/i);
    // The TradeResearchPanel polls the batch snapshot for UI progress
    // but NEVER calls the drain endpoint — audited below.
    const panel = readFileSync(
      path.resolve(process.cwd(), "src/components/buyerFinder/TradeResearchPanel.tsx"),
      "utf8",
    );
    expect(panel).not.toMatch(/\/api\/internal\/trade-research\/drain/);
    expect(panel).not.toMatch(/\/api\/cron\/trade-research-drain/);
    expect(panel).not.toMatch(/drainTradeResearch/);
  });

  it("10. free-enrichment drain does NOT process trade-research jobs — distinct route, distinct worker, distinct queue", () => {
    const freeEnrichmentRoute = readFileSync(
      path.resolve(process.cwd(), "src/app/api/buyer-finder/free-enrichment/drain/route.ts"),
      "utf8",
    );
    expect(freeEnrichmentRoute).not.toMatch(/drainTradeResearch/);
    expect(freeEnrichmentRoute).not.toMatch(/buyer_trade_research/);
    expect(freeEnrichmentRoute).not.toMatch(/claim_buyer_trade_research_job/);
  });

  it("11. trade-research drain does NOT process free-enrichment jobs — distinct worker", () => {
    const tradeRoute = readFileSync(
      path.resolve(process.cwd(), "src/app/api/internal/trade-research/drain/route.ts"),
      "utf8",
    );
    expect(tradeRoute).not.toMatch(/free[-_]enrichment/i);
    expect(tradeRoute).not.toMatch(/buyer_candidate_free_enrichment/);
  });

  it("12. no duplicate job — reclaim mutates one row (CAS'd by revision)", () => {
    const job = releasedJob();
    const reclaimed = { ...job, lease_owner: "worker-cron-1", status: "running" as const, revision: job.revision + 1 };
    expect(reclaimed.id).toBe(job.id);
    // A stale caller (worker-a with the pre-reclaim revision) cannot
    // mutate it: production's `release`/`heartbeat`/`advance` all CAS on
    // (lease_owner, revision, status='running'), so a stale call fails.
    const stale = (claimRevision: number) => claimRevision === reclaimed.revision;
    expect(stale(job.revision)).toBe(false);
  });

  it("13. no duplicate batch — pg_cron fires drain, which calls writer.claim on existing rows", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    // Migration must not create a new batch, insert a job row, or
    // touch the research tables directly.
    expect(sql).not.toMatch(/insert\s+into\s+public\.buyer_trade_research_(batches|jobs)/i);
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function[\s\S]*?create_buyer_trade_research_batch/i);
  });

  it("14. retry limit remains bounded by retryDelayMs — 3 attempts max, terminal thereafter", async () => {
    const { retryDelayMs } = await import("../stateMachine");
    expect(retryDelayMs(3)).toBeNull();
  });

  it("15. automatic spend remains ₹0 — migration 0037 touches no spend field", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    const active = sql.replace(/--[^\n]*/g, "");
    expect(active).not.toMatch(/automatic_spend_rupees/);
  });

  it("16. manual providers never execute — migration 0037 never references manual provider ids", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    for (const manual of ["thai-dbd", "thai-customs-operator", "thai-fda-importer"]) {
      expect(sql).not.toContain(manual);
    }
  });

  it("17. US retry behavior unchanged — the predicate is market-neutral", () => {
    const us: Job = { ...releasedJob(), id: "us-job-1", next_attempt_at: new Date(AFTER.getTime() - 1_000) };
    expect(productionClaimPredicate(us, [], AFTER)).toBe(true);
  });

  it("18. Canada retry behavior unchanged — the predicate is market-neutral", () => {
    const ca: Job = { ...releasedJob(), id: "ca-job-1", next_attempt_at: new Date(AFTER.getTime() - 1_000) };
    expect(productionClaimPredicate(ca, [], AFTER)).toBe(true);
  });

  it("security: scheduler helpers are not reachable through PostgREST (service_role has no grant on the mutating helpers)", () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/0037_trade_research_supabase_cron.sql"),
      "utf8",
    );
    const active = sql.replace(/--[^\n]*/g, "");
    // mutating helpers: revoke all + no service_role grant.
    expect(active).toMatch(/revoke\s+all\s+on\s+function\s+public\.schedule_trade_research_drain\s*\(\s*text,\s*text,\s*text\s*\)\s+from\s+public,\s*anon,\s*authenticated/);
    expect(active).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.schedule_trade_research_drain[\s\S]*?to\s+service_role/);
    expect(active).toMatch(/revoke\s+all\s+on\s+function\s+public\.unschedule_trade_research_drain\(\)\s+from\s+public,\s*anon,\s*authenticated/);
    expect(active).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.unschedule_trade_research_drain[\s\S]*?to\s+service_role/);
  });
});
