import type {
  CountryAlpha2,
  HsRevision,
  MarketDataFrequency,
  MarketProviderCapability,
  MarketProviderDescriptor,
  MarketProviderQuotaState,
} from "./types";

export type MarketProviderBlockReason =
  | "provider_disabled"
  | "paid_provider"
  | "card_required"
  | "unsupported_capability"
  | "unsupported_geography"
  | "unsupported_hs_revision"
  | "unsupported_frequency"
  | "missing_required_key"
  | "quota_exhausted"
  | "quota_unknown"
  | "licence_unverified"
  | "storage_not_approved";

export interface FreeMarketProviderExecutionRequest {
  capability: MarketProviderCapability;
  reporterCountry: CountryAlpha2;
  hsRevision: HsRevision;
  frequency: MarketDataFrequency;
  hasKey: boolean | undefined;
  quotaState: MarketProviderQuotaState | undefined;
  persistentIngestion: boolean;
}

export type FreeMarketProviderExecutionDecision =
  | { ok: true; quotaState: MarketProviderQuotaState }
  | { ok: false; reason: MarketProviderBlockReason };

function supportsGeography(
  descriptor: MarketProviderDescriptor,
  reporterCountry: CountryAlpha2,
): boolean {
  const coverage = descriptor.geographicCoverage;
  if (coverage.scope === "global") return true;
  const requested = reporterCountry.toUpperCase();
  return coverage.reporterCountries.some((code) => code.toUpperCase() === requested);
}

function persistentLicenceApproved(descriptor: MarketProviderDescriptor): boolean {
  const license = descriptor.license;
  return Boolean(
    license &&
      license.datasetSource.trim() &&
      license.datasetLicenseName?.trim() &&
      license.distributionService.trim() &&
      license.serviceTermsVerified &&
      license.licenceVerifiedAt?.trim(),
  );
}

/**
 * Central free-only execution gate. Future adapters must call this before
 * issuing HTTP. Missing credential/quota/licence state fails closed.
 */
export function checkFreeMarketProviderExecution(
  descriptor: MarketProviderDescriptor,
  request: FreeMarketProviderExecutionRequest,
): FreeMarketProviderExecutionDecision {
  if (!descriptor.enabled) return { ok: false, reason: "provider_disabled" };
  if (descriptor.costClass === "paid") return { ok: false, reason: "paid_provider" };
  if (descriptor.requiresCard) return { ok: false, reason: "card_required" };
  if (!descriptor.capabilities.includes(request.capability)) {
    return { ok: false, reason: "unsupported_capability" };
  }
  if (!supportsGeography(descriptor, request.reporterCountry)) {
    return { ok: false, reason: "unsupported_geography" };
  }
  if (
    !descriptor.hsRevisions.includes(request.hsRevision) ||
    !descriptor.hsCompatibility[request.hsRevision]
  ) {
    return { ok: false, reason: "unsupported_hs_revision" };
  }
  if (!descriptor.frequency.includes(request.frequency)) {
    return { ok: false, reason: "unsupported_frequency" };
  }
  if (descriptor.requiresKey && request.hasKey !== true) {
    return { ok: false, reason: "missing_required_key" };
  }

  const quotaState = request.quotaState ??
    (descriptor.quotaPolicy === "unlimited" ? "unlimited" : "unknown");
  if (quotaState === "exhausted") return { ok: false, reason: "quota_exhausted" };
  if (quotaState === "unknown" && !descriptor.unknownQuotaSafe) {
    return { ok: false, reason: "quota_unknown" };
  }
  if (quotaState === "unlimited" && descriptor.quotaPolicy !== "unlimited") {
    return { ok: false, reason: "quota_unknown" };
  }

  if (request.persistentIngestion) {
    if (!persistentLicenceApproved(descriptor)) {
      return { ok: false, reason: "licence_unverified" };
    }
    if (descriptor.license?.storageAllowed !== true) {
      return { ok: false, reason: "storage_not_approved" };
    }
  }
  return { ok: true, quotaState };
}

export class MarketProviderExecutionBlockedError extends Error {
  constructor(readonly reason: MarketProviderBlockReason) {
    super(`Market provider execution blocked: ${reason}`);
    this.name = "MarketProviderExecutionBlockedError";
  }
}

export function assertFreeMarketProviderExecution(
  descriptor: MarketProviderDescriptor,
  request: FreeMarketProviderExecutionRequest,
): void {
  const decision = checkFreeMarketProviderExecution(descriptor, request);
  if (!decision.ok) throw new MarketProviderExecutionBlockedError(decision.reason);
}
