// T14 Stage 1 — Netlify Background Function wrapper for the shared
// trade-research drain worker.
//
// This file is intentionally a thin orchestration wrapper. There is NO
// worker logic here. The authoritative worker is
// `drainTradeResearch` from `@/lib/tradeResearch/server/worker` — the
// same worker used by the Vercel cron route and the manual internal
// drain route. This wrapper only:
//
//   1. authenticates the incoming request against
//      `TRADE_RESEARCH_DRAIN_SECRET` (Bearer, timing-safe),
//   2. builds a service-role Supabase client (same helper as
//      production),
//   3. invokes the shared worker with the same 50 s shared deadline,
//      2 jobs per drain, 45 s inner budget as the production cron,
//   4. logs via the shared diagnostics module,
//   5. lets Netlify's Background Function contract handle the HTTP
//      lifecycle — the platform returns 202 immediately to the
//      caller (Supabase Cron), while this handler continues up to
//      the platform's Background Function ceiling.
//
// Preserves every T02/T10/T11/T12 invariant enforced inside the
// shared worker (revision fencing, provider checkpoints, generic
// executor, certification v2, drain-embedded reconciliation).
//
// Automatic provider spend remains ₹0; this wrapper does not enable
// any paid provider or Hunter reveal path.

import { randomUUID, timingSafeEqual } from "node:crypto";
import { TradeResearchWriter } from "../../src/lib/tradeResearch/repository";
import {
  logTradeResearchDiagnostic,
  safeTradeResearchErrorCode,
} from "../../src/lib/tradeResearch/server/diagnostics";
import { getTradeResearchServiceRoleClient } from "../../src/lib/tradeResearch/server/serviceRoleClient";
import {
  createTradeResearchDeadline,
  drainTradeResearch,
  TradeResearchDrainExecutionError,
} from "../../src/lib/tradeResearch/server/worker";

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
 * Authorized only when the request carries `Authorization: Bearer
 * <TRADE_RESEARCH_DRAIN_SECRET>` and the secret is configured. Never
 * echoes the supplied or configured secret in the response or logs.
 */
export function isBackgroundDrainAuthorized(request: Request): boolean {
  const supplied = extractBearer(request);
  if (!supplied) return false;
  const secret = process.env.TRADE_RESEARCH_DRAIN_SECRET?.trim();
  if (!secret) return false;
  return constantTimeEqual(secret, supplied);
}

/**
 * Netlify Background Function entrypoint. Netlify recognizes the
 * `-background` filename suffix and enforces the Background Function
 * contract (immediate 202 to caller, extended timeout for the
 * handler). Return values from the handler are ignored by Netlify;
 * we still return a Response so the runtime shape is portable.
 */
export default async (request: Request): Promise<Response> => {
  if (!isBackgroundDrainAuthorized(request)) {
    return new Response(
      JSON.stringify({ outcome: "forbidden", safe_error_code: "SCHEDULER_SECRET_REQUIRED" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const started = Date.now();
  logTradeResearchDiagnostic({ event: "drain_started", jobsRequested: JOBS_PER_DRAIN });
  try {
    await drainTradeResearch({
      writer: new TradeResearchWriter(getTradeResearchServiceRoleClient()),
      workerId: `netlify-bg-${randomUUID()}`,
      maxJobs: JOBS_PER_DRAIN,
      timeBudgetMs: TIME_BUDGET_MS,
      // Same 50 s shared deadline every entrypoint uses. Netlify
      // Background Functions permit a longer platform ceiling, but
      // the worker's own contract stays at 50 s so terminal
      // checkpointing and stale-lease semantics remain unchanged.
      deadlineAt: createTradeResearchDeadline(started),
      log: logTradeResearchDiagnostic,
    });
    return new Response(
      JSON.stringify({ outcome: "processed", duration_ms: Date.now() - started }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (error) {
    const failure = error instanceof TradeResearchDrainExecutionError ? error : undefined;
    const safeErrorCode = failure?.safeErrorCode ?? safeTradeResearchErrorCode(error);
    if (!failure) {
      logTradeResearchDiagnostic({ event: "route_failed", jobsClaimed: 0, safeErrorCode });
      logTradeResearchDiagnostic({
        event: "drain_finished", jobsRequested: JOBS_PER_DRAIN, jobsClaimed: 0,
        processed: 0, completed: 0, requeued: 0, failed: 1, noWork: false,
        durationMs: Date.now() - started, safeErrorCode,
      });
    }
    return new Response(
      JSON.stringify({ outcome: "failed", safe_error_code: safeErrorCode, duration_ms: Date.now() - started }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
};

// Export configuration for Netlify's Background Function runtime.
// (Presence of this filename suffix (`-background.ts`) is the primary
// signal; the exported `config` reinforces it under newer runtimes.)
export const config = { path: "/api/trade-research-drain-background" };
