import { isValidEmail } from "@/lib/utils";

export const BUYER_EMAIL_REQUIRED_MESSAGE =
  "Buyer email is required and must be a valid email address.";

/**
 * Canonical Buyer email normalization. Validation deliberately delegates to
 * the project's existing `isValidEmail` convention so UI, CSV, server actions,
 * repositories, and Buyer Finder conversion do not drift apart.
 */
export function normalizeValidBuyerEmail(
  value: string | null | undefined,
): string | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  return isValidEmail(normalized) ? normalized : undefined;
}

/** Reject missing, whitespace-only, and structurally unusable Buyer emails. */
export function requireValidBuyerEmail(value: string | null | undefined): string {
  const normalized = normalizeValidBuyerEmail(value);
  if (!normalized) throw new Error(BUYER_EMAIL_REQUIRED_MESSAGE);
  return normalized;
}
