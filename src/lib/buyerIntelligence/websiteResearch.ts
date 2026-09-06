/**
 * BI3 — orchestrator for the manual "Research company website · Free"
 * workflow. Pure of I/O with respect to the database: fetches HTML
 * through the BF3A.5 same-domain pinned fetcher, extracts Level-2
 * business claims, and returns a sanitized plan. The server action
 * turns that plan into `ingestSource` + `ingestClaim` calls through
 * the existing BI2 write RPCs, then a `refreshDerived` at the end.
 *
 * Never creates trade observations. Never fabricates products, contacts,
 * or countries. Never calls any provider outside the Candidate's own
 * website. Every claim persisted is backed by a verbatim page excerpt.
 */

import { httpsApexWwwAlternate } from "@/lib/buyerFinder/apexWwwOrigin";
import { blankToUndefined, normalizeDomain } from "@/lib/buyerFinder/normalize";
import type { BuyerCandidate } from "@/lib/buyerFinder/types";
import {
  extractBusinessClaims,
  extractBusinessPageLinks,
  rankBusinessPageLinks,
  type BusinessClaimCandidate,
  type BusinessPageKind,
} from "@/lib/buyerFinder/publicWebsiteBusinessExtract";
import { pathAllowedByRobots } from "@/lib/buyerFinder/robotsPolicy";
import { isSameCompanySite } from "@/lib/buyerFinder/sameSite";
import { UnsafeUrlError, parsePublicHttpUrl } from "@/lib/buyerFinder/ssrf";
import { defaultPinnedFetch } from "@/lib/buyerFinder/providers/publicWebsite/pinnedFetch";
import {
  ROBOTS_TYPES,
  PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS,
  PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES,
  PUBLIC_WEBSITE_ROBOTS_TIMEOUT_MS,
  PUBLIC_WEBSITE_TOTAL_BUDGET_MS,
  defaultLookupAll,
  fetchSafeHtmlPage,
  remainingDeadlineMs,
  type FetchLike,
  type SafePageFetchDeps,
  type SafePageFetchResult,
} from "@/lib/buyerFinder/providers/publicWebsite/fetchPage";

export const BI3_MAX_PAGES = 6;
export const BI3_PROVIDER_ID = "company_website" as const;

export type WebsiteResearchStatus =
  | "researched"
  | "no_evidence"
  | "partial"
  | "unreachable"
  | "invalid_website"
  | "blocked"
  | "timeout"
  | "unsupported_content"
  | "temporarily_unavailable";

export type WebsitePageOutcome =
  | "ok"
  | "no_claims"
  | "blocked"
  | "blocked_by_robots"
  | "timeout"
  | "security_rejected"
  | "invalid_content_type"
  | "too_large"
  | "http_error";

export interface WebsitePageResult {
  requestedUrl: string;
  finalUrl?: string;
  kind: BusinessPageKind;
  outcome: WebsitePageOutcome;
  claims: BusinessClaimCandidate[];
  httpStatus?: number;
  contentType?: string;
  bytesRead?: number;
}

export interface WebsiteResearchPlan {
  status: WebsiteResearchStatus;
  domain?: string;
  entryUrl?: string;
  pages: WebsitePageResult[];
  pagesFetched: number;
  claimsExtracted: number;
  message?: string;
}

export interface WebsiteResearchDeps {
  lookup?: SafePageFetchDeps["lookup"];
  fetch?: FetchLike;
  now?: () => number;
  totalBudgetMs?: number;
  maxPages?: number;
}

function homepageStartUrls(candidate: BuyerCandidate, domain: string): string[] {
  const out: string[] = [];
  const site = blankToUndefined(candidate.website);
  if (site) {
    try {
      out.push(parsePublicHttpUrl(site).toString());
    } catch {
      try {
        out.push(parsePublicHttpUrl(`https://${site.replace(/^\/+/, "")}`).toString());
      } catch {
        // ignore unusable persisted website
      }
    }
  }
  const https = `https://${domain}/`;
  if (!out.includes(https)) out.push(https);
  const http = `http://${domain}/`;
  if (!out.includes(http)) out.push(http);
  return out;
}

function resolveSameSiteHref(
  href: string,
  baseUrl: string,
  candidateDomain: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return undefined;
  }
  try {
    parsePublicHttpUrl(url.toString());
  } catch (err) {
    if (err instanceof UnsafeUrlError) return undefined;
    return undefined;
  }
  if (!isSameCompanySite(candidateDomain, url.hostname)) return undefined;
  url.hash = "";
  return url.toString();
}

