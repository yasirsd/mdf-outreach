import "server-only";

import { NextResponse } from "next/server";
import { syncCurrentMarketProductMappings } from "@/lib/marketIntelligence/server/mappingSyncMaintenance";
import type { SyncMarketProductMappingsResult } from "@/lib/marketIntelligence/server/mappingSyncMaintenance";

export const dynamic = "force-dynamic";

function configuredOrigin(request: Request): string | undefined {
  const configured = process.env.APP_BASE_URL?.trim();
  try {
    return new URL(configured || request.url).origin;
  } catch {
    return undefined;
  }
}

/** Cookie-authenticated maintenance requests must carry the canonical origin. */
function isSameOriginPost(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  const expectedOrigin = configuredOrigin(request);
  if (!originHeader || !expectedOrigin) return false;

  let suppliedOrigin: string;
  try {
    suppliedOrigin = new URL(originHeader).origin;
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  return suppliedOrigin === expectedOrigin;
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function responseFor(result: SyncMarketProductMappingsResult): NextResponse {
  if (result.outcome === "synced" && result.summary) {
    return NextResponse.json({
      outcome: "synced",
      registryVersion: result.registryVersion,
      summary: {
        created: safeCount(result.summary.created),
        updated: safeCount(result.summary.updated),
        reactivated: safeCount(result.summary.reactivated),
        deactivated: safeCount(result.summary.deactivated),
        unchanged: safeCount(result.summary.unchanged),
      },
    });
  }

  const status = result.outcome === "unauthorised"
    ? 401
    : result.outcome === "forbidden"
      ? 403
      : result.outcome === "invalid_registry"
        ? 422
        : 503;
  return NextResponse.json({
    outcome: result.outcome,
    registryVersion: result.registryVersion,
    message: result.message,
  }, { status });
}

/**
 * Internal, owner-only maintenance trigger. The request body is deliberately
 * never read: it can request only "sync the current canonical registry".
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPost(request)) {
    return NextResponse.json(
      { outcome: "forbidden", message: "Same-origin request required." },
      { status: 403 },
    );
  }

  return responseFor(await syncCurrentMarketProductMappings());
}
