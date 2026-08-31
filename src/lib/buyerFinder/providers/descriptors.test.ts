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

  it("Hunter advertises person discovery as FREE (masked Multi-Domain Search)", () => {
    expect(PROVIDER_DESCRIPTORS.hunter.capabilities.person_discovery).toBe("free");
    expect(providerHasCapability("hunter", "person_discovery")).toBe(true);
  });

  it("Hunter advertises personal contact reveal as PAID and email enrichment as unavailable", () => {
    expect(PROVIDER_DESCRIPTORS.hunter.capabilities.personal_contact_reveal).toBe("paid");
    expect(providerHasCapability("hunter", "personal_contact_reveal")).toBe(true);
    expect(PROVIDER_DESCRIPTORS.hunter.capabilities.email_enrichment).toBe("unavailable");
    expect(providerHasCapability("hunter", "email_enrichment")).toBe(false);
  });

  it("Hunter does NOT currently advertise email verification or company-website contacts", () => {
    for (const cap of ["email_verification", "company_contact_discovery"] as const) {
      expect(PROVIDER_DESCRIPTORS.hunter.capabilities[cap]).toBe("unavailable");
      expect(providerHasCapability("hunter", cap)).toBe(false);
    }
  });

  it("Company website advertises free company_contact_discovery only", () => {
    expect(PROVIDER_DESCRIPTORS.public_website.displayName).toBe("Company website");
    expect(PROVIDER_DESCRIPTORS.public_website.capabilities.company_contact_discovery).toBe("free");
    expect(providerHasCapability("public_website", "company_contact_discovery")).toBe(true);
    expect(providerHasCapability("public_website", "company_discovery")).toBe(false);
    expect(providerHasCapability("public_website", "person_discovery")).toBe(false);
    expect(providerHasCapability("public_website", "personal_contact_reveal")).toBe(false);
    expect(providerHasCapability("public_website", "email_enrichment")).toBe(false);
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
