/**
 * Client-safe contact shape. `providerRef` (Hunter reveal_handle) is
 * server-only identity for a future BF3B reveal action that will accept
 * contactId, never the handle itself.
 */

import type { BuyerCandidateContact } from "./types";

export type SafeBuyerCandidateContact = Omit<BuyerCandidateContact, "providerRef">;

export function toSafeContact(contact: BuyerCandidateContact): SafeBuyerCandidateContact {
  const { providerRef: _serverOnly, ...safe } = contact;
  return safe;
}

export function toSafeContacts(contacts: BuyerCandidateContact[]): SafeBuyerCandidateContact[] {
  return contacts.map(toSafeContact);
}

export function contactContainsProviderRef(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "object") return false;
  return Object.prototype.hasOwnProperty.call(value, "providerRef");
}
