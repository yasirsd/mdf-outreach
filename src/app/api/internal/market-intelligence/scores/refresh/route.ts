import "server-only";

import { NextResponse } from "next/server";
import {
  refreshPersistedMarketScore,
  type ScoreRefreshOutcome,
  type ScoreRefreshRequest,
} from "@/lib/marketIntelligence/server/scoreRefresh";

export const dynamic = "force-dynamic";

function configuredOrigin(request: Request): string | undefined {
  try {
    return new URL(process.env.APP_BASE_URL?.trim() || request.url).origin;
  } catch {
    return undefined;
  }
}

function isSameOriginPost(request: Request): boolean {
  const supplied = request.headers.get("origin");
  const expected = configuredOrigin(request);
  if (!supplied || !expected) return false;
  try {
    if (new URL(supplied).origin !== expected) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function statusFor(outcome: ScoreRefreshOutcome): number {
  switch (outcome) {
    case "created":
    case "unchanged":
    case "superseded_and_created":
    case "insufficient_evidence": return 200;
    case "unauthorised": return 401;
    case "forbidden": return 403;
    case "invalid_request": return 400;
    case "unsupported_product":
    case "mapping_error":
    case "source_error": return 409;
    case "database_error":
    default: return 500;
  }
}

function parseRequest(value: unknown): ScoreRefreshRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const allowed = new Set(["country", "product", "dryRun"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined;
  if (
    typeof body.country !== "string" ||
    typeof body.product !== "string" ||
    typeof body.dryRun !== "boolean"
  ) return undefined;
  return { country: body.country, product: body.product, dryRun: body.dryRun };
}

/** One explicit canonical country + product per owner-only request. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { outcome: "forbidden", message: "Same-origin request required." },
      { status: 403 },
    );
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const input = parseRequest(raw);
  if (!input) {
    return NextResponse.json(
      { outcome: "invalid_request", message: "country, product, and explicit dryRun are required." },
      { status: 400 },
    );
  }
  const result = await refreshPersistedMarketScore(input);
  return NextResponse.json(result, { status: statusFor(result.outcome) });
}
