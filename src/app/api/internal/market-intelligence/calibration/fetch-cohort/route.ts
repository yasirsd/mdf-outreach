import "server-only";

import { NextResponse } from "next/server";
import {
  runCohortFetchBatch,
  type CohortFetchBatchResult,
} from "@/lib/marketIntelligence/server/cohortFetch";

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

function statusFor(outcome: CohortFetchBatchResult["outcome"]): number {
  switch (outcome) {
    case "batch_completed":
    case "cohort_fetch_complete":
      return 200;
    case "unauthorised":
      return 401;
    case "forbidden":
      return 403;
    case "mapping_error":
      return 409;
    case "configuration_error":
      return 503;
    case "metadata_error":
    case "provider_stopped":
      return 502;
    case "auth_stopped":
      return 502;
    case "quota_stopped":
      return 503;
    case "unexpected_error":
    default:
      return 500;
  }
}

/**
 * MI1F — Owner-only, server-authoritative, resumable cohort fetch trigger.
 * Body is deliberately never read: provider, dataset, HS code, product
 * mapping, country list, years, pagination, and rows are all server-derived
 * constants or discovered from public provider metadata.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { outcome: "forbidden", message: "Same-origin request required." },
      { status: 403 },
    );
  }
  const result = await runCohortFetchBatch();
  return NextResponse.json(result, { status: statusFor(result.outcome) });
}