function pageOutcomeFrom(status: SafePageFetchResult["status"]): WebsitePageOutcome {
  switch (status) {
    case "ok":
      return "ok";
    case "timeout":
      return "timeout";
    case "rejected":
      return "security_rejected";
    case "blocked":
      return "blocked";
    case "not_html":
      return "invalid_content_type";
    case "too_large":
      return "too_large";
    case "unavailable":
    default:
      return "http_error";
  }
}

/**
 * Fetch bounded same-domain pages and extract Level-2 business claims.
 * Returns a plan; the caller ingests through BI2 write RPCs and then
 * refreshes derived state.
 */
export async function planWebsiteResearch(input: {
  candidate: BuyerCandidate;
  deps?: WebsiteResearchDeps;
}): Promise<WebsiteResearchPlan> {
  const { candidate } = input;
  const deps = input.deps ?? {};
  const now = deps.now ?? Date.now;
  const totalBudget = deps.totalBudgetMs ?? PUBLIC_WEBSITE_TOTAL_BUDGET_MS;
  const maxPages = deps.maxPages ?? BI3_MAX_PAGES;
  const lookup = deps.lookup ?? defaultLookupAll;
  const fetchImpl: FetchLike = deps.fetch ?? defaultPinnedFetch;

  const domain = normalizeDomain(candidate.domain) ?? normalizeDomain(candidate.website);
  if (!domain) {
    return {
      status: "invalid_website",
      pages: [],
      pagesFetched: 0,
      claimsExtracted: 0,
      message: "This candidate needs a company website or domain.",
    };
  }

  const startedAt = now();
  const deadlineAt = startedAt + totalBudget;
  const fetchDeps: SafePageFetchDeps = { lookup, fetch: fetchImpl, deadlineAt, now };
  const remaining = (): number => remainingDeadlineMs(deadlineAt, now) ?? totalBudget;

  const pages: WebsitePageResult[] = [];
  const visited = new Set<string>();
  let claimsExtracted = 0;
  let pagesFetched = 0;
  let sawBlocked = false;
  let sawTimeout = false;
  let sawUnsupported = false;

  // ---- Homepage ---------------------------------------------------------
  let homepage: SafePageFetchResult | undefined;
  let entryUrl: string | undefined;
  for (const start of homepageStartUrls(candidate, domain)) {
    if (remaining() <= 0) break;
    const attempt = await fetchSafeHtmlPage({
      rawUrl: start,
      candidateDomain: domain,
      deps: fetchDeps,
    });
    const outcome = pageOutcomeFrom(attempt.status);
    if (attempt.status === "ok" && attempt.body && attempt.finalUrl) {
      homepage = attempt;
      entryUrl = attempt.finalUrl;
      break;
    }
    if (outcome === "blocked") sawBlocked = true;
    if (outcome === "timeout") sawTimeout = true;
    if (outcome === "invalid_content_type") sawUnsupported = true;
    pages.push({
      requestedUrl: start,
      kind: "homepage",
      outcome,
      claims: [],
      httpStatus: attempt.httpStatus,
      contentType: attempt.contentType,
      bytesRead: attempt.bytesRead,
    });
  }

  if (!homepage || !entryUrl || !homepage.body) {
    // Optional apex/www alternate if the initial start(s) failed.
    const alternate = httpsApexWwwAlternate(`https://${domain}/`, domain);
    if (alternate && remaining() >= PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS) {
      const alt = await fetchSafeHtmlPage({
        rawUrl: alternate,
        candidateDomain: domain,
        deps: fetchDeps,
      });
      if (alt.status === "ok" && alt.body && alt.finalUrl) {
        homepage = alt;
        entryUrl = alt.finalUrl;
      } else {
        pages.push({
          requestedUrl: alternate,
          kind: "homepage",
          outcome: pageOutcomeFrom(alt.status),
          claims: [],
          httpStatus: alt.httpStatus,
        });
      }
    }
  }

  if (!homepage || !entryUrl || !homepage.body) {
    const status: WebsiteResearchStatus =
      sawBlocked ? "blocked" :
      sawTimeout ? "timeout" :
      sawUnsupported ? "unsupported_content" :
      "unreachable";
    return {
      status,
      domain,
      pages,
      pagesFetched,
      claimsExtracted,
    };
  }

  pagesFetched += 1;
  visited.add(canonicalKey(entryUrl));
  const homepageExtraction = extractBusinessClaims({
    finalUrl: entryUrl,
    html: homepage.body,
    kind: "homepage",
  });
  claimsExtracted += homepageExtraction.claims.length;
  pages.push({
    requestedUrl: entryUrl,
    finalUrl: entryUrl,
    kind: "homepage",
    outcome: homepageExtraction.claims.length > 0 ? "ok" : "no_claims",
    claims: homepageExtraction.claims,
    httpStatus: homepage.httpStatus,
    contentType: homepage.contentType,
    bytesRead: homepage.bytesRead,
  });

  // ---- Internal page selection ----------------------------------------
  const links = rankBusinessPageLinks(extractBusinessPageLinks(homepage.body));
  const selected: { url: string; kind: BusinessPageKind }[] = [];
  const seenPaths = new Set<string>([canonicalKey(entryUrl)]);
  for (const link of links) {
    if (selected.length >= Math.max(0, maxPages - pagesFetched)) break;
    const resolved = resolveSameSiteHref(link.href, entryUrl, domain);
    if (!resolved) continue;
    const key = canonicalKey(resolved);
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    selected.push({ url: resolved, kind: link.kind });
  }

  // ---- robots.txt -----------------------------------------------------
  let robotsTxt: string | undefined;
  const robotsUrl = (() => {
    try {
      return new URL("/robots.txt", entryUrl).toString();
    } catch {
      return undefined;
    }
  })();
  if (robotsUrl && remaining() > 0 && selected.length > 0) {
    const robots = await fetchSafeHtmlPage({
      rawUrl: robotsUrl,
      candidateDomain: domain,
      deps: {
        ...fetchDeps,
        maxBodyBytes: PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES,
        timeoutMs: Math.min(PUBLIC_WEBSITE_ROBOTS_TIMEOUT_MS, Math.max(1, remaining())),
      },
      allowedTypes: ROBOTS_TYPES,
    });
    if (robots.status === "ok") robotsTxt = robots.body;
  }

  // ---- Fetch selected internal pages ----------------------------------
  for (const target of selected) {
    if (pagesFetched >= maxPages) break;
    if (remaining() < PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS) {
      sawTimeout = true;
      break;
    }
    let path = "/";
    try {
      path = new URL(target.url).pathname;
    } catch {
      continue;
    }
    if (!pathAllowedByRobots(robotsTxt, path)) {
      pages.push({
        requestedUrl: target.url,
        kind: target.kind,
        outcome: "blocked_by_robots",
        claims: [],
      });
      continue;
    }
    const attempt = await fetchSafeHtmlPage({
      rawUrl: target.url,
      candidateDomain: domain,
      deps: fetchDeps,
    });
    const outcome = pageOutcomeFrom(attempt.status);
    if (attempt.status !== "ok" || !attempt.body || !attempt.finalUrl) {
      if (outcome === "blocked") sawBlocked = true;
      if (outcome === "timeout") sawTimeout = true;
      if (outcome === "invalid_content_type") sawUnsupported = true;
      pages.push({
        requestedUrl: target.url,
        kind: target.kind,
        outcome,
        claims: [],
        httpStatus: attempt.httpStatus,
        contentType: attempt.contentType,
        bytesRead: attempt.bytesRead,
      });
      continue;
    }
    const key = canonicalKey(attempt.finalUrl);
    if (visited.has(key)) continue;
    visited.add(key);
    pagesFetched += 1;
    const extracted = extractBusinessClaims({
      finalUrl: attempt.finalUrl,
      html: attempt.body,
      kind: target.kind,
    });
    claimsExtracted += extracted.claims.length;
    pages.push({
      requestedUrl: target.url,
      finalUrl: attempt.finalUrl,
      kind: target.kind,
      outcome: extracted.claims.length > 0 ? "ok" : "no_claims",
      claims: extracted.claims,
      httpStatus: attempt.httpStatus,
      contentType: attempt.contentType,
      bytesRead: attempt.bytesRead,
    });
  }

  // ---- Final status ---------------------------------------------------
  const anyFailure = pages.some((p) =>
    p.outcome === "blocked" ||
    p.outcome === "timeout" ||
    p.outcome === "security_rejected" ||
    p.outcome === "invalid_content_type" ||
    p.outcome === "too_large" ||
    p.outcome === "http_error",
  );
  const status: WebsiteResearchStatus =
    claimsExtracted > 0
      ? (anyFailure ? "partial" : "researched")
      : sawBlocked
        ? "blocked"
        : sawTimeout
          ? "timeout"
          : sawUnsupported
            ? "unsupported_content"
            : "no_evidence";

  return { status, domain, entryUrl, pages, pagesFetched, claimsExtracted };
}

function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.replace(/\/$/, "") || url;
  }
}
