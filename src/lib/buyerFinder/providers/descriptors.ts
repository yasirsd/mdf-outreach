/**
 * BF2.1 — provider descriptor foundation.
 *
 * Small, honest metadata describing what each provider CAN do and how
 * MDF Outreach classifies its cost. Future BF3 fallback logic reads
 * this; BF2.1 uses it only for the UI ("Discovery · Free" for Hunter).
 *
 * NOT a plugin framework. NOT a runtime registry mutated by request
 * handlers. Purely a static, typed manifest.
 */

export type ProviderCapability =
  | "company_discovery"
  | "person_discovery"
  | "company_contact_discovery"
  | "personal_contact_reveal"
  | "email_enrichment"
  | "email_verification";

/**
 * `free` — the capability is free of provider charges under MDF's plan.
 * `paid` — the capability consumes provider credits/quota.
 * `unavailable` — the provider does not implement this capability at all.
 */
export type CapabilityCostClass = "free" | "paid" | "unavailable";

export type ProviderId = "hunter" | "public_website";

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  capabilities: Record<ProviderCapability, CapabilityCostClass>;
}

export const PROVIDER_DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  hunter: {
    id: "hunter",
    displayName: "Hunter",
    capabilities: {
      // BF2.1 — Hunter's `POST /v2/discover` is currently free of charge
      // (the 50-credit bucket applies to contact/email endpoints only).
      company_discovery: "free",
      // BF3A — Hunter Multi-Domain Search (masked) is free. Reveal is not.
      person_discovery: "free",
      company_contact_discovery: "unavailable",
      // BF3B — Multi-Domain Search reveal. Up to 1 Search credit per person.
      personal_contact_reveal: "paid",
      email_enrichment: "unavailable",
      email_verification: "unavailable",
    },
  },
  public_website: {
    id: "public_website",
    displayName: "Company website",
    capabilities: {
      company_discovery: "unavailable",
      person_discovery: "unavailable",
      company_contact_discovery: "free",
      personal_contact_reveal: "unavailable",
      email_enrichment: "unavailable",
      email_verification: "unavailable",
    },
  },
};

export function getProviderDescriptor(
  id: string,
): ProviderDescriptor | undefined {
  if (Object.hasOwn(PROVIDER_DESCRIPTORS, id)) {
    return PROVIDER_DESCRIPTORS[id as ProviderId];
  }
  return undefined;
}

export function providerHasCapability(
  id: ProviderId,
  capability: ProviderCapability,
): boolean {
  const cls = PROVIDER_DESCRIPTORS[id]?.capabilities[capability];
  return cls === "free" || cls === "paid";
}

/**
 * Provider-neutral outcome codes — the same shape every provider must
 * eventually map into. The current Hunter path translates
 * `HunterDiscoveryError` codes into these values so the future fallback
 * layer never has to know about Hunter-specific taxonomy.
 */
export type ProviderNeutralOutcome =
  | "success"
  | "no_result"
  | "quota_exhausted"
  | "rate_limited"
  | "temporarily_unavailable"
  | "invalid_request"
  | "not_configured";

/**
 * BF2.1 — map a Hunter error code to the provider-neutral vocabulary.
 * `unauthorized` collapses into `not_configured` because for MDF's
 * operator-facing perspective the fix is a configuration change.
 * `forbidden` (usage-limited) maps to `quota_exhausted`; a naive
 * `provider_unavailable` and `invalid_response` map to
 * `temporarily_unavailable`.
 */
export function hunterErrorCodeToOutcome(
  code:
    | "invalid_input"
    | "invalid_request"
    | "unauthorized"
    | "forbidden"
    | "rate_limited"
    | "provider_unavailable"
    | "timeout"
    | "invalid_response",
): ProviderNeutralOutcome {
  switch (code) {
    case "unauthorized":
      return "not_configured";
    case "forbidden":
      return "quota_exhausted";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
    case "provider_unavailable":
    case "invalid_response":
      return "temporarily_unavailable";
    case "invalid_request":
      return "invalid_request";
    case "invalid_input":
    default:
      return "invalid_request";
  }
}
