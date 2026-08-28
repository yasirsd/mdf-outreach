import { afterEach, describe, expect, it } from "vitest";
import {
  hunterDiscoveryAvailability,
  isBuyerFinderHunterConfigured,
  isBuyerFinderHunterEnabled,
  isBuyerFinderHunterEnrichmentEnabled,
  isBuyerFinderHunterReady,
  requireBuyerFinderHunterApiKey,
} from "./config";

const KEY = "BUYER_FINDER_HUNTER_API_KEY";
const ENABLED = "BUYER_FINDER_HUNTER_ENABLED";
const ENRICHMENT = "BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED";

const original = {
  key: process.env[KEY],
  enabled: process.env[ENABLED],
  enrichment: process.env[ENRICHMENT],
};

afterEach(() => {
  restore(KEY, original.key);
  restore(ENABLED, original.enabled);
  restore(ENRICHMENT, original.enrichment);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("BF2 Hunter server-only config", () => {
  it("isBuyerFinderHunterConfigured returns false when unset / empty", () => {
    delete process.env[KEY];
    expect(isBuyerFinderHunterConfigured()).toBe(false);
    process.env[KEY] = "";
    expect(isBuyerFinderHunterConfigured()).toBe(false);
    process.env[KEY] = "   ";
    expect(isBuyerFinderHunterConfigured()).toBe(false);
  });

  it("isBuyerFinderHunterConfigured returns true when the env value has content", () => {
    process.env[KEY] = "sk-test";
    expect(isBuyerFinderHunterConfigured()).toBe(true);
  });

  it("requireBuyerFinderHunterApiKey throws a safe error when unset", () => {
    delete process.env[KEY];
    expect(() => requireBuyerFinderHunterApiKey()).toThrow(/not configured/i);
  });

  it("requireBuyerFinderHunterApiKey returns the raw trimmed key when set", () => {
    process.env[KEY] = "   sk-abc123   ";
    expect(requireBuyerFinderHunterApiKey()).toBe("sk-abc123");
  });
});

describe("BF2.2B Hunter runtime gate", () => {
  it("enabled is false unless the env value is exactly 'true'", () => {
    delete process.env[ENABLED];
    expect(isBuyerFinderHunterEnabled()).toBe(false);
    for (const v of ["false", "FALSE", "0", "1", "yes", "TRUE", " true ", "on"]) {
      process.env[ENABLED] = v;
      expect(isBuyerFinderHunterEnabled()).toBe(false);
    }
    process.env[ENABLED] = "true";
    expect(isBuyerFinderHunterEnabled()).toBe(true);
  });

  it("key present does not make discovery ready when the gate is off", () => {
    process.env[KEY] = "sk-test";
    process.env[ENABLED] = "false";
    expect(isBuyerFinderHunterConfigured()).toBe(true);
    expect(isBuyerFinderHunterEnabled()).toBe(false);
    expect(isBuyerFinderHunterReady()).toBe(false);
    expect(hunterDiscoveryAvailability()).toBe("disabled");
  });

  it("gate true + key absent is not_configured", () => {
    delete process.env[KEY];
    process.env[ENABLED] = "true";
    expect(isBuyerFinderHunterEnabled()).toBe(true);
    expect(isBuyerFinderHunterConfigured()).toBe(false);
    expect(isBuyerFinderHunterReady()).toBe(false);
    expect(hunterDiscoveryAvailability()).toBe("not_configured");
  });

  it("gate true + key present is ready", () => {
    process.env[KEY] = "sk-test";
    process.env[ENABLED] = "true";
    expect(isBuyerFinderHunterReady()).toBe(true);
    expect(hunterDiscoveryAvailability()).toBe("ready");
  });

  it("discovery enabled does not enable enrichment", () => {
    process.env[ENABLED] = "true";
    process.env[KEY] = "sk-test";
    delete process.env[ENRICHMENT];
    expect(isBuyerFinderHunterReady()).toBe(true);
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    process.env[ENRICHMENT] = "false";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    process.env[ENRICHMENT] = "TRUE";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    process.env[ENRICHMENT] = "true";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(true);
  });
});
