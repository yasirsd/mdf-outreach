/**
 * Safe, client-shareable Hunter discovery availability.
 *
 * Env is never read here. Server config maps env → this union and
 * passes only the enum to the browser. No API key, no raw env values.
 */

export type HunterDiscoveryAvailability = "disabled" | "not_configured" | "ready";

/** Operator-facing footer when the runtime gate is off. */
export const HUNTER_DISCOVERY_DISABLED_FOOTER = "Hunter company discovery is disabled.";

/** Operator-facing footer when the gate is on but the key is missing. */
export const HUNTER_NOT_CONFIGURED_FOOTER = "Hunter is not configured on this server.";

/** Operator-facing footer when discovery is ready to run. */
export const HUNTER_DISCOVER_FREE_FOOTER = "Hunter Discover is free — no credits consumed.";

/** Server-action / execute-route message. Never includes env names or values. */
export const HUNTER_DISCOVERY_DISABLED_MESSAGE =
  "Hunter company discovery is disabled on this server.";

export const HUNTER_NOT_CONFIGURED_MESSAGE =
  "Hunter is not configured on this server. Contact MDF admin.";
