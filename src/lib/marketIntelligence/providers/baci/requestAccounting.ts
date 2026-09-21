import "server-only";

import { BACI_OEC_QUERY_ENDPOINT } from "./contract";

export interface BaciProviderRequestCounter {
  fetchImpl: typeof fetch;
  requestsUsed: () => number;
}

/**
 * Count actual authenticated-query transport attempts, including requests
 * that later fail or lead to an observation conflict. Public metadata URLs
 * are intentionally excluded.
 */
export function createBaciProviderRequestCounter(
  underlyingFetch: typeof fetch,
  maxRequests: number,
): BaciProviderRequestCounter {
  let used = 0;
  const countedFetch: typeof fetch = async (input, init) => {
    if (isBaciQueryRequest(input)) {
      if (used >= maxRequests) {
        throw new Error("BACI provider request budget exceeded");
      }
      used += 1;
    }
    return underlyingFetch(input, init);
  };
  return { fetchImpl: countedFetch, requestsUsed: () => used };
}

function isBaciQueryRequest(input: Parameters<typeof fetch>[0]): boolean {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  try {
    const candidate = new URL(rawUrl);
    const endpoint = new URL(BACI_OEC_QUERY_ENDPOINT);
    return candidate.origin === endpoint.origin && candidate.pathname === endpoint.pathname;
  } catch {
    return false;
  }
}
