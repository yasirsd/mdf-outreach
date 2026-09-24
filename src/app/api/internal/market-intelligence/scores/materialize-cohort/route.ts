import "server-only";

import { NextResponse } from "next/server";
import {
  runCohortMaterializeStep,
  type CohortMaterializeOutcome,
  type CohortMaterializeRequest,
} from "@/lib/marketIntelligence/server/cohortMaterialize";

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

function statusFor(outcome: CohortMaterializeOutcome): number {
  switch (outcome) {
    case "country_current":
    case "country_created":
    case "country_refreshed":
    case "country_insufficient_evidence":
    case "cohort_complete":
      return 200;
    case "country_blocked":
      return 409;
    case "unauthorised":
      return 401;
    case "forbidden":
      return 403;
    case "database_error":
    default:
      return 500;
  }
}

function parseRequest(value: unknown): CohortMaterializeRequest | undefined {
  if (value === undefined || value === null) return { dryRun: false };
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const allowed = new Set(["dryRun"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return undefined;
  if (body.dryRun === undefined) return { dryRun: false };
  if (typeof body.dryRun !== "boolean") return undefined;
  return { dryRun: body.dryRun };
}

/**
 * MI1J — server-authoritative cohort materialization step. Body accepts
 * ONLY an optional `{dryRun: boolean}`. Country, product, score version,
 * cohort, mapping, and provider are all fixed server-side.
 */
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
      { outcome: "invalid_request", message: "Only an optional boolean `dryRun` field is accepted." },
      { status: 400 },
    );
  }
  const result = await runCohortMaterializeStep(input);
  return NextResponse.json(result, { status: statusFor(result.outcome) });
}
