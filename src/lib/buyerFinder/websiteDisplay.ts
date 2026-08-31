/**
 * Safe display of a candidate company website. Never put an unparsed
 * database string into href. Client-safe: no Node builtins, no fetch stack.
 */

function parseSafeHttpUrl(raw: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.username || url.password) return undefined;
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) return undefined;
  return url;
}

function hostForCompare(value: string): string | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  let host = raw;
  if (raw.includes("://")) {
    try {
      host = new URL(raw).hostname;
    } catch {
      return undefined;
    }
  } else {
    host = raw.split("/")[0] ?? raw;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return host.length > 0 ? host : undefined;
}

function isSameCompanyHost(
  candidateDomain: string | null | undefined,
  hostname: string,
): boolean {
  const cand = hostForCompare(candidateDomain ?? "");
  const host = hostForCompare(hostname);
  if (!cand || !host) return false;
  if (host === cand) return true;
  return host.endsWith(`.${cand}`);
}

export function safeCandidateWebsiteHref(
  website: string | null | undefined,
  candidateDomain: string | null | undefined,
): string | undefined {
  const raw = (website ?? "").trim();
  if (!raw) return undefined;
  const withScheme = raw.includes("://") ? raw : `https://${raw.replace(/^\/+/, "")}`;
  const url = parseSafeHttpUrl(withScheme);
  if (!url) return undefined;
  if (candidateDomain && !isSameCompanyHost(candidateDomain, url.hostname)) return undefined;
  url.hash = "";
  return url.toString();
}

export function candidateWebsiteLabel(href: string): string {
  try {
    const url = new URL(href);
    if (url.pathname && url.pathname !== "/") {
      return `${url.host}${url.pathname}`.replace(/\/$/, "");
    }
    return url.host;
  } catch {
    return href.replace(/^https?:\/\//i, "");
  }
}
