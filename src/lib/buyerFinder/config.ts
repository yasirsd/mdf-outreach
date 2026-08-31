import "server-only";

/**
 * Buyer Finder server-only configuration.
 *
 * Reads env values at request time, never at import time.
 *
 * The API key must never:
 *   • enter React props / state
 *   • appear in HTML sent to the browser
 *   • appear in error messages returned to the browser
 *   • be logged
 *
 * Credential vs permission:
 *   BUYER_FINDER_HUNTER_API_KEY present
 *     → Hunter free discovery / masked people / usage CONFIGURED (ready)
 *   key absent
 *     → Hunter NOT CONFIGURED
 *
 * Runtime gates that remain (strict exact `"true"` only):
 *   BUYER_FINDER_HUNTER_REVEAL_ENABLED === "true"
 *     → explicit confirmed personal Multi-Domain reveal MAY run
 *     (consumes Search credits; default false)
 *   BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED === "true"
 *     → legacy Domain Search / Email Finder (not implemented; remains locked)
 *     NOT the Multi-Domain reveal gate. Production free paths must not
 *     consult this to attach contact providers.
 *
 * Verified-free operations are always-on when technically ready:
 *   public website contacts — crawler always available
 *   Hunter company Discover — when API key present
 *   Hunter masked people — when API key present
 *   automatic free enrichment — when due jobs exist
 *
 * Removed CFG1 (no product effect if still set in a local env file):
 *   BUYER_FINDER_HUNTER_ENABLED
 *   BUYER_FINDER_PUBLIC_WEBSITE_ENABLED
 *   BUYER_FINDER_AUTO_FREE_ENRICHMENT_ENABLED
 *
 * Discovery-ready does NOT imply enrichment-enabled or reveal-enabled.
 * Enrichment-disabled does NOT block free masked person discovery.
 * Enrichment-disabled does NOT block dedicated Multi-Domain reveal.
 * Reveal-disabled does NOT block free masked person discovery.
 */

import type { HunterDiscoveryAvailability } from "./hunterAvailability";
import { HUNTER_NOT_CONFIGURED_MESSAGE } from "./hunterAvailability";
import type { PublicWebsiteAvailability } from "./publicWebsiteAvailability";
import type { HunterRevealAvailability } from "./hunterRevealAvailability";
import {
  HUNTER_REVEAL_DISABLED_MESSAGE,
  HUNTER_REVEAL_NOT_CONFIGURED_MESSAGE,
} from "./hunterRevealAvailability";

export {
  HUNTER_NOT_CONFIGURED_MESSAGE,
  HUNTER_REVEAL_DISABLED_MESSAGE,
  HUNTER_REVEAL_NOT_CONFIGURED_MESSAGE,
  type HunterDiscoveryAvailability,
  type HunterRevealAvailability,
  type PublicWebsiteAvailability,
};

const ENV_HUNTER_KEY = "BUYER_FINDER_HUNTER_API_KEY";
const ENV_HUNTER_ENRICHMENT = "BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED";
const ENV_HUNTER_REVEAL = "BUYER_FINDER_HUNTER_REVEAL_ENABLED";

function envIsExactTrue(name: string): boolean {
  return process.env[name] === "true";
}

/**
 * Independent enrichment lock. Discovery-ready must not imply this.
 * Production paths must not consult this to attach contact providers.
 * This is NOT the Multi-Domain personal reveal gate.
 *
 * Kept gated because Domain Search / Email Finder would consume credits
 * if those unimplemented paths were ever attached.
 */
export function isBuyerFinderHunterEnrichmentEnabled(): boolean {
  return envIsExactTrue(ENV_HUNTER_ENRICHMENT);
}

/**
 * Dedicated Multi-Domain personal reveal gate. Only the exact string
 * `"true"` opens it. Independent of discovery readiness and enrichment.
 */
export function isBuyerFinderHunterRevealEnabled(): boolean {
  return envIsExactTrue(ENV_HUNTER_REVEAL);
}

/** Reveal gate on AND Hunter API key present. */
export function isBuyerFinderHunterRevealReady(): boolean {
  return isBuyerFinderHunterRevealEnabled() && isBuyerFinderHunterConfigured();
}

/** Safe three-state for the Buyer Finder UI. Never includes the key. */
export function hunterRevealAvailability(): HunterRevealAvailability {
  if (!isBuyerFinderHunterRevealEnabled()) return "disabled";
  if (!isBuyerFinderHunterConfigured()) return "not_configured";
  return "ready";
}

/**
 * Returns whether a Hunter API key is present.
 * This is credential readiness, not a feature-enable switch.
 */
export function isBuyerFinderHunterConfigured(): boolean {
  const key = (process.env[ENV_HUNTER_KEY] ?? "").trim();
  return key.length > 0;
}

/**
 * Free Hunter discovery / masked people / usage may run.
 * Equivalent to API-key presence. No boolean enable flag.
 */
export function isBuyerFinderHunterReady(): boolean {
  return isBuyerFinderHunterConfigured();
}

/** Alias of `isBuyerFinderHunterConfigured` — credential, not permission. */
export function hunterConfigured(): boolean {
  return isBuyerFinderHunterConfigured();
}

/** Alias of `isBuyerFinderHunterReady` for free Discover + masked people. */
export function hunterDiscoveryReady(): boolean {
  return isBuyerFinderHunterReady();
}

/** Safe two-state for the Buyer Finder page. Never includes the key. */
export function hunterDiscoveryAvailability(): HunterDiscoveryAvailability {
  return isBuyerFinderHunterConfigured() ? "ready" : "not_configured";
}

/**
 * Returns the raw Hunter API key. THROWS if missing. Callers MUST be
 * inside a `"use server"` server action or a server component and MUST
 * NEVER pass the returned value back to the browser, into an error
 * response, or into a log. Prefer `isBuyerFinderHunterReady` before
 * calling this; only call immediately before instantiating
 * `HunterCompanyDiscoveryProvider` / `HunterUsageProvider` /
 * `HunterPersonDiscoveryProvider` / `HunterPersonalContactRevealProvider`.
 */
export function requireBuyerFinderHunterApiKey(): string {
  const key = (process.env[ENV_HUNTER_KEY] ?? "").trim();
  if (!key) {
    throw new Error(HUNTER_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}

/**
 * Public website contact research is always technically available.
 * There is no environment enable switch. Crawler security is unchanged.
 */
export function publicWebsiteAvailability(): PublicWebsiteAvailability {
  return "ready";
}
