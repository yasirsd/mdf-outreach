/**
 * TH02 — Thailand provider plan (contract only; no fetching yet).
 *
 * V1 of the Thailand plan declares exactly two AUTOMATED evidence
 * sources and three MANUAL_ONLY surfaces. The automated providers
 * flow through the generic T11 executor + T10 checkpoints + T12
 * certification — Thailand does NOT get a bespoke worker lifecycle.
 *
 * The MANUAL_ONLY surfaces (DBD, Customs operator registry, Thai
 * FDA) MUST NOT appear in the executor plan under any condition.
 * They are evidence notes attached by an authenticated operator in
 * TH04C; the executor is forbidden from scraping them.
 *
 * Automatic monetary spend remains ₹0 — nothing here enables a
 * paid API, trial credit, or Hunter reveal.
 */

export { THAILAND_PROVIDER_PLAN_VERSION } from "./versions";
import { THAILAND_PROVIDER_PLAN_VERSION } from "./versions";

/** Automated provider IDs eligible for the T11 executor on TH candidates. */
export const THAILAND_AUTOMATED_PROVIDER_IDS = [
  "thai-customs-stats",
  "public-website",
] as const;

/**
 * MANUAL_ONLY surfaces. The executor is forbidden from running these;
 * they only appear as human-attested evidence notes captured in TH04C
 * and aggregated by TH05.
 */
export const THAILAND_MANUAL_ONLY_PROVIDER_IDS = [
  "thai-dbd",
  "thai-customs-operator",
  "thai-fda-importer",
] as const;

export type ThailandAutomatedProviderId = (typeof THAILAND_AUTOMATED_PROVIDER_IDS)[number];
export type ThailandManualOnlyProviderId = (typeof THAILAND_MANUAL_ONLY_PROVIDER_IDS)[number];

export interface ThailandProviderPlan {
  readonly version: typeof THAILAND_PROVIDER_PLAN_VERSION;
  readonly marketCountryCode: "TH";
  readonly automatedProviderIds: readonly ThailandAutomatedProviderId[];
  readonly manualOnlyProviderIds: readonly ThailandManualOnlyProviderId[];
  readonly automaticSpendRupees: 0;
}

export const THAILAND_PROVIDER_PLAN_V1: ThailandProviderPlan = {
  version: THAILAND_PROVIDER_PLAN_VERSION,
  marketCountryCode: "TH",
  automatedProviderIds: THAILAND_AUTOMATED_PROVIDER_IDS,
  manualOnlyProviderIds: THAILAND_MANUAL_ONLY_PROVIDER_IDS,
  automaticSpendRupees: 0,
};

/**
 * Guard: given a provider id, is it allowed to appear in the TH
 * T11 executor plan? Only the automated list qualifies. MANUAL_ONLY
 * ids ALWAYS return false — this is the fence that prevents a future
 * refactor from accidentally wiring DBD/FDA/Customs operator into
 * the executor.
 */
export function isThailandAutomatedProvider(
  providerId: string,
): providerId is ThailandAutomatedProviderId {
  return (THAILAND_AUTOMATED_PROVIDER_IDS as readonly string[]).includes(providerId);
}
