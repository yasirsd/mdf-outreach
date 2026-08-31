/**
 * Dev-only public-website lookup diagnostics.
 * Never logs HTML, emails, cookies, tokens, DNS, or private IPs.
 */

import { isIP } from "node:net";
import type { PublicPageAttempt } from "./providers/types";

export interface PublicWebsiteLookupLog {
  candidateId: string;
  hostname: string;
  rankedPagePaths: string[];
  selectedPagePaths: string[];
  preferredOrigin?: string;
  alternateOriginAttempted?: boolean;
  observedWorkingOrigin?: string;
  staticClientRedirectsDiscovered?: number;
  selectedClientRedirect?: string;
  clientRedirectAttempted?: boolean;
  clientRedirectOutcome?: string;
  outcome: string;
  emailCount: number;
  pageAttempts: PublicPageAttempt[];
}

export function safePublicPageUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return url.pathname || "/";
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    const path = raw.split("?")[0]?.split("#")[0] ?? raw;
    return path.startsWith("/") ? path : "/";
  }
}

const SAFE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "CERT_ERROR",
  "TLS_NAME_ERROR",
  "REDIRECT_TARGET_ERROR",
  "NETWORK_ERROR",
]);

const SAFE_STAGES = new Set(["dns", "connect", "tls", "redirect", "headers", "body"]);

function safeHostname(host: string | undefined): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || isIP(h) || h.includes(":") || /^\d/.test(h) || h.length > 253) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h)) {
    return null;
  }
  return h;
}

function safePathname(path: string | undefined): string | null {
  if (!path) return null;
  const cleaned = path.split("?")[0]?.split("#")[0] ?? "/";
  if (!cleaned.startsWith("/")) return "/";
  return cleaned.slice(0, 512);
}

export function summarizePublicWebsiteLookup(input: PublicWebsiteLookupLog): Record<string, unknown> {
  return {
    candidateId: input.candidateId,
    hostname: input.hostname,
    preferredOrigin: input.preferredOrigin ? safePublicPageUrl(input.preferredOrigin) : null,
    alternateOriginAttempted: input.alternateOriginAttempted ?? false,
    observedWorkingOrigin: input.observedWorkingOrigin
      ? safePublicPageUrl(input.observedWorkingOrigin)
      : null,
    staticClientRedirectsDiscovered: input.staticClientRedirectsDiscovered ?? 0,
    selectedClientRedirect: input.selectedClientRedirect
      ? safePublicPageUrl(input.selectedClientRedirect)
      : null,
    clientRedirectAttempted: input.clientRedirectAttempted ?? false,
    clientRedirectOutcome: input.clientRedirectOutcome ?? null,
    rankedPagePaths: input.rankedPagePaths.map(safePublicPageUrl),
    selectedPagePaths: input.selectedPagePaths.map(safePublicPageUrl),
    outcome: input.outcome,
    emailCount: input.emailCount,
    pages: input.pageAttempts.map((a) => ({
      url: safePublicPageUrl(a.url),
      outcome: a.outcome,
      statusCode: a.statusCode ?? null,
      bytesRead: a.bytesRead ?? null,
      emailsExtracted: a.emailsExtracted,
      linksDiscovered: a.linksDiscovered,
      contentType: a.contentType ?? null,
      contentEncoding: a.contentEncoding ?? null,
      transportStage: a.transportStage && SAFE_STAGES.has(a.transportStage) ? a.transportStage : null,
      safeErrorCode:
        a.safeErrorCode && SAFE_ERROR_CODES.has(a.safeErrorCode) ? a.safeErrorCode : null,
      redirectOccurred: a.redirectOccurred === true,
      redirectTargetHost: safeHostname(a.redirectTargetHost),
      redirectTargetPath: safePathname(a.redirectTargetPath),
      redirectOutcome: a.redirectOutcome ?? null,
    })),
  };
}

export function logPublicWebsiteLookupDev(input: PublicWebsiteLookupLog): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.VITEST) return;
  console.info("[public-website.lookup]", summarizePublicWebsiteLookup(input));
}
