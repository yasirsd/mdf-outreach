"use server";

import { revalidatePath } from "next/cache";
import { requireMdfSession } from "@/lib/auth/require";
import { serverRepositories } from "@/lib/repositories/server";
import {
  isBuyerFinderHunterRevealEnabled,
  isBuyerFinderHunterRevealReady,
  requireBuyerFinderHunterApiKey,
  HUNTER_REVEAL_DISABLED_MESSAGE,
  HUNTER_REVEAL_NOT_CONFIGURED_MESSAGE,
} from "@/lib/buyerFinder/config";
import { revealPersonalContactForCandidate } from "@/lib/buyerFinder/personalContactReveal";
import type { PersonalRevealSummary } from "@/lib/buyerFinder/personalContactReveal";
import { createHunterPersonalContactRevealProvider } from "@/lib/buyerFinder/providers/hunter/personalReveal";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function empty(outcome: PersonalRevealSummary["outcome"], message?: string): PersonalRevealSummary {
  return { outcome, message };
}

/**
 * BF3B — reveal ONE selected masked PERSONAL Hunter contact.
 *
 * Browser supplies contactId only. Server loads provider_ref from the
 * persisted contact. Does not create a Buyer, send Gmail, or mutate campaigns.
 */
export async function revealCandidatePersonalContactAction(
  contactId: string,
): Promise<PersonalRevealSummary> {
  await requireMdfSession();
  const id = (contactId ?? "").trim();
  if (!UUID_RE.test(id)) {
    return empty("invalid_input", "Invalid contact id.");
  }
  if (!isBuyerFinderHunterRevealEnabled()) {
    return empty("disabled", HUNTER_REVEAL_DISABLED_MESSAGE);
  }
  if (!isBuyerFinderHunterRevealReady()) {
    return empty("not_configured", HUNTER_REVEAL_NOT_CONFIGURED_MESSAGE);
  }

  const { repos } = await serverRepositories();
  const key = requireBuyerFinderHunterApiKey();
  const provider = createHunterPersonalContactRevealProvider({ apiKey: key });

  const result = await revealPersonalContactForCandidate({
    contactId: id,
    provider,
    repositories: {
      candidates: repos.buyerCandidates,
      contacts: repos.buyerCandidateContacts,
      productMatches: repos.buyerCandidateProductMatches,
      revealEvents: repos.buyerFinderContactRevealEvents,
    },
  });

  if (result.outcome === "success" && result.contact) {
    revalidatePath("/buyer-finder");
    revalidatePath(`/buyer-finder/candidate/${result.contact.candidateId}`);
  }

  return result;
}
