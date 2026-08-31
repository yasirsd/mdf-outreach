import { afterEach, describe, expect, it } from "vitest";
import {
  hunterConfigured,
  hunterDiscoveryAvailability,
  hunterDiscoveryReady,
  hunterRevealAvailability,
  isBuyerFinderHunterConfigured,
  isBuyerFinderHunterEnrichmentEnabled,
  isBuyerFinderHunterReady,
  isBuyerFinderHunterRevealEnabled,
  isBuyerFinderHunterRevealReady,
  publicWebsiteAvailability,
  requireBuyerFinderHunterApiKey,
} from "./config";

const KEY = "BUYER_FINDER_HUNTER_API_KEY";
const ENABLED = "BUYER_FINDER_HUNTER_ENABLED";
const ENRICHMENT = "BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED";
const REVEAL = "BUYER_FINDER_HUNTER_REVEAL_ENABLED";
const PUBLIC_WEBSITE = "BUYER_FINDER_PUBLIC_WEBSITE_ENABLED";
const AUTO_FREE = "BUYER_FINDER_AUTO_FREE_ENRICHMENT_ENABLED";

const original = {
  key: process.env[KEY],
  enabled: process.env[ENABLED],
  enrichment: process.env[ENRICHMENT],
  reveal: process.env[REVEAL],
  publicWebsite: process.env[PUBLIC_WEBSITE],
  autoFree: process.env[AUTO_FREE],
};

afterEach(() => {
  restore(KEY, original.key);
  restore(ENABLED, original.enabled);
  restore(ENRICHMENT, original.enrichment);
  restore(REVEAL, original.reveal);
  restore(PUBLIC_WEBSITE, original.publicWebsite);
  restore(AUTO_FREE, original.autoFree);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Hunter credential readiness", () => {
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

describe("CFG1 Hunter free discovery — configured, not enabled", () => {
  it("API key present is ready without BUYER_FINDER_HUNTER_ENABLED", () => {
    process.env[KEY] = "sk-test";
    delete process.env[ENABLED];
    expect(isBuyerFinderHunterReady()).toBe(true);
    expect(hunterConfigured()).toBe(true);
    expect(hunterDiscoveryReady()).toBe(true);
    expect(hunterDiscoveryAvailability()).toBe("ready");
  });

  it("legacy BUYER_FINDER_HUNTER_ENABLED=false has no product effect when the key exists", () => {
    process.env[KEY] = "sk-test";
    process.env[ENABLED] = "false";
    expect(isBuyerFinderHunterReady()).toBe(true);
    expect(hunterDiscoveryAvailability()).toBe("ready");
  });

  it("key absent is not_configured even if a legacy enable flag is true", () => {
    delete process.env[KEY];
    process.env[ENABLED] = "true";
    expect(isBuyerFinderHunterReady()).toBe(false);
    expect(hunterDiscoveryAvailability()).toBe("not_configured");
  });

  it("never reports a disabled discovery state", () => {
    delete process.env[KEY];
    delete process.env[ENABLED];
    expect(hunterDiscoveryAvailability()).toBe("not_configured");
    process.env[KEY] = "sk-test";
    expect(hunterDiscoveryAvailability()).toBe("ready");
  });

  it("discovery ready does not enable enrichment or reveal", () => {
    process.env[KEY] = "sk-test";
    delete process.env[ENABLED];
    delete process.env[ENRICHMENT];
    delete process.env[REVEAL];
    expect(isBuyerFinderHunterReady()).toBe(true);
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    expect(isBuyerFinderHunterRevealEnabled()).toBe(false);
  });
});

describe("BF3B Hunter personal reveal runtime gate", () => {
  it("is false unless the env value is exactly 'true'", () => {
    delete process.env[REVEAL];
    expect(isBuyerFinderHunterRevealEnabled()).toBe(false);
    expect(hunterRevealAvailability()).toBe("disabled");
    for (const v of ["false", "FALSE", "0", "1", "yes", "TRUE", " true ", "on"]) {
      process.env[REVEAL] = v;
      expect(isBuyerFinderHunterRevealEnabled()).toBe(false);
    }
    process.env[REVEAL] = "true";
    process.env[KEY] = "sk-test";
    expect(isBuyerFinderHunterRevealEnabled()).toBe(true);
    expect(hunterRevealAvailability()).toBe("ready");
  });

  it("enrichment false does not block reveal readiness", () => {
    process.env[REVEAL] = "true";
    process.env[KEY] = "sk-test";
    process.env[ENRICHMENT] = "false";
    process.env[ENABLED] = "false";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    expect(isBuyerFinderHunterRevealReady()).toBe(true);
  });

  it("gate true + key absent is not_configured", () => {
    delete process.env[KEY];
    process.env[REVEAL] = "true";
    expect(isBuyerFinderHunterRevealReady()).toBe(false);
    expect(hunterRevealAvailability()).toBe("not_configured");
  });
});

describe("CFG1 public website always available", () => {
  it("is ready with no PUBLIC_WEBSITE_ENABLED set", () => {
    delete process.env[PUBLIC_WEBSITE];
    expect(publicWebsiteAvailability()).toBe("ready");
  });

  it("legacy BUYER_FINDER_PUBLIC_WEBSITE_ENABLED=false has no product effect", () => {
    process.env[PUBLIC_WEBSITE] = "false";
    expect(publicWebsiteAvailability()).toBe("ready");
  });

  it("is independent of Hunter credentials and paid gates", () => {
    process.env[PUBLIC_WEBSITE] = "false";
    process.env[ENABLED] = "false";
    process.env[ENRICHMENT] = "false";
    delete process.env[KEY];
    expect(publicWebsiteAvailability()).toBe("ready");
    expect(isBuyerFinderHunterReady()).toBe(false);
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
  });
});

describe("CFG1 automatic free enrichment — no env gate", () => {
  it("legacy AUTO_FREE_ENRICHMENT_ENABLED does not appear as a live helper", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(process.cwd(), "src/lib/buyerFinder/config.ts"), "utf8");
    expect(src).not.toContain("isBuyerFinderAutoFreeEnrichmentEnabled");
    expect(src).not.toContain("isBuyerFinderHunterEnabled");
    expect(src).not.toContain("isBuyerFinderPublicWebsiteEnabled");
  });

  it("does not open paid reveal or paid enrichment", () => {
    process.env[AUTO_FREE] = "true";
    delete process.env[REVEAL];
    delete process.env[ENRICHMENT];
    expect(isBuyerFinderHunterRevealEnabled()).toBe(false);
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
  });
});

describe("BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED lock", () => {
  it("is false unless the env value is exactly 'true'", () => {
    delete process.env[ENRICHMENT];
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    process.env[ENRICHMENT] = "false";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    process.env[ENRICHMENT] = "TRUE";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(false);
    process.env[ENRICHMENT] = "true";
    expect(isBuyerFinderHunterEnrichmentEnabled()).toBe(true);
  });
});
