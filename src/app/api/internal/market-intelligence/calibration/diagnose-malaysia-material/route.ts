import "server-only";

import { NextResponse } from "next/server";
import {
  runMalaysiaMaterialDiagnostic,
  type MalaysiaMaterialDiagnosticResult,
} from "@/lib/marketIntelligence/server/malaysiaMaterialDiagnostic";

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

function statusFor(outcome: MalaysiaMaterialDiagnosticResult["outcome"]): number {
  switch (outcome) {
    case "comparison_complete": return 200;
    case "unauthorised": return 401;
    case "forbidden": return 403;
    case "mapping_error":
    case "source_error": return 409;
    case "configuration_error":
    case "quota_exhausted": return 503;
    case "invalid_request": return 422;
    case "metadata_error":
    case "provider_error":
    case "timeout":
    case "partial": return 502;
    case "database_error":
    default: return 500;
  }
}

/** Bodyless, owner-only, read-only Malaysia material comparison. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { outcome: "forbidden", message: "Same-origin request required." },
      { status: 403 },
    );
  }
  const result = await runMalaysiaMaterialDiagnostic();
  return NextResponse.json(result, { status: statusFor(result.outcome) });
}
