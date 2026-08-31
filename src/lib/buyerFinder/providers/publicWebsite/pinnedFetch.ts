/**
 * HTTP GET pinned to pre-validated public addresses.
 *
 * The request URL keeps the original hostname (Host header + TLS SNI /
 * certificate identity). TCP connects only to `pinnedAddresses` via a
 * custom lookup — the system resolver is not consulted at connect time.
 * TLS certificate validation is not disabled.
 */

import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import { pinnedLookup } from "./pinnedLookup";
import { PUBLIC_WEBSITE_USER_AGENT } from "@/lib/buyerFinder/robotsPolicy";
import type { FetchLike, PinnedFetchInit, SafeFetchResponse } from "./fetchTypes";

function headerGetter(raw: http.IncomingHttpHeaders): { get(name: string): string | null } {
  return {
    get(name: string) {
      const value = raw[name.toLowerCase()];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    },
  };
}

function defaultPort(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

/**
 * Host / SNI identity for a pinned request.
 * TLS servername is the requested hostname, never a pinned IP.
 * Certificate verification stays enabled.
 */
export function pinnedRequestIdentity(url: URL): {
  hostname: string;
  hostHeader: string;
  servername?: string;
  rejectUnauthorized?: true;
} {
  if (url.protocol === "https:") {
    return {
      hostname: url.hostname,
      hostHeader: url.host,
      servername: url.hostname,
      rejectUnauthorized: true,
    };
  }
  return {
    hostname: url.hostname,
    hostHeader: url.host,
  };
}

/**
 * Production fetch. Tests inject a FetchLike double and never call this.
 */
export const defaultPinnedFetch: FetchLike = async (input, init: PinnedFetchInit) => {
  if (init.method !== "GET") {
    throw new Error("Only GET is allowed");
  }
  if (!init.pinnedAddresses.length) {
    throw new Error("Refusing unpinned HTTP connect");
  }

  const url = new URL(input);
  const lib = url.protocol === "https:" ? https : http;
  const port = url.port ? Number(url.port) : defaultPort(url.protocol);
  const identity = pinnedRequestIdentity(url);

  return new Promise<SafeFetchResponse>((resolve, reject) => {
    let settled = false;
    let response: IncomingMessage | undefined;
    let req!: http.ClientRequest;
    const lookup: LookupFunction = (hostname, options, callback) => {
      pinnedLookup(init.pinnedAddresses, hostname, options, callback);
    };

    const fail = (err: Error) => {
      req?.destroy();
      response?.destroy();
      if (settled) return;
      settled = true;
      reject(err);
    };

    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: identity.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      lookup,
      headers: {
        Host: identity.hostHeader,
        Accept: init.headers.Accept ?? "text/html,application/xhtml+xml;q=0.9",
        "User-Agent": init.headers["User-Agent"] ?? PUBLIC_WEBSITE_USER_AGENT,
        Connection: "close",
      },
    };
    if (identity.servername) {
      options.servername = identity.servername;
      options.rejectUnauthorized = true;
    }

    req = lib.request(options, (res: IncomingMessage) => {
      response = res;
      if (init.signal.aborted) {
        fail(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        return;
      }
      if (settled) {
        res.destroy();
        return;
      }
      settled = true;
      resolve({
        status: res.statusCode ?? 0,
        headers: headerGetter(res.headers),
        body: res,
      });
    });

    const onAbort = () => {
      fail(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    init.signal.addEventListener("abort", onAbort, { once: true });
    if (init.signal.aborted) {
      onAbort();
      return;
    }

    req.on("timeout", () => {
      fail(Object.assign(new Error("Timeout"), { name: "TimeoutError" }));
    });
    req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    req.end();
  });
};
