import "server-only";

/**
 * BF2 — Buyer Finder server-only configuration.
 *
 * Reads env values at request time, never at import time (module import
 * happens on the server; still no reason to freeze the value into a
 * closure that could be captured by a fixture).
 *
 * The API key must never:
 *   • enter React props / state
 *   • appear in HTML sent to the browser
 *   • appear in error messages returned to the browser
 *   • be logged
 *
 * See `HunterCompanyDiscoveryProvider`'s `redactSecret` — any error
 * thrown by the provider is redacted of the key value BEFORE it is
 * translated into a UI-safe message by the server action.
 *
 * Runtime gates (strict):
 *   BUYER_FINDER_HUNTER_ENABLED === "true"
 *     → company discovery + usage may run (if the key is also present)
 *   anything else (unset, "false", "FALSE", "0", …)
 *     → no Hunter Usage or Discover request may leave the server
 *   BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED === "true"
 *     → contact/email/verification (not implemented; remains locked)
 *
 * Discovery-enabled does NOT imply enrichment-enabled.
 */

import type { HunterDiscoveryAvailability } from "./hunterAvailability";
import {
  HUNTER_DISCOVERY_DISABLED_MESSAGE,
  HUNTER_NOT_CONFIGURED_MESSAGE,
} from "./hunterAvailability";

export {
  HUNTER_DISCOVERY_DISABLED_MESSAGE,
  HUNTER_NOT_CONFIGURED_MESSAGE,
  type HunterDiscoveryAvailability,
};

const ENV_HUNTER_KEY = "BUYER_FINDER_HUNTER_API_KEY";
const ENV_HUNTER_ENABLED = "BUYER_FINDER_HUNTER_ENABLED";
const ENV_HUNTER_ENRICHMENT = "BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED";

function envIsExactTrue(name: string): boolean {
  return process.env[name] === "true";
}

/**
 * Runtime discovery gate. Only the exact string `"true"` opens it.
 * `"TRUE"`, `"1"`, `"false"`, empty, and unset are all disabled.
 */
export function isBuyerFinderHunterEnabled(): boolean {
  return envIsExactTrue(ENV_HUNTER_ENABLED);
}

/**
 * Independent enrichment gate. Discovery-enabled must not imply this.
 * Production paths must not consult this to attach contact providers.
 */
export function isBuyerFinderHunterEnrichmentEnabled(): boolean {
  return envIsExactTrue(ENV_HUNTER_ENRICHMENT);
}

/**
 * Returns whether a Hunter API key is present. Does NOT mean discovery
 * may run — also require `isBuyerFinderHunterEnabled()`.
 */
export function isBuyerFinderHunterConfigured(): boolean {
  const key = (process.env[ENV_HUNTER_KEY] ?? "").trim();
  return key.length > 0;
}

/** Gate on AND key present. The only condition under which Hunter network I/O is allowed. */
export function isBuyerFinderHunterReady(): boolean {
  return isBuyerFinderHunterEnabled() && isBuyerFinderHunterConfigured();
}

/** Safe three-state for the Buyer Finder page. Never includes the key. */
export function hunterDiscoveryAvailability(): HunterDiscoveryAvailability {
  if (!isBuyerFinderHunterEnabled()) return "disabled";
  if (!isBuyerFinderHunterConfigured()) return "not_configured";
  return "ready";
}

/**
 * Returns the raw Hunter API key. THROWS if missing. Callers MUST be
 * inside a `"use server"` server action or a server component and MUST
 * NEVER pass the returned value back to the browser, into an error
 * response, or into a log. Prefer `isBuyerFinderHunterReady` before
 * calling this; only call immediately before instantiating
 * `HunterCompanyDiscoveryProvider` / `HunterUsageProvider`.
 */
export function requireBuyerFinderHunterApiKey(): string {
  const key = (process.env[ENV_HUNTER_KEY] ?? "").trim();
  if (!key) {
    throw new Error(HUNTER_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}
