/**
 * BF3A.5 — PublicWebsiteCompanyContactProvider
 *
 * Fetches the candidate's own public HTML pages (homepage + up to 3
 * high-value internal pages) and extracts published emails only.
 * Never guesses mailboxes. Never calls paid enrichment providers.
 *
 * Homepage emails are retained immediately. A later robots/contact
 * timeout must not discard a usable homepage result.
 */

import "server-only";

import type {
  CompanyContactDiscoveryProvider,
  CompanyContactDiscoveryQuery,
  CompanyContactDiscoveryResult,
  DiscoveredPublicCompanyEmail,
  PublicPageAttempt,
  PublicPageAttemptOutcome,
} from "../types";
import { httpsApexWwwAlternate, originHomeUrl } from "@/lib/buyerFinder/apexWwwOrigin";
import { blankToUndefined, normalizeDomain } from "@/lib/buyerFinder/normalize";
import {
  extractCandidatePageLinks,
  extractPublishedEmails,
  rankCandidatePageLinks,
} from "@/lib/buyerFinder/publicEmailExtract";
import {
  extractStaticClientRedirects,
  MAX_STATIC_CLIENT_REDIRECT_HOPS,
} from "@/lib/buyerFinder/staticClientRedirect";
import {
  classifyMailboxKind,
  classifyMailboxType,
  pageQualityFromUrl,
} from "@/lib/buyerFinder/publicMailbox";
import { pathAllowedByRobots } from "@/lib/buyerFinder/robotsPolicy";
import { isSameCompanySite } from "@/lib/buyerFinder/sameSite";
import { UnsafeUrlError, parsePublicHttpUrl } from "@/lib/buyerFinder/ssrf";
import { defaultPinnedFetch } from "./pinnedFetch";
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
} from "./fetchPage";

export { PUBLIC_WEBSITE_TOTAL_BUDGET_MS };
export const PUBLIC_WEBSITE_MAX_HTML_PAGES = 4;
export const PUBLIC_WEBSITE_PROVIDER_ID = "public_website" as const;

function visitKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.replace(/\/$/, "") || url;
  }
}

export interface PublicWebsiteProviderDeps {
  lookup?: SafePageFetchDeps["lookup"];
  fetch?: FetchLike;
  now?: () => number;
}

