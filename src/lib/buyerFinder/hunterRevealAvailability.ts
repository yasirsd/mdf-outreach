/**
 * Safe, client-shareable Hunter personal-reveal availability.
 *
 * Env is never read here. Server config maps env → this union and
 * passes only the enum to the browser. No API key, no raw env values.
 * No NEXT_PUBLIC reveal gate.
 */

export type HunterRevealAvailability = "disabled" | "not_configured" | "ready";

export const HUNTER_REVEAL_DISABLED_MESSAGE =
  "Hunter personal contact reveal is disabled on this server.";

export const HUNTER_REVEAL_NOT_CONFIGURED_MESSAGE =
  "Hunter is not configured on this server. Contact MDF admin.";
