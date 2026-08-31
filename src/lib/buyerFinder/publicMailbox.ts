/**
 * Mailbox classification and deterministic ranking for public company emails.
 * Outreach-route ranking only — never infers that the company is a buyer.
 */

import type { PublicMailboxKind, PublicMailboxType } from "./types";
import { isSameCompanySite } from "./sameSite";
import { normalizeDomain } from "./normalize";

const STRONG = new Set([
  "procurement",
  "purchasing",
  "purchase",
  "buyer",
  "buying",
  "imports",
  "import",
  "sourcing",
]);

const NEXT = new Set([
  "trade",
  "commercial",
  "business",
  "b2b",
  "wholesale",
  "exports",
  "export",
  "sales",
]);

const GENERAL = new Set([
  "info",
  "contact",
  "office",
  "hello",
  "enquiry",
  "enquiries",
  "inquiry",
  "inquiries",
  "admin",
]);

const WEAK = new Set([
  "support",
  "help",
  "careers",
  "jobs",
  "hr",
  "privacy",
  "legal",
  "webmaster",
]);

const JUNK_LOCAL = new Set([
  "noreply",
  "no-reply",
  "do-not-reply",
  "donotreply",
  "postmaster",
  "abuse",
  "security",
  "dmarc",
  "test",
]);

const JUNK_FULL = new Set([
  "example@example.com",
  "test@example.com",
  "user@example.com",
  "email@example.com",
]);

export function localPart(email: string): string {
  return email.split("@")[0]?.toLowerCase() ?? "";
}

export function emailDomain(email: string): string | undefined {
  const host = email.split("@")[1];
  return normalizeDomain(host);
}

export function classifyMailboxType(email: string): PublicMailboxType {
  const local = localPart(email).split("+")[0] ?? "";
  const token = local.split(/[._-]/)[0] ?? local;
  if (token === "procurement") return "procurement";
  if (token === "purchasing" || token === "purchase" || token === "buyer" || token === "buying") {
    return "purchasing";
  }
  if (token === "imports" || token === "import") return "imports";
  if (token === "sourcing") return "sourcing";
  if (token === "sales") return "sales";
  if (
    token === "trade" ||
    token === "commercial" ||
    token === "business" ||
    token === "b2b" ||
    token === "wholesale" ||
    token === "exports" ||
    token === "export"
  ) {
    return "commercial";
  }
  if (GENERAL.has(token)) return "general";
  if (WEAK.has(token)) return "support";
  if (STRONG.has(token)) return "other";
  if (looksNamed(local)) return "named";
  return "other";
}

function looksNamed(local: string): boolean {
  if (!local) return false;
  if (STRONG.has(local) || NEXT.has(local) || GENERAL.has(local) || WEAK.has(local)) return false;
  return /[a-z]+\.[a-z]+/.test(local) || /[a-z]+_[a-z]+/.test(local);
}

export function classifyMailboxKind(
  email: string,
  candidateDomain: string | undefined,
): PublicMailboxKind {
  const host = emailDomain(email);
  if (host && isSameCompanySite(candidateDomain, host)) return "corporate";
  return "external";
}

export function isJunkPublicEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (JUNK_FULL.has(normalized)) return true;
  const local = localPart(normalized);
  if (JUNK_LOCAL.has(local)) return true;
  const host = emailDomain(normalized);
  if (host === "example.com" || host === "example.org" || host === "example.net") return true;
  return false;
}

/**
 * Lower is better.
 * 0 strong outreach · 1 commercial/sales · 2 general · 3 named · 4 weak · 5 other
 */
export function mailboxRoleRank(email: string): number {
  const local = (localPart(email).split("+")[0] ?? "").split(/[._-]/)[0] ?? "";
  if (STRONG.has(local)) return 0;
  if (NEXT.has(local)) return 1;
  if (GENERAL.has(local)) return 2;
  if (WEAK.has(local)) return 4;
  if (looksNamed(localPart(email).split("+")[0] ?? "")) return 3;
  return 5;
}

export function pageQualityFromUrl(sourceUrl: string): number {
  let path = "";
  try {
    path = new URL(sourceUrl).pathname.toLowerCase();
  } catch {
    path = sourceUrl.toLowerCase();
  }
  if (
    /contact-us|get-in-touch|connect-with-us|reach-us|\/contact(?:\/|$)|\/connect(?:\/|$)/.test(path)
  ) {
    return 0;
  }
  if (/about-us|\/about(?:\/|$)|\/company(?:\/|$)|locations/.test(path)) {
    return 1;
  }
  if (path === "/" || path === "" || path === "/index.html" || path === "/home") {
    return 2;
  }
  return 3;
}

export interface RankablePublicEmail {
  email: string;
  mailboxKind: PublicMailboxKind;
  sourceUrl: string;
  pageQuality?: number;
}

/**
 * Deterministic primary selection:
 * role relevance → corporate domain → source-page quality → lexical email.
 */
export function comparePublicEmails(a: RankablePublicEmail, b: RankablePublicEmail): number {
  const role = mailboxRoleRank(a.email) - mailboxRoleRank(b.email);
  if (role !== 0) return role;
  const corp = Number(a.mailboxKind === "corporate") - Number(b.mailboxKind === "corporate");
  if (corp !== 0) return -corp;
  const qa = a.pageQuality ?? pageQualityFromUrl(a.sourceUrl);
  const qb = b.pageQuality ?? pageQualityFromUrl(b.sourceUrl);
  if (qa !== qb) return qa - qb;
  return a.email.localeCompare(b.email);
}

export function selectPrimaryPublicEmail<T extends RankablePublicEmail>(emails: T[]): T | undefined {
  if (emails.length === 0) return undefined;
  return [...emails].sort(comparePublicEmails)[0];
}
