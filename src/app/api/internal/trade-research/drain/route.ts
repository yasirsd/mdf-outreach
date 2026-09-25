import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireMdfSession } from "@/lib/auth/require";
import { TradeResearchWriter } from "@/lib/tradeResearch/repository";
import { getTradeResearchServiceRoleClient } from "@/lib/tradeResearch/server/serviceRoleClient";
import { drainTradeResearch } from "@/lib/tradeResearch/server/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function POST(request: Request): Promise<NextResponse> {
  if (!validSchedulerSecret(request)) {
    if (!sameOrigin(request)) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
    const session = await requireMdfSession();
    if (session.membership.role !== "owner") return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  const result = await drainTradeResearch({
    writer: new TradeResearchWriter(getTradeResearchServiceRoleClient()),
    workerId: `drain-${randomUUID()}`,
    maxJobs: 2,
    timeBudgetMs: 45_000,
  });
  return NextResponse.json({ outcome: "ok", ...result });
}

