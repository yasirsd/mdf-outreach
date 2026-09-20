import "server-only";

import { NextResponse } from "next/server";
import {
  runControlledBaciProof,
  type BaciProofMaintenanceResult,
} from "@/lib/marketIntelligence/server/baciProofMaintenance";

export const dynamic = "force-dynamic";

function expectedOrigin(request: Request): string | undefined {
  try {
    return new URL(process.env.APP_BASE_URL?.trim() || request.url).origin;
  } catch {
    return undefined;
  }
}

function isSameOrigin(request: Request): boolean {
  const supplied = request.headers.get("origin");
  const expected = expectedOrigin(request);
  if (!supplied || !expected) return false;
  try {
    if (new URL(supplied).origin !== expected) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function responseFor(result: BaciProofMaintenanceResult): NextResponse {
  if (result.outcome === "completed") return NextResponse.json(result);
  const status = result.outcome === "unauthorised"
    ? 401
    : result.outcome === "forbidden"
      ? 403
      : result.outcome === "configuration_error"
        ? 503
        : result.outcome === "invalid_request"
          ? 422
          : result.outcome === "observation_conflict" || result.outcome === "source_conflict"
            ? 409
            : result.outcome === "blocked" || result.outcome === "quota_exhausted"
              ? 429
              : 502;
  return NextResponse.json(result, { status });
}

/**
 * Explicit owner trigger for the one fixed proof. The body is never read:
 * country, product, HS code, provider, rows, provenance, and metrics are all
 * server-derived constants. No GET handler exists.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { outcome: "forbidden", message: "Same-origin request required." },
      { status: 403 },
    );
  }
  return responseFor(await runControlledBaciProof());
}
