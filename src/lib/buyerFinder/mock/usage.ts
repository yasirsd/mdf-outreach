import { toUsageBucket, type ProviderUsage } from "@/lib/buyerFinder/usage";

/**
 * Deterministic mock Hunter usage for Buyer Finder UI.
 * Shape matches a real /v2/usage payload (unified + search + verification).
 * Not live data. No API key. Real usage stays server-only.
 */
export const MOCK_HUNTER_USAGE: ProviderUsage = {
  provider: "hunter",
  resetDate: "2026-10-15",
  unifiedCredits: toUsageBucket(0, 50, 50),
  searches: toUsageBucket(0, 50, 50),
  verifications: toUsageBucket(0, 100, 100),
  fetchedAt: "2026-08-27T00:00:00.000Z",
};

export const MOCK_HUNTER_USAGE_SPLIT: ProviderUsage = {
  provider: "hunter",
  resetDate: "2026-10-15",
  searches: toUsageBucket(10, 50, 40),
  verifications: toUsageBucket(5, 50, 45),
  fetchedAt: "2026-08-27T00:00:00.000Z",
};

export const MOCK_HUNTER_USAGE_ZERO: ProviderUsage = {
  provider: "hunter",
  resetDate: "2026-10-15",
  unifiedCredits: toUsageBucket(0, 0, 0),
  fetchedAt: "2026-08-27T00:00:00.000Z",
};

export const MOCK_HUNTER_USAGE_NO_RESET: ProviderUsage = {
  provider: "hunter",
  resetDate: null,
  unifiedCredits: toUsageBucket(0, 50, 50),
  fetchedAt: "2026-08-27T00:00:00.000Z",
};
