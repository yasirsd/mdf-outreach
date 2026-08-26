/**
 * Failure classification for Buyer Send.
 *
 * "safe-to-retry" ⇒ we KNOW Gmail was not called, or Gmail definitely
 * rejected the request before delivery. A subsequent retry cannot cause
 * a duplicate email.
 *
 * "review-required" ⇒ we CANNOT prove that Gmail did not deliver. Never
 * automatically retry. The audit row remains; an operator must decide
 * out-of-band whether to attempt again.
 *
 * The classifier operates on the audit record only — no live Gmail
 * calls — so it is safe to call from any UI code that reads
 * email_send_events.
 */

export type FailureRetryability = "safe-to-retry" | "review-required" | "already-sent";

/**
 * Human-readable label used in the recipient review + send-history UI.
 */
export function retryLabel(r: FailureRetryability): string {
  if (r === "safe-to-retry") return "Safe to retry";
  if (r === "review-required") return "Review required";
  return "Already sent";
}

/**
 * Given a failure error message (persisted in email_send_events.error),
 * decide whether a retry is safe. This is a conservative classifier —
 * anything ambiguous is REVIEW_REQUIRED.
 *
 * The message patterns are the ones sendBuyersAction emits.
 */
export function classifyFailure(error: string | null | undefined): FailureRetryability {
  const msg = (error ?? "").toLowerCase();

  // Safe: refusals that clearly happened before the Gmail HTTP send.
  if (!msg) return "review-required";
  if (/^buyer[- ]send is not enabled/.test(msg)) return "safe-to-retry";
  if (/buyer_send_enabled/.test(msg)) return "safe-to-retry";
  if (/do not contact/.test(msg)) return "safe-to-retry";
  if (/no valid email/.test(msg)) return "safe-to-retry";
  if (/not part of this campaign/.test(msg)) return "safe-to-retry";
  if (/no longer exists/.test(msg)) return "safe-to-retry";
  if (/gmail is not connected/.test(msg)) return "safe-to-retry";
  if (/reconnect gmail/.test(msg)) return "safe-to-retry";
  if (/refuse.*gmail.*refresh|refresh the gmail access token/.test(msg)) return "safe-to-retry";
  if (/^subject is empty/.test(msg)) return "safe-to-retry";
  if (/required asset .* is not uploaded/.test(msg)) return "safe-to-retry";
  if (/has no hosted production url/.test(msg)) return "safe-to-retry";
  if (/is not promoted to production/.test(msg)) return "safe-to-retry";
  if (/is missing alt text/.test(msg)) return "safe-to-retry";
  if (/unresolved personalization/.test(msg)) return "safe-to-retry";
  if (/base64 image/.test(msg)) return "safe-to-retry";
  if (/rendered html is empty/.test(msg)) return "safe-to-retry";
  if (/plain-text alternative is empty/.test(msg)) return "safe-to-retry";
  if (/recipient email is invalid/.test(msg)) return "safe-to-retry";
  if (/campaign has no template snapshot/.test(msg)) return "safe-to-retry";
  if (/^another send for this buyer is already in flight/.test(msg)) {
    return "safe-to-retry";
  }
  if (/^this send was already submitted/.test(msg)) return "safe-to-retry";

  // Definite Gmail rejections (Gmail rejected structurally — no delivery).
  // The current sendClient wraps these in GmailApiError with a fixed prefix:
  //   "Gmail rejected the message. No buyer was contacted."
  if (/gmail rejected the message.*no buyer was contacted/.test(msg)) {
    return "safe-to-retry";
  }

  // Everything else — including bare "Gmail rejected" without the safety
  // suffix, timeouts, unknown network errors, or audit-conflict rows —
  // MUST be treated as ambiguous. Never automated retry.
  return "review-required";
}
