/**
 * SSRF defenses for fetching a candidate's own public website.
 *
 * The browser never supplies a fetch target. Callers pass a URL that
 * was derived server-side from the persisted candidate website/domain.
 *
 * Before every network request: parse, validate scheme/host, resolve
 * DNS, reject private/reserved destinations. Redirects are validated
 * the same way and must remain on the candidate's registrable domain.
 */

import { BlockList, isIP } from "node:net";
import { isSameCompanySite } from "./sameSite";

export const PUBLIC_WEBSITE_MAX_REDIRECTS = 5;

export function allowedPortForProtocol(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return allowedPortForProtocol(url.protocol);
}

export type UnsafeUrlReason =
  | "scheme"
  | "credentials"
  | "ip_literal"
  | "hostname"
  | "private"
  | "dns"
  | "same_site"
  | "empty"
  | "port";

export class UnsafeUrlError extends Error {
  readonly reason: UnsafeUrlReason;

  constructor(reason: UnsafeUrlReason) {
    super("URL is not allowed");
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

const DISALLOWED = new BlockList();
DISALLOWED.addSubnet("0.0.0.0", 8, "ipv4");
DISALLOWED.addSubnet("10.0.0.0", 8, "ipv4");
DISALLOWED.addSubnet("100.64.0.0", 10, "ipv4");
DISALLOWED.addSubnet("127.0.0.0", 8, "ipv4");
DISALLOWED.addSubnet("169.254.0.0", 16, "ipv4");
DISALLOWED.addSubnet("172.16.0.0", 12, "ipv4");
DISALLOWED.addSubnet("192.168.0.0", 16, "ipv4");
DISALLOWED.addSubnet("192.0.0.0", 24, "ipv4");
DISALLOWED.addSubnet("192.0.2.0", 24, "ipv4");
DISALLOWED.addSubnet("198.18.0.0", 15, "ipv4");
DISALLOWED.addSubnet("198.51.100.0", 24, "ipv4");
DISALLOWED.addSubnet("203.0.113.0", 24, "ipv4");
DISALLOWED.addSubnet("224.0.0.0", 4, "ipv4");
DISALLOWED.addSubnet("240.0.0.0", 4, "ipv4");
DISALLOWED.addAddress("255.255.255.255", "ipv4");
DISALLOWED.addAddress("::", "ipv6");
DISALLOWED.addAddress("::1", "ipv6");
DISALLOWED.addSubnet("fc00::", 7, "ipv6");
DISALLOWED.addSubnet("fe80::", 10, "ipv6");
DISALLOWED.addSubnet("ff00::", 8, "ipv6");
DISALLOWED.addSubnet("2001:db8::", 32, "ipv6");

const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".corp",
  ".lan",
  ".home",
  ".localdomain",
];

export type LookupAddresses = (hostname: string) => Promise<string[]>;

export function isDisallowedIp(address: string): boolean {
  const raw = address.trim().toLowerCase();
  if (!raw) return true;

  const mapped = ipv4Mapped(raw);
  if (mapped) return isDisallowedIp(mapped);

  const kind = isIP(raw);
  if (kind === 4) return DISALLOWED.check(raw, "ipv4");
  if (kind === 6) return DISALLOWED.check(raw, "ipv6");
  return true;
}

function ipv4Mapped(address: string): string | undefined {
  const m = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (m) return m[1];
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return undefined;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOST_EXACT.has(host)) return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  if (isIP(host)) return true;
  if (/^\d+$/.test(host)) return true;
  if (/^[\d.]+$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

export function parsePublicHttpUrl(raw: string): URL {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new UnsafeUrlError("empty");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError("scheme");
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new UnsafeUrlError("scheme");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("credentials");
  }
  const port = effectivePort(url);
  if (!Number.isInteger(port) || port !== allowedPortForProtocol(url.protocol)) {
    throw new UnsafeUrlError("port");
  }
  const host = url.hostname.trim().toLowerCase();
  if (!host) throw new UnsafeUrlError("hostname");
  if (isBlockedHostname(host) || isIP(host)) {
    throw new UnsafeUrlError(isIP(host) || /^\d/.test(host) || host.includes(":") ? "ip_literal" : "hostname");
  }
  return url;
}

export async function assertResolvedPublic(
  hostname: string,
  lookup: LookupAddresses,
): Promise<string[]> {
  if (isBlockedHostname(hostname)) {
    throw new UnsafeUrlError(isIP(hostname) ? "ip_literal" : "hostname");
  }
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new UnsafeUrlError("dns");
  }
  if (!addresses.length) throw new UnsafeUrlError("private");
  for (const addr of addresses) {
    if (isDisallowedIp(addr)) throw new UnsafeUrlError("private");
  }
  return addresses;
}

export interface SafeFetchTarget {
  url: URL;
  addresses: string[];
}

export async function assertSafeFetchUrl(input: {
  raw: string;
  candidateDomain: string;
  lookup: LookupAddresses;
}): Promise<SafeFetchTarget> {
  const url = parsePublicHttpUrl(input.raw);
  if (!isSameCompanySite(input.candidateDomain, url.hostname)) {
    throw new UnsafeUrlError("same_site");
  }
  const addresses = await assertResolvedPublic(url.hostname, input.lookup);
  return { url, addresses };
}

/**
 * Persist/render only URLs that would still be legal fetch targets
 * (http(s), default ports, no credentials, same-company host).
 */
export function persistableSourceUrl(
  raw: string,
  candidateDomain: string,
): string | undefined {
  try {
    const url = parsePublicHttpUrl(raw);
    if (!isSameCompanySite(candidateDomain, url.hostname)) return undefined;
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
