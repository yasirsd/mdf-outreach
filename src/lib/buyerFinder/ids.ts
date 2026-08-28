/**
 * Buyer Finder persistence identity.
 *
 * Database primary keys (migration 0010 / 0013) are Postgres UUIDs.
 * Company-dedupe identity is separate (normalized domain, company+country).
 * Never derive a row UUID from a domain or company name.
 */

export const ENTITY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEntityUuid(value: string): boolean {
  return typeof value === "string" && ENTITY_UUID_RE.test(value);
}

/** Caller-provided UUID for repository create contracts (option B). */
export function newEntityId(): string {
  return globalThis.crypto.randomUUID();
}
