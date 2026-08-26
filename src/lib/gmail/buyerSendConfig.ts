import "server-only";

/**
 * Production safety gate for Buyer Send. Even after the full workflow
 * ships, real Gmail delivery to buyer.email is refused until this env
 * variable is explicitly set to "true" on the server (Vercel Production
 * environment, or local .env.local — never NEXT_PUBLIC).
 *
 * Enable ONLY after the internal QA batch (2–3 buyer records whose
 * emails are internal addresses we control) has been validated.
 */
export function isBuyerSendEnabled(): boolean {
  const v = process.env.BUYER_SEND_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Hard batch cap for the FIRST production version of Buyer Send. Any
 * request whose selected buyer list exceeds this size is rejected
 * server-side. Named so future phases can raise it deliberately.
 */
export const BUYER_SEND_BATCH_MAX = 10;
