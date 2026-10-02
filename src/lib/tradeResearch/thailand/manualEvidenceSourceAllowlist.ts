/**
 * TH04C — Thailand manual-evidence source URL allowlist.
 *
 * The persistence layer refuses any `source_url` whose origin is not
 * an official Thai government domain for the given MANUAL_ONLY
 * provider. HTTPS is required where the official source supports
 * it (all three do). The allowlist is INTENTIONALLY narrow — if a
 * future official subdomain emerges, add it here in a reviewed
 * change. Never widen in response to a submitted URL.
 */

import type { ThailandManualOnlyProviderId } from "./providerPlan";

/** Suffix-matched hostnames (`endsWith`). All must be HTTPS-accessible. */
const PROVIDER_HOST_SUFFIXES: Record<ThailandManualOnlyProviderId, readonly string[]> = {
  "thai-dbd": [
    "dbd.go.th",
    "datawarehouse.dbd.go.th",
    "moc.go.th",
  ],
  "thai-customs-operator": [
    "customs.go.th",
    "aeothai.customs.go.th",
  ],
  "thai-fda-importer": [
    "fda.moph.go.th",
    "moph.go.th",
    "oryor.com",
  ],
};

export class ThailandManualEvidenceSourceUrlError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ThailandManualEvidenceSourceUrlError";
  }
}

/**
 * Validates the source URL for a given MANUAL_ONLY provider. Returns
 * the normalized URL string on success; throws
 * `ThailandManualEvidenceSourceUrlError` otherwise. Never widens
 * the allowlist based on the input URL.
 */
export function requireAllowedManualEvidenceSourceUrl(
  providerId: ThailandManualOnlyProviderId,
  rawUrl: string,
): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new ThailandManualEvidenceSourceUrlError(
      "MANUAL_EVIDENCE_SOURCE_URL_MISSING",
      "Manual evidence source URL is required.",
    );
  }
  let parsed: URL;
  try { parsed = new URL(rawUrl.trim()); }
  catch {
    throw new ThailandManualEvidenceSourceUrlError(
      "MANUAL_EVIDENCE_SOURCE_URL_INVALID",
      "Manual evidence source URL is not a valid absolute URL.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new ThailandManualEvidenceSourceUrlError(
      "MANUAL_EVIDENCE_SOURCE_URL_NOT_HTTPS",
      "Manual evidence source URL must use HTTPS.",
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = PROVIDER_HOST_SUFFIXES[providerId];
  if (!allowed) {
    throw new ThailandManualEvidenceSourceUrlError(
      "MANUAL_EVIDENCE_PROVIDER_UNKNOWN",
      `Unknown MANUAL_ONLY provider: ${providerId}`,
    );
  }
  const ok = allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!ok) {
    throw new ThailandManualEvidenceSourceUrlError(
      "MANUAL_EVIDENCE_SOURCE_URL_NOT_ALLOWED",
      `Manual evidence source URL host "${host}" is not an allowed official source for ${providerId}.`,
    );
  }
  return parsed.toString();
}

export { PROVIDER_HOST_SUFFIXES as THAILAND_MANUAL_EVIDENCE_SOURCE_HOST_SUFFIXES };
