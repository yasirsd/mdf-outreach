/**
 * Bounded apex ↔ www homepage pairing for public website discovery.
 * No other subdomains. No DNS enumeration.
 */

import { parsePublicHttpUrl } from "./ssrf";
import { registrableDomain } from "./sameSite";

export function originHomeUrl(raw: string): string | undefined {
  try {
    const url = parsePublicHttpUrl(raw);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * HTTPS homepage of the conventional apex/www counterpart, or undefined
 * when the current host is not exactly the candidate apex or www.<apex>.
 */
export function httpsApexWwwAlternate(
  currentUrl: string,
  candidateDomain: string,
): string | undefined {
  let current: URL;
  try {
    current = parsePublicHttpUrl(currentUrl);
  } catch {
    return undefined;
  }
  const apex = registrableDomain(candidateDomain) ?? registrableDomain(current.hostname);
  if (!apex) return undefined;
  const host = current.hostname.replace(/\.$/, "").toLowerCase();
  const www = `www.${apex}`;
  let other: string | undefined;
  if (host === apex) other = www;
  else if (host === www) other = apex;
  else return undefined;
  if (other === host) return undefined;
  return `https://${other}/`;
}
