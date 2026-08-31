/**
 * Bounded, redirect-manual, IP-pinned GET for a candidate's own website.
 *
 * Production connections use `defaultPinnedFetch`: TLS SNI / Host stay on
 * the original hostname; TCP is pinned to addresses already validated as
 * public. Tests inject a FetchLike double and never open sockets.
 */

import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import type { LookupAddresses } from "@/lib/buyerFinder/ssrf";
import {
  PUBLIC_WEBSITE_MAX_REDIRECTS,
  UnsafeUrlError,
  assertSafeFetchUrl,
} from "@/lib/buyerFinder/ssrf";
import { PUBLIC_WEBSITE_USER_AGENT } from "@/lib/buyerFinder/robotsPolicy";
import { defaultPinnedFetch } from "./pinnedFetch";
import type { FetchLike, SafeFetchResponse } from "./fetchTypes";
import {
  classifyTransportError,
  type SafeErrorCode,
  type TransportStage,
} from "./transportError";

export type { FetchLike, PinnedFetchInit, SafeFetchResponse } from "./fetchTypes";

export const PUBLIC_WEBSITE_TIMEOUT_MS = 8_000;
export const PUBLIC_WEBSITE_ROBOTS_TIMEOUT_MS = 3_000;
export const PUBLIC_WEBSITE_MAX_BODY_BYTES = 1_048_576;
export const PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES = 64 * 1024;
export const PUBLIC_WEBSITE_TOTAL_BUDGET_MS = 20_000;
/** Do not start another HTML hop when less than this remains on the 20s budget. */
export const PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS = 1_500;

export interface SafePageFetchDeps {
  lookup: LookupAddresses;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  deadlineAt?: number;
  now?: () => number;
}

export type SafePageFetchStatus =
  | "ok"
  | "blocked"
  | "unavailable"
  | "timeout"
  | "rejected"
  | "not_html"
  | "too_large";

export type SafeRedirectOutcome =
  | "followed"
  | "dns"
  | "connect"
  | "tls"
  | "rejected"
  | "timeout"
  | "unavailable"
  | "headers"
  | "body";

export interface SafePageFetchResult {
  status: SafePageFetchStatus;
  finalUrl?: string;
  contentType?: string;
  contentEncoding?: string;
  body?: string;
  httpStatus?: number;
  bytesRead?: number;
  transportStage?: TransportStage;
  safeErrorCode?: SafeErrorCode;
  redirectOccurred?: boolean;
  redirectTargetHost?: string;
  redirectTargetPath?: string;
  redirectOutcome?: SafeRedirectOutcome;
}

interface RecordedRedirect {
  host: string;
  path: string;
}

function redirectTargetFrom(location: string, base: URL): RecordedRedirect | undefined {
  try {
    const next = new URL(location, base);
    const host = next.hostname.toLowerCase().replace(/\.$/, "");
    const path = (next.pathname || "/").split("?")[0]?.split("#")[0] || "/";
    if (!host || isIP(host) || host.includes(":")) {
      return { host: "", path };
    }
    return { host, path };
  } catch {
    return undefined;
  }
}

function withRedirect(
  result: SafePageFetchResult,
  redirect: RecordedRedirect | undefined,
  outcome?: SafeRedirectOutcome,
): SafePageFetchResult {
  if (!redirect) return result;
  return {
    ...result,
    redirectOccurred: true,
    ...(redirect.host ? { redirectTargetHost: redirect.host } : {}),
    redirectTargetPath: redirect.path,
    redirectOutcome: outcome ?? result.redirectOutcome,
  };
}

function redirectOutcomeFrom(result: SafePageFetchResult): SafeRedirectOutcome {
  if (result.status === "rejected") return "rejected";
  if (result.status === "timeout") return "timeout";
  if (result.transportStage === "dns") return "dns";
  if (result.transportStage === "tls") return "tls";
  if (result.transportStage === "connect") return "connect";
  if (result.transportStage === "headers") return "headers";
  if (result.transportStage === "body") return "body";
  if (result.status === "ok") return "followed";
  return "unavailable";
}

const HTML_TYPES = ["text/html", "application/xhtml+xml"];
const ROBOTS_TYPES = ["text/plain", "text/html", "application/xhtml+xml"];

export { ROBOTS_TYPES };

