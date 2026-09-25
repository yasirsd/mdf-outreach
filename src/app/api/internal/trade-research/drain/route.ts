import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireMdfSession } from "@/lib/auth/require";
import { TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { logTradeResearchDiagnostic, safeTradeResearchErrorCode } from "@/lib/tradeResearch/server/diagnostics";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { drainTradeResearch, TradeResearchDrainExecutionError } from "@/lib/tradeResearch/server/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const JOBS_PER_DRAIN = 2;
const TIME_BUDGET_MS = 45_000;

class TradeResearchAuthorizationCheckError extends Error {
  constructor() {
    super("Trade research drain authorization could not be verified.");
    this.name = "TradeResearchAuthorizationCheckError";
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const expected = new URL(process.env.APP_BASE_URL?.trim() || request.url).origin;
    return new URL(origin).origin === expected && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}

function validSchedulerSecret(request: Request): boolean {
  const configured = process.env.TRADE_RESEARCH_DRAIN_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isNextRedirectSignal(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT;");
}

async function authorizeRequest(request: Request): Promise<NextResponse | undefined> {
  if (validSchedulerSecret(request)) return undefined;
  if (!sameOrigin(request)) {
    return NextResponse.json({ outcome: "forbidden", safe_error_code: "SAME_ORIGIN_REQUIRED" }, { status: 403 });
  }

  try {
    const session = await requireMdfSession();
    if (session.membership.role !== "owner") {
      return NextResponse.json({ outcome: "forbidden", safe_error_code: "OWNER_REQUIRED" }, { status: 403 });
    }
    return undefined;
  } catch (error) {
    if (isNextRedirectSignal(error)) {
      return NextResponse.json({ outcome: "unauthorized", safe_error_code: "OWNER_SESSION_REQUIRED" }, { status: 401 });
    }
    throw new TradeResearchAuthorizationCheckError();
  }
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

export async function POST(request: Request): Promise<NextResponse> {
  const started = Date.now();
  try {
    const authFailure = await authorizeRequest(request);
    if (authFailure) return authFailure;

    const result = await drainTradeResearch({
      writer: new TradeResearchWriter(getTradeResearchServiceRoleClient()),
      workerId: `drain-${randomUUID()}`,
      maxJobs: JOBS_PER_DRAIN,
      timeBudgetMs: TIME_BUDGET_MS,
      log: logTradeResearchDiagnostic,
    });
    return NextResponse.json({ outcome: result.noWork ? "no_work" : "processed", ...publicResult(result) });
  } catch (error) {
    const failure = error instanceof TradeResearchDrainExecutionError ? error : undefined;
    const safeErrorCode = error instanceof TradeResearchAuthorizationCheckError
      ? "AUTHORIZATION_CHECK_FAILED"
      : failure?.safeErrorCode ?? safeTradeResearchErrorCode(error);
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
