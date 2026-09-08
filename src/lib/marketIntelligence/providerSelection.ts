/**
 * MI0.1 — provider selection policy.
 *
 * Eligibility is fail-closed before ranking. Because every required
 * MDF market source is free, paid/card providers never enter the ranked
 * set. Silently changing providers
 * between refreshes can move a Market Fit score by tens of points;
 * canonical providers exist per capability so scores stay comparable.
 *
 * The policy is versioned (`MI_PROVIDER_SELECTION_VERSION`); any
 * canonical-provider change bumps the version so historical scores
 * are traceable to the exact policy they were computed under.
 */

import type {
  CountryAlpha2,
  HsRevision,
  MarketDataFrequency,
  MarketProviderCapability,
  MarketProviderDescriptor,
  MarketProviderQuotaState,
} from "./types";
import { checkFreeMarketProviderExecution } from "./providerExecution";

export const MI_PROVIDER_SELECTION_VERSION = "mi-select-v2";

/**
 * Priority order for provider selection. Cost intentionally sits
 * LAST because free/free-tier providers are the only ones MI will
 * automatically call — the earlier axes discriminate meaningfully.
 */
export const PROVIDER_SELECTION_PRIORITIES = [
  "source_authority",
  "hs_compatibility",
  "geographic_coverage",
  "data_recency",
  "frequency",
  "free_quota_availability",
  "canonical_provider",
  "provider_id",
] as const;

export type ProviderSelectionPriority = (typeof PROVIDER_SELECTION_PRIORITIES)[number];

/**
 * Canonical provider per analytical capability. Canonical preference is a
 * late stability tie-breaker after authority, compatibility, coverage,
 * recency, frequency, and quota. MI1A still has no network adapters.
 */
export const CANONICAL_PROVIDER_BY_CAPABILITY: Record<
  MarketProviderCapability,
  string | null
> = Object.freeze({
  import_series: "baci_oec",
  partner_series: "baci_oec",
  origin_breakdown: "baci_oec",
  tariff_data: "wits_trains",
  seasonality: null,
});

export interface ProviderSelectionQuery {
  capability: MarketProviderCapability;
  reporterCountry: CountryAlpha2;
  hsRevision: HsRevision;
  frequency: MarketDataFrequency;
  hasKey?: (providerId: string) => boolean;
  quotaState?: (providerId: string) => MarketProviderQuotaState;
  persistentIngestion: boolean;
}

export interface ProviderSelectionResult {
  descriptor: MarketProviderDescriptor;
  reasons: string[];
  policyVersion: string;
}

const SOURCE_TIER_RANK: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const HS_COMPATIBILITY_RANK = { native: 2, harmonized: 1 } as const;

function geographyRank(descriptor: MarketProviderDescriptor): number {
  return descriptor.geographicCoverage.scope === "countries" ? 2 : 1;
}

function quotaRank(state: MarketProviderQuotaState): number {
  if (state === "unlimited") return 3;
  if (state === "available") return 2;
  if (state === "unknown") return 1;
  return 0;
}

/**
 * Select under the versioned priority order after the central execution
 * guard has removed every ineligible provider. Source authority ranks first;
 * canonical preference applies only among otherwise comparable candidates.
 */
export function selectProvider(
  descriptors: readonly MarketProviderDescriptor[],
  query: ProviderSelectionQuery,
): ProviderSelectionResult | undefined {
  const eligible = descriptors.flatMap((descriptor) => {
    const reportedQuotaState = query.quotaState?.(descriptor.providerId);
    const decision = checkFreeMarketProviderExecution(descriptor, {
      capability: query.capability,
      reporterCountry: query.reporterCountry,
      hsRevision: query.hsRevision,
      frequency: query.frequency,
      hasKey: query.hasKey?.(descriptor.providerId),
      quotaState: reportedQuotaState,
      persistentIngestion: query.persistentIngestion,
    });
    return decision.ok ? [{ descriptor, quotaState: decision.quotaState }] : [];
  });
  if (eligible.length === 0) return undefined;

  const canonical = CANONICAL_PROVIDER_BY_CAPABILITY[query.capability];
  const scored = eligible
    .map(({ descriptor, quotaState }) => ({
      descriptor,
      quotaState,
      canonical: canonical != null && descriptor.providerId === canonical,
      tier: SOURCE_TIER_RANK[descriptor.sourceTier] ?? 0,
      hsCompatibility: HS_COMPATIBILITY_RANK[descriptor.hsCompatibility[query.hsRevision]!] ?? 0,
      geography: geographyRank(descriptor),
      recency: descriptor.latestPeriod ?? "",
      frequency: descriptor.frequency.includes(query.frequency) ? 1 : 0,
      quota: quotaRank(quotaState),
    }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return b.tier - a.tier;
      if (a.hsCompatibility !== b.hsCompatibility) return b.hsCompatibility - a.hsCompatibility;
      if (a.geography !== b.geography) return b.geography - a.geography;
      if (a.recency !== b.recency) return b.recency.localeCompare(a.recency);
      if (a.frequency !== b.frequency) return b.frequency - a.frequency;
      if (a.quota !== b.quota) return b.quota - a.quota;
      if (a.canonical !== b.canonical) return a.canonical ? -1 : 1;
      return a.descriptor.providerId.localeCompare(b.descriptor.providerId);
    });

  const chosen = scored[0]!;
  const reasons: string[] = [];
  if (chosen.canonical) reasons.push(`canonical provider for ${query.capability}`);
  reasons.push(`source tier ${chosen.descriptor.sourceTier}`);
  reasons.push(`HS revision compatible (${query.hsRevision})`);
  reasons.push(`reporter geography supported (${query.reporterCountry})`);
  reasons.push(`frequency supported (${query.frequency})`);
  if (chosen.descriptor.latestPeriod) reasons.push(`latest period ${chosen.descriptor.latestPeriod}`);
  reasons.push(`quota ${chosen.quotaState}`);
  return {
    descriptor: chosen.descriptor,
    reasons,
    policyVersion: MI_PROVIDER_SELECTION_VERSION,
  };
}
