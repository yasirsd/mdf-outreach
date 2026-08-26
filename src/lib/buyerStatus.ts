import type { Buyer, BuyerStatus } from "@/lib/types";
import { BUYER_ADVANCED_STATUSES } from "@/lib/types";

/**
 * Buyer status transition rule for a successful Buyer Send.
 *
 * NEVER downgrade an advanced sales state (replied / interested /
 * quotation-sent / negotiating / converted / not-interested). Otherwise
 * an early state (new / qualified / ready) becomes "contacted".
 *
 * Returns null when the buyer should NOT have their status changed.
 */
export function nextStatusAfterSuccessfulSend(current: BuyerStatus): BuyerStatus | null {
  if (BUYER_ADVANCED_STATUSES.includes(current)) return null;
  if (current === "contacted") return null;
  return "contacted";
}

/**
 * Compute the patch to apply to a buyer after a successful production
 * send. Returns null when nothing should change.
 */
export function buyerPatchAfterSuccessfulSend(
  buyer: Pick<Buyer, "status">,
  successfulSendAt: string,
): Partial<Buyer> | null {
  const nextStatus = nextStatusAfterSuccessfulSend(buyer.status);
  const patch: Partial<Buyer> = { lastContactedAt: successfulSendAt };
  if (nextStatus) patch.status = nextStatus;
  return patch;
}
