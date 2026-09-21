import "server-only";

/**
 * MI1F — public BotMarket metadata read.
 *
 * These endpoints require NO Authorization header and expose only
 * documented catalogue metadata (year members, importer members).
 * They are read once per invocation so the orchestrator can (a) verify
 * every cohort country is on the current importer roster before
 * spending any authenticated request budget on it, and (b) discover
 * the actual provider-supported analytical window (currently 2018–2024
 * for HS17 090421) without hardcoding it.
 *
 * Failure returns an empty roster / empty year list plus a diagnostic
 * label — the orchestrator treats an unresolved metadata read as
 * "unknown cohort availability" and refuses to spend the authenticated
 * request budget until a follow-up invocation retrieves it.
 */

import {
  BACI_OEC_METADATA_ENDPOINT,
} from "./contract";

const YEAR_MEMBERS_URL = `${BACI_OEC_METADATA_ENDPOINT}/members/year`;
const IMPORTER_MEMBERS_URL = `${BACI_OEC_METADATA_ENDPOINT}/members/importer_id`;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface BaciMetadataFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface BaciYearMembersResult {
  years: number[];
  outcome: "ok" | "network_error" | "provider_error" | "invalid_shape";
  httpStatus?: number;
}

export interface BaciImporterMembersResult {
  importerIds: string[];
  outcome: "ok" | "network_error" | "provider_error" | "invalid_shape";
  httpStatus?: number;
}

async function fetchPublicJson(
  url: string,
  options: BaciMetadataFetchOptions,
): Promise<{ ok: true; json: unknown; httpStatus: number } | { ok: false; outcome: "network_error" | "provider_error"; httpStatus?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, outcome: "provider_error", httpStatus: response.status };
    }
    const json = (await response.json()) as unknown;
    return { ok: true, json, httpStatus: response.status };
  } catch {
    return { ok: false, outcome: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBaciYearMembers(
  options: BaciMetadataFetchOptions = {},
): Promise<BaciYearMembersResult> {
  const result = await fetchPublicJson(YEAR_MEMBERS_URL, options);
  if (!result.ok) return { years: [], outcome: result.outcome, httpStatus: result.httpStatus };
  const json = result.json;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { years: [], outcome: "invalid_shape", httpStatus: result.httpStatus };
  }
  const members = (json as { members?: unknown }).members;
  if (!Array.isArray(members)) {
    return { years: [], outcome: "invalid_shape", httpStatus: result.httpStatus };
  }
  const years = members
    .filter((y): y is number => Number.isInteger(y) && (y as number) > 1900)
    .sort((a, b) => a - b);
  return { years, outcome: "ok", httpStatus: result.httpStatus };
}

export async function fetchBaciImporterMembers(
  options: BaciMetadataFetchOptions = {},
): Promise<BaciImporterMembersResult> {
  const result = await fetchPublicJson(IMPORTER_MEMBERS_URL, options);
  if (!result.ok) return { importerIds: [], outcome: result.outcome, httpStatus: result.httpStatus };
  const json = result.json;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { importerIds: [], outcome: "invalid_shape", httpStatus: result.httpStatus };
  }
  const members = (json as { members?: unknown }).members;
  if (!Array.isArray(members)) {
    return { importerIds: [], outcome: "invalid_shape", httpStatus: result.httpStatus };
  }
  const importerIds = members
    .filter((v): v is string => typeof v === "string" && /^[a-z]{3}$/i.test(v))
    .map((v) => v.toLowerCase());
  return { importerIds, outcome: "ok", httpStatus: result.httpStatus };
}
