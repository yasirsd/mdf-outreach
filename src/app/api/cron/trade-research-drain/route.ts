import "server-only";

/**
 * BI4F Phase 2A — background trade-research scheduler.
 *
 * Zero-cost server-to-server scheduler that keeps the queued
 * `buyer_trade_research_jobs` moving without any browser session,
 * DevTools invocation, or manual drain. Vercel Cron issues a GET to
 * this route on the configured schedule; the route authorizes the
 * request against `CRON_SECRET` (Vercel's own header) OR the existing
 * `TRADE_RESEARCH_DRAIN_SECRET` and then invokes the audited
 * `drainTradeResearch()` worker with the service-role client.
 *
 * Contract:
 *   • GET only. Vercel Cron sends GET.
 *   • Auth: Bearer token in `Authorization`, matching either
 *     `CRON_SECRET` (Vercel-managed, injected automatically for cron)
 *     or `TRADE_RESEARCH_DRAIN_SECRET` (operator-managed, used by
 *     external heartbeats or QA calls).
 *   • Bounded: reuses the existing `JOBS_PER_DRAIN = 2` /
 *     `TIME_BUDGET_MS = 45_000` limits — the scheduler ticks again
 *     later, it does not increase per-invocation batch size.
 *   • No writer, no client, no browser dependency.
 *   • The secret NEVER appears in the response body or logs.
 *   • Response: `{ outcome: "processed" | "no_work" | "failed", ...counters }`.
 *     A `no_work` response is a normal, healthy tick.
 *
 * Cadence: see `vercel.json` — currently every two minutes
 * (cron `star-slash-2 star star star star`). That is safe on Vercel's
 * Pro plan and on Hobby plans that support per-minute cron. Operators
 * on a plan restricted to daily crons should widen the schedule in
 * `vercel.json` (e.g. `0 star star star star` for hourly).
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { logTradeResearchDiagnostic, safeTradeResearchErrorCode } from "@/lib/tradeResearch/server/diagnostics";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { createTradeResearchDeadline, drainTradeResearch, TradeResearchDrainExecutionError } from "@/lib/tradeResearch/server/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const JOBS_PER_DRAIN = 2;
const TIME_BUDGET_MS = 45_000;

function extractBearer(request: Request): string | undefined {
  const raw = request.headers.get("authorization");
  if (!raw) return undefined;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Two accepted secrets: `CRON_SECRET` (Vercel-managed, populated
 * automatically on Cron invocations) OR `TRADE_RESEARCH_DRAIN_SECRET`
 * (operator-managed, used for external heartbeats). Either is
 * sufficient; both compared in constant time. The secret bytes are
 * never included in the response or the log.
 */
function isSchedulerAuthorized(request: Request): boolean {
  const supplied = extractBearer(request);
  if (!supplied) return false;
  const cronSecret = process.env.CRON_SECRET?.trim();
  const drainSecret = process.env.TRADE_RESEARCH_DRAIN_SECRET?.trim();
  if (cronSecret && constantTimeEqual(cronSecret, supplied)) return true;
  if (drainSecret && constantTimeEqual(drainSecret, supplied)) return true;
  return false;
}

function publicResult(result: {
  jobsRequested: number;
  claimed: number;
  processed: number;
  completed: number;
  requeued: number;
  failed: number;
  noWork: boolean;
  durationMs: number;
  automaticSpendRupees: 0;
}) {
  return {
    jobs_requested: result.jobsRequested,
    claimed: result.claimed,
    processed: result.processed,
    completed: result.completed,
    requeued: result.requeued,
    failed: result.failed,
    no_work: result.noWork,
    duration_ms: result.durationMs,
    automatic_spend_rupees: result.automaticSpendRupees,
  };
}

/**
 * GET handler. Cron requests use GET, no body. Idempotent per tick —
 * the drain worker is safe against overlapping invocations via
 * SKIP LOCKED, lease owner, and terminal immutability inside the
 * repository. A tick that finds no eligible job returns `no_work`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const started = Date.now();
  if (!isSchedulerAuthorized(request)) {
    return NextResponse.json(
      { outcome: "forbidden", safe_error_code: "SCHEDULER_SECRET_REQUIRED" },
      { status: 401 },
    );
  }
  try {
    logTradeResearchDiagnostic({ event: "drain_started", jobsRequested: JOBS_PER_DRAIN });
    const result = await drainTradeResearch({
      writer: new TradeResearchWriter(getTradeResearchServiceRoleClient()),
      workerId: `cron-${randomUUID()}`,
      maxJobs: JOBS_PER_DRAIN,
      timeBudgetMs: TIME_BUDGET_MS,
      // BI4F 2A hard-deadline safety on the cron path — the worker
      // voluntarily checkpoints before Vercel's 60 s function ceiling.
      deadlineAt: createTradeResearchDeadline(started),
      log: logTradeResearchDiagnostic,
    });
    return NextResponse.json({
      outcome: result.noWork ? "no_work" : "processed",
      ...publicResult(result),
    });
  } catch (error) {
    const failure = error instanceof TradeResearchDrainExecutionError ? error : undefined;
    const safeErrorCode = failure?.safeErrorCode ?? safeTradeResearchErrorCode(error);
    const fallback = {
      jobsRequested: JOBS_PER_DRAIN, claimed: 0, processed: 0, completed: 0, requeued: 0,
      failed: 1, noWork: false, durationMs: Date.now() - started, automaticSpendRupees: 0 as const,
    };
    if (!failure) {
      logTradeResearchDiagnostic({ event: "route_failed", jobsClaimed: 0, safeErrorCode });
      logTradeResearchDiagnostic({
        event: "drain_finished", jobsRequested: JOBS_PER_DRAIN, jobsClaimed: 0,
        processed: 0, completed: 0, requeued: 0, failed: 1, noWork: false,
        durationMs: fallback.durationMs, safeErrorCode,
      });
    }
    const failedResult = failure?.result ?? fallback;
    return NextResponse.json({
      outcome: "failed",
      safe_error_code: safeErrorCode,
      ...publicResult({ ...failedResult, failed: Math.max(1, failedResult.failed), noWork: false }),
    }, { status: 500 });
  }
}