export async function defaultLookupAll(hostname: string): Promise<string[]> {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

function looksLikeChallenge(body: string): boolean {
  const head = body.slice(0, 4000).toLowerCase();
  return (
    head.includes("cf-challenge") ||
    head.includes("g-recaptcha") ||
    head.includes("hcaptcha") ||
    head.includes("enable javascript and cookies") ||
    (/captcha/.test(head) && /access denied|attention required/.test(head))
  );
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  return sample.includes(0);
}

function destroyBody(body: SafeFetchResponse["body"]): void {
  if (body && typeof (body as { destroy?: unknown }).destroy === "function") {
    (body as { destroy: () => void }).destroy();
  }
}

export async function readCappedBody(
  body: SafeFetchResponse["body"],
  maxBytes: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: "too_large" }> {
  if (!body) return { ok: true, bytes: Buffer.alloc(0) };
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        destroyBody(body);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(buf);
    }
  } catch (err) {
    destroyBody(body);
    throw err;
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}

export function remainingDeadlineMs(deadlineAt: number | undefined, now: () => number): number | undefined {
  if (deadlineAt == null) return undefined;
  return deadlineAt - now();
}

export async function fetchSafeHtmlPage(input: {
  rawUrl: string;
  candidateDomain: string;
  deps: SafePageFetchDeps;
  allowedTypes?: string[];
}): Promise<SafePageFetchResult> {
  const timeoutMs = input.deps.timeoutMs ?? PUBLIC_WEBSITE_TIMEOUT_MS;
  const maxRedirects = input.deps.maxRedirects ?? PUBLIC_WEBSITE_MAX_REDIRECTS;
  const maxBody = input.deps.maxBodyBytes ?? PUBLIC_WEBSITE_MAX_BODY_BYTES;
  const allowed = input.allowedTypes ?? HTML_TYPES;
  const fetchImpl = input.deps.fetch ?? defaultPinnedFetch;
  const now = input.deps.now ?? Date.now;

  let current = input.rawUrl;
  let lastRedirect: RecordedRedirect | undefined;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = remainingDeadlineMs(input.deps.deadlineAt, now);
    if (remaining != null && remaining <= 0) {
      return withRedirect({ status: "timeout" }, lastRedirect, "timeout");
    }
    const hopTimeout = remaining == null ? timeoutMs : Math.min(timeoutMs, remaining);
    if (hopTimeout <= 0) {
      return withRedirect({ status: "timeout" }, lastRedirect, "timeout");
    }

    let url: URL;
    let pinnedAddresses: string[];
    try {
      const target = await assertSafeFetchUrl({
        raw: current,
        candidateDomain: input.candidateDomain,
        lookup: input.deps.lookup,
      });
      url = target.url;
      pinnedAddresses = target.addresses;
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        if (err.reason === "dns") {
          const failed: SafePageFetchResult = {
            status: "unavailable",
            transportStage: "dns",
            safeErrorCode: "ENOTFOUND",
          };
          return withRedirect(failed, lastRedirect, lastRedirect ? "dns" : undefined);
        }
        const failed: SafePageFetchResult = {
          status: "rejected",
          transportStage: lastRedirect ? "redirect" : undefined,
          safeErrorCode: lastRedirect ? "REDIRECT_TARGET_ERROR" : undefined,
        };
        return withRedirect(failed, lastRedirect, lastRedirect ? "rejected" : undefined);
      }
      const classified = classifyTransportError(err);
      return withRedirect(
        { status: "unavailable", ...classified },
        lastRedirect,
        lastRedirect ? redirectOutcomeFrom({ status: "unavailable", ...classified }) : undefined,
      );
    }

    const accept = allowed.includes("text/plain")
      ? "text/plain,text/html,application/xhtml+xml;q=0.9"
      : "text/html,application/xhtml+xml;q=0.9";

    let response: SafeFetchResponse;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: accept,
          "User-Agent": PUBLIC_WEBSITE_USER_AGENT,
        },
        signal: AbortSignal.timeout(hopTimeout),
        pinnedAddresses,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return withRedirect({ status: "timeout" }, lastRedirect, lastRedirect ? "timeout" : undefined);
      }
      const classified = classifyTransportError(err);
      return withRedirect(
        { status: "unavailable", ...classified },
        lastRedirect,
        lastRedirect ? redirectOutcomeFrom({ status: "unavailable", ...classified }) : undefined,
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      destroyBody(response.body);
      const location = response.headers.get("location");
      const parsed = location ? redirectTargetFrom(location, url) : undefined;
      if (!location || hop === maxRedirects) {
        return withRedirect(
          {
            status: "unavailable",
            transportStage: "redirect",
            safeErrorCode: "REDIRECT_TARGET_ERROR",
          },
          parsed ?? lastRedirect,
          "unavailable",
        );
      }
      try {
        current = new URL(location, url).toString();
      } catch {
        return withRedirect(
          {
            status: "rejected",
            transportStage: "redirect",
            safeErrorCode: "REDIRECT_TARGET_ERROR",
          },
          lastRedirect,
          "rejected",
        );
      }
      lastRedirect = parsed ?? lastRedirect;
      continue;
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      destroyBody(response.body);
      return withRedirect(
        { status: "blocked", httpStatus: response.status },
        lastRedirect,
        lastRedirect ? "followed" : undefined,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      destroyBody(response.body);
      return withRedirect(
        {
          status: "unavailable",
          httpStatus: response.status,
          transportStage: "headers",
        },
        lastRedirect,
        lastRedirect ? "headers" : undefined,
      );
    }

    const contentType = response.headers.get("content-type");
    const contentEncoding = response.headers.get("content-encoding") ?? undefined;
    if (contentType) {
      const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!allowed.includes(mime)) {
        destroyBody(response.body);
        return withRedirect(
          {
            status: "not_html",
            contentType,
            contentEncoding,
            finalUrl: url.toString(),
            httpStatus: response.status,
          },
          lastRedirect,
          lastRedirect ? "followed" : undefined,
        );
      }
    }

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader) {
      const declared = Number(lengthHeader);
      if (Number.isFinite(declared) && declared > maxBody) {
        destroyBody(response.body);
        return withRedirect(
          { status: "too_large", finalUrl: url.toString(), httpStatus: response.status, contentEncoding },
          lastRedirect,
          lastRedirect ? "followed" : undefined,
        );
      }
    }

    let capped: Awaited<ReturnType<typeof readCappedBody>>;
    try {
      capped = await readCappedBody(response.body, maxBody);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return withRedirect({ status: "timeout" }, lastRedirect, lastRedirect ? "timeout" : undefined);
      }
      const classified = classifyTransportError(err);
      return withRedirect(
        { status: "unavailable", transportStage: "body", safeErrorCode: classified.safeErrorCode },
        lastRedirect,
        lastRedirect ? "body" : undefined,
      );
    }
    if (!capped.ok) {
      return withRedirect(
        {
          status: "too_large",
          finalUrl: url.toString(),
          httpStatus: response.status,
          contentEncoding,
          bytesRead: maxBody + 1,
        },
        lastRedirect,
        lastRedirect ? "followed" : undefined,
      );
    }
    if (looksBinary(capped.bytes)) {
      return withRedirect(
        {
          status: "not_html",
          contentType: contentType ?? undefined,
          contentEncoding,
          finalUrl: url.toString(),
          httpStatus: response.status,
          bytesRead: capped.bytes.byteLength,
        },
        lastRedirect,
        lastRedirect ? "followed" : undefined,
      );
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(capped.bytes);
    if (looksLikeChallenge(body)) {
      return withRedirect(
        {
          status: "blocked",
          finalUrl: url.toString(),
          httpStatus: response.status,
          contentEncoding,
          bytesRead: capped.bytes.byteLength,
        },
        lastRedirect,
        lastRedirect ? "followed" : undefined,
      );
    }
    return withRedirect(
      {
        status: "ok",
        finalUrl: url.toString(),
        contentType: contentType ?? undefined,
        contentEncoding,
        body,
        httpStatus: response.status,
        bytesRead: capped.bytes.byteLength,
      },
      lastRedirect,
      lastRedirect ? "followed" : undefined,
    );
  }
  return withRedirect(
    {
      status: "unavailable",
      transportStage: "redirect",
      safeErrorCode: "REDIRECT_TARGET_ERROR",
    },
    lastRedirect,
    lastRedirect ? "unavailable" : undefined,
  );
}
