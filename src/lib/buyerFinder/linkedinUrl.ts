/**
 * Narrow LinkedIn profile URL sanitizer for Hunter-revealed URLs.
 *
 * HTTPS only. Host must be linkedin.com or www.linkedin.com.
 * Rejects javascript:, data:, credentials, and lookalike domains.
 * Safe to import from client UI for href rendering.
 */

const ALLOWED_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function sanitizeLinkedinProfileUrl(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw || hasControlChars(raw)) return undefined;
  const lower = raw.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!ALLOWED_HOSTS.has(host)) return undefined;
  if (url.port && url.port !== "443") return undefined;

  url.hash = "";
  return url.toString();
}
