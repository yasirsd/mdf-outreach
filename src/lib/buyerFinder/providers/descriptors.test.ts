import { describe, expect, it } from "vitest";
import {
  hunterErrorCodeToOutcome,
  getProviderDescriptor,
  PROVIDER_DESCRIPTORS,
  providerHasCapability,
  type ProviderNeutralOutcome,
} from "./descriptors";

describe("BF2.1 provider descriptor", () => {
  it("Hunter advertises company discovery as FREE", () => {
    expect(PROVIDER_DESCRIPTORS.hunter.capabilities.company_discovery).toBe("free");
    expect(providerHasCapability("hunter", "company_discovery")).toBe(true);
    expect(getProviderDescriptor("hunter")?.displayName).toBe("Hunter");
    expect(getProviderDescriptor("unknown")).toBeUndefined();
  });

  it("Hunter does NOT currently advertise contact or email capabilities", () => {
    for (const cap of ["person_discovery", "email_enrichment", "email_verification"] as const) {
      expect(PROVIDER_DESCRIPTORS.hunter.capabilities[cap]).toBe("unavailable");
      expect(providerHasCapability("hunter", cap)).toBe(false);
    }
  });
});

describe("BF2.1 hunterErrorCodeToOutcome — provider-neutral mapping", () => {
  const cases: Array<[
    Parameters<typeof hunterErrorCodeToOutcome>[0],
    ProviderNeutralOutcome,
  ]> = [
    ["unauthorized", "not_configured"],
    ["forbidden", "quota_exhausted"],
    ["rate_limited", "rate_limited"],
    ["timeout", "temporarily_unavailable"],
    ["provider_unavailable", "temporarily_unavailable"],
    ["invalid_response", "temporarily_unavailable"],
    ["invalid_request", "invalid_request"],
    ["invalid_input", "invalid_request"],
  ];
  it.each(cases)("maps %s → %s", (code, expected) => {
    expect(hunterErrorCodeToOutcome(code)).toBe(expected);
  });
});
