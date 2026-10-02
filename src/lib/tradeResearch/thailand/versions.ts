/**
 * TH02 single source of truth for Thailand version constants.
 *
 * This file has NO imports so it can be safely consumed by both
 * `src/lib/tradeResearch/context.ts` (for market-aware plan-version
 * resolution) and `src/lib/tradeResearch/thailand/providerPlan.ts`
 * without creating a circular dependency.
 *
 * Any future bump of the Thailand plan version MUST change the value
 * here — downstream canonicalization, fingerprinting, and the plan
 * module all consume this constant.
 */

export const THAILAND_PROVIDER_PLAN_VERSION = "thailand-provider-plan-v1" as const;
