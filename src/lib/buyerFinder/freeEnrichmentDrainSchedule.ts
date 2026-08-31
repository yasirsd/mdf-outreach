/**
 * Client-safe drain cadence for FreeEnrichmentAutopump.
 *
 * The durable Postgres queue is the source of truth. This only
 * chooses the next POST interval so idle workspaces do not hammer
 * /api/buyer-finder/free-enrichment/drain every few seconds.
 */

export const DRAIN_ACTIVE_MS = 2_500;
export const DRAIN_IDLE_MS = 20_000;
export const DRAIN_HIDDEN_ACTIVE_MS = 8_000;
export const DRAIN_HIDDEN_IDLE_MS = 60_000;

/** Next delay after a drain response. `claimed === 0` enters calm idle. */
export function nextDrainDelayMs(claimed: number, hidden: boolean): number {
  if (claimed > 0) return hidden ? DRAIN_HIDDEN_ACTIVE_MS : DRAIN_ACTIVE_MS;
  return hidden ? DRAIN_HIDDEN_IDLE_MS : DRAIN_IDLE_MS;
}
