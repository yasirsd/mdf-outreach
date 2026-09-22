import "server-only";

import { NextResponse } from "next/server";
import {
  runCalibrationDistributionReport,
  type CalibrationReportOutcome,
} from "@/lib/marketIntelligence/server/calibrationReport";

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

function statusFor(outcome: CalibrationReportOutcome): number {
  switch (outcome) {
    case "report_ready": return 200;
    case "unauthorised": return 401;
    case "forbidden": return 403;
    case "mapping_error":
    case "source_error": return 409;
    case "database_error":
    default: return 500;
  }
}

/** Bodyless owner-only generation of the development calibration report. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { outcome: "forbidden", message: "Same-origin request required." },
      { status: 403 },
    );
  }
  const result = await runCalibrationDistributionReport();
  return NextResponse.json(result, { status: statusFor(result.outcome) });
}
