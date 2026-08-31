/**
 * Safe, client-shareable public-website contact lookup availability.
 *
 * Env is never read here. Public website research is always-on;
 * crawler security is independent of this type.
 */

export type PublicWebsiteAvailability = "ready";
