import type { ProviderNeutralOutcome } from "./providers/descriptors";
import { hunterErrorCodeToOutcome } from "./providers/descriptors";
import type { SearchRunStage } from "./searchRun";
import { INTERRUPTED_ERROR_CODE } from "./searchRun";

/**
 * Operator-facing copy. Internal stage / status names never appear in
 * the UI as-is.
 */

export const STAGE_LABEL: Record<SearchRunStage, string> = {
  preparing: "Preparing search",
  discovering: "Finding companies",
  processing_candidates: "Processing potential buyers",
  finalizing: "Preparing results",
  complete: "Search complete",
};

/** Step title used in the progress list (discovering is provider-led). */
export function discoveringStepTitle(providerDisplayName: string): string {
  return `Searching ${providerDisplayName} Discover`;
}

export function providerOutcomeLabel(outcome: ProviderNeutralOutcome | null | undefined): string {
  switch (outcome) {
    case "success":
      return "Completed";
    case "no_result":
      return "No companies found";
    case "quota_exhausted":
      return "Usage limited";
    case "rate_limited":
      return "Temporarily rate limited";
    case "temporarily_unavailable":
      return "Temporarily unavailable";
    case "invalid_request":
      return "Request rejected";
    case "not_configured":
      return "Needs configuration";
    default:
      return "—";
  }
}

export function providerOutcomeMessage(
  outcome: ProviderNeutralOutcome,
  providerDisplayName = "Hunter",
): string {
  switch (outcome) {
    case "rate_limited":
      return `${providerDisplayName} is temporarily rate limited.`;
    case "temporarily_unavailable":
      return `${providerDisplayName} is temporarily unavailable.`;
    case "not_configured":
      return `${providerDisplayName} configuration needs attention.`;
    case "quota_exhausted":
      return `${providerDisplayName} refused this request.`;
    case "invalid_request":
      return "Search parameters were rejected.";
    case "no_result":
      return "No usable companies were found.";
    case "success":
      return "";
  }
}

const HUNTER_CODE_MESSAGES: Record<string, string> = {
  unauthorized: "Hunter configuration needs attention.",
  forbidden: "Hunter refused this request.",
  rate_limited: "Hunter is temporarily rate limited.",
  timeout: "Hunter did not respond in time.",
  provider_unavailable: "Hunter is temporarily unavailable.",
  invalid_request: "Search parameters were rejected by Hunter.",
  invalid_response: "Hunter returned an unexpected response.",
  invalid_input: "Search parameters were invalid.",
};

export function hunterCodeToSafeMessage(code: string | undefined): string {
  if (!code) return "Hunter is temporarily unavailable.";
  if (code === INTERRUPTED_ERROR_CODE) {
    return "The previous search stopped updating.";
  }
  return HUNTER_CODE_MESSAGES[code] ?? providerOutcomeMessage(mapUnknownCodeToOutcome(code));
}

export function mapUnknownCodeToOutcome(code: string | undefined): ProviderNeutralOutcome {
  if (!code) return "temporarily_unavailable";
  switch (code) {
    case "unauthorized":
    case "forbidden":
    case "rate_limited":
    case "timeout":
    case "provider_unavailable":
    case "invalid_response":
    case "invalid_request":
    case "invalid_input":
      return hunterErrorCodeToOutcome(code);
    case "not_configured":
      return "not_configured";
    default:
      return "temporarily_unavailable";
  }
}

export const INTERRUPTED_MESSAGE = "The previous search stopped updating.";
export const ALREADY_RUNNING_MESSAGE = "A Buyer Finder search is already running.";
