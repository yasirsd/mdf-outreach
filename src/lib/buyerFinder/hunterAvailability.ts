/**
 * Safe, client-shareable Hunter discovery availability.
 *
 * Env is never read here. Server config maps env → this union and
 * passes only the enum to the browser. No API key, no raw env values.
 *
 * Free discovery has no operator enable switch. The only non-ready
 * state is missing credentials.
 */

export type HunterDiscoveryAvailability = "not_configured" | "ready";

/** Operator-facing footer when the API key is missing. */
export const HUNTER_NOT_CONFIGURED_FOOTER = "Hunter is not configured on this server.";

/** Operator-facing footer when discovery is ready to run. */
export const HUNTER_DISCOVER_FREE_FOOTER = "Hunter Discover is free — no credits consumed.";

export const HUNTER_NOT_CONFIGURED_MESSAGE =
  "Hunter is not configured on this server. Contact MDF admin.";