function homepageCandidates(website: string | undefined, domain: string | undefined): string[] {
  const out: string[] = [];
  const site = blankToUndefined(website);
  let preferred: string | undefined;
  if (site) {
    try {
      preferred = parsePublicHttpUrl(site).toString();
      out.push(preferred);
    } catch {
      try {
        preferred = parsePublicHttpUrl(`https://${site.replace(/^\/+/, "")}`).toString();
        out.push(preferred);
      } catch {
        // ignore unusable persisted website
      }
    }
  }
  const host = normalizeDomain(domain);
  if (host) {
    const https = `https://${host}/`;
    const altOfPreferred = preferred ? httpsApexWwwAlternate(preferred, host) : undefined;
    // Conventional apex/www counterpart is sparse-fallback only, never a default start.
    if (!out.includes(https) && https !== altOfPreferred) out.push(https);
    let httpHost = host;
    if (preferred) {
      try {
        httpHost = parsePublicHttpUrl(preferred).hostname;
      } catch {
        httpHost = host;
      }
    }
    const http = `http://${httpHost}/`;
    if (!out.includes(http)) out.push(http);
  }
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

function fetchStatusToAttempt(status: SafePageFetchResult["status"]): PublicPageAttemptOutcome {
  switch (status) {
    case "ok":
      return "fetched";
    case "timeout":
      return "timeout";
    case "rejected":
      return "security_rejected";
    case "not_html":
      return "invalid_content_type";
    case "too_large":
      return "too_large";
    case "blocked":
    case "unavailable":
    default:
      return "http_error";
  }
}

function recordAttempt(
  into: PublicPageAttempt[],
  url: string,
  page: SafePageFetchResult | undefined,
  extra: { outcome?: PublicPageAttemptOutcome; emailsExtracted?: number; linksDiscovered?: number },
): void {
  into.push({
    url,
    outcome: extra.outcome ?? (page ? fetchStatusToAttempt(page.status) : "http_error"),
    statusCode: page?.httpStatus,
    bytesRead: page?.bytesRead,
    emailsExtracted: extra.emailsExtracted ?? 0,
    linksDiscovered: extra.linksDiscovered ?? 0,
    contentType: page?.contentType,
    contentEncoding: page?.contentEncoding,
    transportStage: page?.transportStage,
    safeErrorCode: page?.safeErrorCode,
    redirectOccurred: page?.redirectOccurred,
    redirectTargetHost: page?.redirectTargetHost,
    redirectTargetPath: page?.redirectTargetPath,
    redirectOutcome: page?.redirectOutcome,
  });
}

export function createPublicWebsiteCompanyContactProvider(
  deps: PublicWebsiteProviderDeps = {},
): CompanyContactDiscoveryProvider {
  const lookup = deps.lookup ?? defaultLookupAll;
  const fetchImpl: FetchLike = deps.fetch ?? defaultPinnedFetch;
  const now = deps.now ?? Date.now;

  return {
    async discover(query: CompanyContactDiscoveryQuery): Promise<CompanyContactDiscoveryResult> {
      const domain = normalizeDomain(query.domain) ?? normalizeDomain(query.website);
      if (!domain) {
        return { emails: [], pagesFetched: 0, outcome: "invalid_input", pageAttempts: [] };
      }
      const companyDomain = domain;

      const started = now();
      const deadlineAt = started + PUBLIC_WEBSITE_TOTAL_BUDGET_MS;
      const emailsByAddress = new Map<string, DiscoveredPublicCompanyEmail>();
      const pageAttempts: PublicPageAttempt[] = [];
      let pagesFetched = 0;
      let sawBlocked = false;
      let secondaryIncomplete = false;
      let wantedSecondary = false;

      const fetchDeps: SafePageFetchDeps = {
        lookup,
        fetch: fetchImpl,
        deadlineAt,
        now,
      };

      function remaining(): number {
        return remainingDeadlineMs(deadlineAt, now) ?? PUBLIC_WEBSITE_TOTAL_BUDGET_MS;
      }

      function ingestPage(pageUrl: string, html: string): { emails: number; links: ReturnType<typeof extractCandidatePageLinks> } {
        const published = extractPublishedEmails(html);
        const quality = pageQualityFromUrl(pageUrl);
        for (const email of published) {
          const next: DiscoveredPublicCompanyEmail = {
            email,
            mailboxType: classifyMailboxType(email),
            mailboxKind: classifyMailboxKind(email, domain),
            source: "company_website",
            sourceUrl: pageUrl,
            pageQuality: quality,
          };
          const prev = emailsByAddress.get(email);
          if (!prev || quality < prev.pageQuality) {
            emailsByAddress.set(email, next);
          }
        }
        return { emails: published.length, links: extractCandidatePageLinks(html) };
      }

      let rankedPagePaths: string[] = [];
      let selectedPagePaths: string[] = [];
      let preferredOrigin: string | undefined;
      let alternateOriginAttempted = false;
      let observedWorkingOrigin: string | undefined;
      let alternateIncomplete = false;
      let staticClientRedirectsDiscovered = 0;
      let selectedClientRedirect: string | undefined;
      let clientRedirectAttempted = false;
      let clientRedirectOutcome: string | undefined;
      let clientRedirectIncomplete = false;
      let clientRedirectHops = 0;
      const fetchedHtmlKeys = new Set<string>();
      const discoveredRedirects = new Set<string>();

      function finish(outcome: CompanyContactDiscoveryResult["outcome"]): CompanyContactDiscoveryResult {
        const emails = [...emailsByAddress.values()];
        return {
          emails: emails.length > 0 ? emails : [],
          pagesFetched,
          outcome: emails.length > 0 ? "ok" : outcome,
          pageAttempts,
          rankedPagePaths,
          selectedPagePaths,
          preferredOrigin,
          alternateOriginAttempted,
          observedWorkingOrigin,
          staticClientRedirectsDiscovered,
          selectedClientRedirect,
          clientRedirectAttempted,
          clientRedirectOutcome,
        };
      }

      function noteRedirects(html: string, fromUrl: string): string[] {
        const dests = extractStaticClientRedirects(html, fromUrl, companyDomain);
        for (const dest of dests) discoveredRedirects.add(dest);
        staticClientRedirectsDiscovered = discoveredRedirects.size;
        return dests;
      }

      async function followSparseClientRedirects(
        fromUrl: string,
        fromHtml: string,
      ): Promise<boolean> {
        let url = fromUrl;
        let html = fromHtml;
        while (
          clientRedirectHops < MAX_STATIC_CLIENT_REDIRECT_HOPS &&
          pagesFetched < PUBLIC_WEBSITE_MAX_HTML_PAGES
        ) {
          const dests = noteRedirects(html, url);
          const next = dests.find((d) => !fetchedHtmlKeys.has(visitKey(d)));
          if (!next) break;
          if (remaining() < PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS) {
            clientRedirectIncomplete = true;
            break;
          }
          if (!selectedClientRedirect) selectedClientRedirect = next;
          clientRedirectAttempted = true;
          const page = await fetchSafeHtmlPage({
            rawUrl: next,
            candidateDomain: companyDomain,
            deps: fetchDeps,
          });
          if (page.status === "timeout") {
            recordAttempt(pageAttempts, next, page, {});
            clientRedirectOutcome = "timeout";
            clientRedirectIncomplete = true;
            return false;
          }
          if (page.status === "blocked") {
            recordAttempt(pageAttempts, next, page, {});
            clientRedirectOutcome = "blocked";
            clientRedirectIncomplete = true;
            return false;
          }
          if (page.status === "rejected") {
            recordAttempt(pageAttempts, next, page, {});
            clientRedirectOutcome = "security_rejected";
            clientRedirectIncomplete = true;
            return false;
          }
          if (page.status !== "ok" || !page.body || !page.finalUrl) {
            recordAttempt(pageAttempts, next, page, {});
            clientRedirectOutcome = "http_error";
            clientRedirectIncomplete = true;
            return false;
          }
          clientRedirectHops += 1;
          pagesFetched += 1;
          fetchedHtmlKeys.add(visitKey(page.finalUrl));
          const extracted = ingestPage(page.finalUrl, page.body);
          recordAttempt(pageAttempts, page.finalUrl, page, {
            emailsExtracted: extracted.emails,
            linksDiscovered: extracted.links.length,
          });
          url = page.finalUrl;
          html = page.body;
          homepage = page;
          homepageUrl = page.finalUrl;
          homeExtract = extracted;
          if (extracted.emails > 0 || extracted.links.length > 0) {
            observedWorkingOrigin = page.finalUrl;
            clientRedirectOutcome = "ok";
            return true;
          }
          clientRedirectOutcome = "sparse";
        }
        return false;
      }

      const startUrls = homepageCandidates(query.website, domain);
      let homepage: SafePageFetchResult | undefined;
      let homepageUrl: string | undefined;

      for (const start of startUrls) {
        if (remaining() <= 0) break;
        const page = await fetchSafeHtmlPage({
          rawUrl: start,
          candidateDomain: companyDomain,
          deps: fetchDeps,
        });
        if (page.status === "rejected") {
          recordAttempt(pageAttempts, start, page, {});
          continue;
        }
        if (page.status === "timeout") {
          recordAttempt(pageAttempts, start, page, {});
          continue;
        }
        if (page.status === "blocked") {
          sawBlocked = true;
          recordAttempt(pageAttempts, start, page, {});
          continue;
        }
        if (page.status === "ok" && page.body && page.finalUrl) {
          homepage = page;
          homepageUrl = page.finalUrl;
          break;
        }
        recordAttempt(pageAttempts, start, page, {});
      }

      if (!homepage?.body || !homepageUrl) {
        if (sawBlocked) return finish("blocked");
        if (pageAttempts.some((a) => a.outcome === "timeout") || remaining() <= 0) {
          return finish("timeout");
        }
        return finish("unavailable");
      }

      let homeExtract = ingestPage(homepageUrl, homepage.body);
      pagesFetched += 1;
      fetchedHtmlKeys.add(visitKey(homepageUrl));
      recordAttempt(pageAttempts, homepageUrl, homepage, {
        emailsExtracted: homeExtract.emails,
        linksDiscovered: homeExtract.links.length,
      });
      preferredOrigin = originHomeUrl(homepageUrl) ?? homepageUrl;

      if (homeExtract.emails === 0 && homeExtract.links.length === 0) {
        await followSparseClientRedirects(homepageUrl, homepage.body);
      }

      if (homeExtract.emails === 0 && homeExtract.links.length === 0) {
        const alternate = httpsApexWwwAlternate(homepageUrl, domain);
        if (alternate && remaining() >= PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS) {
          if (!fetchedHtmlKeys.has(visitKey(alternate))) {
            alternateOriginAttempted = true;
            const altPage = await fetchSafeHtmlPage({
              rawUrl: alternate,
              candidateDomain: companyDomain,
              deps: fetchDeps,
            });
            if (altPage.status === "ok" && altPage.body && altPage.finalUrl) {
              pagesFetched += 1;
              fetchedHtmlKeys.add(visitKey(altPage.finalUrl));
              const altExtract = ingestPage(altPage.finalUrl, altPage.body);
              recordAttempt(pageAttempts, altPage.finalUrl, altPage, {
                emailsExtracted: altExtract.emails,
                linksDiscovered: altExtract.links.length,
              });
              if (altExtract.emails > 0 || altExtract.links.length > 0) {
                homepage = altPage;
                homepageUrl = altPage.finalUrl;
                homeExtract = altExtract;
                observedWorkingOrigin = originHomeUrl(altPage.finalUrl);
              } else {
                homepage = altPage;
                homepageUrl = altPage.finalUrl;
                homeExtract = altExtract;
                await followSparseClientRedirects(altPage.finalUrl, altPage.body);
              }
            } else {
              recordAttempt(pageAttempts, alternate, altPage, {});
              if (
                emailsByAddress.size === 0 &&
                (altPage.status === "timeout" || altPage.status === "blocked" || altPage.status === "rejected")
              ) {
                return finish("incomplete");
              }
            }
          }
        } else if (alternate) {
          alternateIncomplete = true;
        }
      }

      if (!homepageUrl) return finish("unavailable");
      const entryUrl = homepageUrl;

      const rankedLinks = rankCandidatePageLinks(homeExtract.links);
      const secondaryCandidates: string[] = [];
      const seen = new Set<string>(fetchedHtmlKeys);
      seen.add(entryUrl.replace(/\/$/, "") || entryUrl);
      for (const link of rankedLinks) {
        const resolved = resolveSameSiteHref(link.href, entryUrl, companyDomain);
        if (!resolved) continue;
        const key = resolved.replace(/\/$/, "") || resolved;
        if (seen.has(key) || key === (entryUrl.replace(/\/$/, "") || entryUrl)) continue;
        seen.add(key);
        secondaryCandidates.push(resolved);
        if (secondaryCandidates.length >= Math.max(0, PUBLIC_WEBSITE_MAX_HTML_PAGES - pagesFetched)) break;
      }
      rankedPagePaths = rankedLinks.map((l) => resolveSameSiteHref(l.href, entryUrl, companyDomain) ?? l.href);
      selectedPagePaths = [...secondaryCandidates];
      wantedSecondary = secondaryCandidates.length > 0;

      let robotsTxt: string | undefined;
      let robotsDetermined = false;
      const robotsUrl = (() => {
        try {
          return new URL("/robots.txt", entryUrl).toString();
        } catch {
          return undefined;
        }
      })();

      if (robotsUrl && remaining() > 0) {
        const robotsPage = await fetchSafeHtmlPage({
          rawUrl: robotsUrl,
          candidateDomain: companyDomain,
          deps: {
            ...fetchDeps,
            maxBodyBytes: PUBLIC_WEBSITE_ROBOTS_MAX_BODY_BYTES,
            timeoutMs: Math.min(PUBLIC_WEBSITE_ROBOTS_TIMEOUT_MS, Math.max(1, remaining())),
          },
          allowedTypes: ROBOTS_TYPES,
        });
        if (robotsPage.status === "ok") {
          robotsTxt = robotsPage.body;
          robotsDetermined = true;
          recordAttempt(pageAttempts, robotsUrl, robotsPage, {});
        } else if (robotsPage.status === "unavailable" || robotsPage.status === "not_html") {
          robotsDetermined = true;
          recordAttempt(pageAttempts, robotsUrl, robotsPage, {});
        } else if (robotsPage.status === "blocked") {
          recordAttempt(pageAttempts, robotsUrl, robotsPage, {});
          if (emailsByAddress.size > 0) return finish("ok");
          return finish("blocked");
        } else {
          secondaryIncomplete = true;
          recordAttempt(pageAttempts, robotsUrl, robotsPage, {});
        }
      } else if (robotsUrl) {
        secondaryIncomplete = true;
        recordAttempt(pageAttempts, robotsUrl, undefined, { outcome: "timeout" });
      } else {
        robotsDetermined = true;
      }

      if (!robotsDetermined) {
        if (emailsByAddress.size > 0) return finish("ok");
        return finish("incomplete");
      }

      for (const url of secondaryCandidates) {
        let path = "/";
        try {
          path = new URL(url).pathname;
        } catch {
          continue;
        }
        if (!pathAllowedByRobots(robotsTxt, path)) {
          recordAttempt(pageAttempts, url, undefined, { outcome: "blocked_by_robots" });
          continue;
        }
        if (remaining() < PUBLIC_WEBSITE_MIN_REMAINING_FOR_PAGE_MS) {
          secondaryIncomplete = true;
          break;
        }
        const page = await fetchSafeHtmlPage({
          rawUrl: url,
          candidateDomain: companyDomain,
          deps: fetchDeps,
        });
        if (page.status === "timeout") {
          secondaryIncomplete = true;
          recordAttempt(pageAttempts, url, page, {});
          continue;
        }
        if (page.status === "blocked") {
          sawBlocked = true;
          recordAttempt(pageAttempts, url, page, {});
          continue;
        }
        if (page.status !== "ok" || !page.body || !page.finalUrl) {
          if (page.status === "rejected") {
            recordAttempt(pageAttempts, url, page, {});
          } else {
            secondaryIncomplete = true;
            recordAttempt(pageAttempts, url, page, {});
          }
          continue;
        }
        pagesFetched += 1;
        const extracted = ingestPage(page.finalUrl, page.body);
        recordAttempt(pageAttempts, page.finalUrl, page, {
          emailsExtracted: extracted.emails,
          linksDiscovered: extracted.links.length,
        });
      }

      if (emailsByAddress.size > 0) return finish("ok");
      if (clientRedirectIncomplete) return finish("incomplete");
      if (alternateIncomplete) return finish("incomplete");
      if (wantedSecondary && secondaryIncomplete) return finish("incomplete");
      if (pagesFetched === 0 && sawBlocked) return finish("blocked");
      return finish("no_result");
    },
  };
}
