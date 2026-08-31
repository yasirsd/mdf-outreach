import "server-only";

import { blankToUndefined, normalizeDomain } from "@/lib/buyerFinder/normalize";
import { sanitizeLinkedinProfileUrl } from "@/lib/buyerFinder/linkedinUrl";
import { sanitizePhoneNumber } from "@/lib/buyerFinder/phoneNumber";
import type {
  PersonalContactRevealProvider,
  PersonalContactRevealRequest,
  PersonalContactRevealResult,
  PersonalRevealHandleOutcome,
  RevealedPersonalContactDetails,
} from "../types";
import { HunterDiscoveryError, hunterErrorFromHttpStatus, redactSecret } from "./errors";

export const HUNTER_MULTI_DOMAIN_REVEAL_URL = "https://api.hunter.io/v2/multi-domain-search/reveal";
export const HUNTER_PERSONAL_REVEAL_MAX_CREDITS = 1;

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HunterPersonalRevealOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function assertApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) {
    throw new HunterDiscoveryError("invalid_input", "Hunter API key is required.");
  }
  return key;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function asEmailType(value: unknown): "personal" | "generic" | undefined {
  if (value === "personal" || value === "generic") return value;
  return undefined;
}

function asHandleOutcome(value: unknown): PersonalRevealHandleOutcome | undefined {
  if (
    value === "revealed" ||
    value === "already_revealed" ||
    value === "not_found" ||
    value === "insufficient_credits"
  ) {
    return value;
  }
  return undefined;
}

function parseCreditsCharged(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hunterErrorsMentionInsufficient(body: unknown): boolean {
  const rec = recordOf(body);
  const errors = rec?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((item) => {
    const row = recordOf(item);
    const id = typeof row?.id === "string" ? row.id : "";
    const details = typeof row?.details === "string" ? row.details : "";
    return /insufficient/i.test(id) || /insufficient/i.test(details);
  });
}

function mapPerson(raw: unknown): RevealedPersonalContactDetails | undefined {
  const rec = recordOf(raw);
  if (!rec) return undefined;
  const email = blankToUndefined(typeof rec.email === "string" ? rec.email : undefined);
  const firstName = blankToUndefined(typeof rec.first_name === "string" ? rec.first_name : undefined);
  const lastName = blankToUndefined(typeof rec.last_name === "string" ? rec.last_name : undefined);
  const position = blankToUndefined(typeof rec.position === "string" ? rec.position : undefined);
  const domain = normalizeDomain(typeof rec.domain === "string" ? rec.domain : undefined);
  const phoneNumber = sanitizePhoneNumber(typeof rec.phone_number === "string" ? rec.phone_number : undefined);
  const linkedinUrl = sanitizeLinkedinProfileUrl(
    typeof rec.linkedin_url === "string" ? rec.linkedin_url : undefined,
  );
  return {
    firstName,
    lastName,
    position,
    email,
    phoneNumber,
    linkedinUrl,
    type: asEmailType(rec.type),
    domain,
  };
}

function parseOkBody(parsed: unknown, requestedHandle: string): PersonalContactRevealResult {
  const rec = recordOf(parsed);
  if (!rec) {
    return { outcome: "invalid_response", creditsCharged: null };
  }

  const meta = recordOf(rec.meta);
  const creditsCharged = parseCreditsCharged(meta?.credits_charged);
  const handles = Array.isArray(meta?.handles) ? meta.handles : [];
  const handleRow = recordOf(handles[0]);
  const returnedHandle =
    blankToUndefined(typeof handleRow?.handle === "string" ? handleRow.handle : undefined) ??
    undefined;
  const metaOutcome = asHandleOutcome(handleRow?.outcome);

  const data = Array.isArray(rec.data) ? rec.data : [];
  const dataRow = recordOf(data[0]);
  const dataHandle = blankToUndefined(
    typeof dataRow?.reveal_handle === "string" ? dataRow.reveal_handle : undefined,
  );
  const dataOutcome = asHandleOutcome(dataRow?.outcome);
  const handleOutcome = metaOutcome ?? dataOutcome;

  if (returnedHandle && returnedHandle !== requestedHandle) {
    return { outcome: "invalid_response", creditsCharged, handleOutcome };
  }
  if (dataHandle && dataHandle !== requestedHandle) {
    return { outcome: "invalid_response", creditsCharged, handleOutcome };
  }

  if (creditsCharged != null && (creditsCharged < 0 || creditsCharged > HUNTER_PERSONAL_REVEAL_MAX_CREDITS)) {
    return {
      outcome: "contract_violation",
      creditsCharged,
      handleOutcome,
      person: mapPerson(dataRow),
    };
  }

  if (handleOutcome === "not_found") {
    return { outcome: "not_found", creditsCharged: creditsCharged ?? 0, handleOutcome };
  }
  if (handleOutcome === "insufficient_credits") {
    return { outcome: "insufficient_credits", creditsCharged: creditsCharged ?? 0, handleOutcome };
  }
  if (handleOutcome === "revealed" || handleOutcome === "already_revealed") {
    if (creditsCharged == null) {
      return { outcome: "invalid_response", creditsCharged: null, handleOutcome };
    }
    return {
      outcome: handleOutcome,
      creditsCharged,
      handleOutcome,
      person: mapPerson(dataRow),
    };
  }

  return { outcome: "invalid_response", creditsCharged, handleOutcome };
}

/**
 * Paid Hunter Multi-Domain Search reveal. Exactly one handle per call.
 * Does not call Domain Search, Email Finder, Email Verifier, Discover,
 * or masked Multi-Domain Search.
 */
export class HunterPersonalContactRevealProvider implements PersonalContactRevealProvider {
  readonly id = "hunter" as const;
  readonly capability = "personal_contact_reveal" as const;
  readonly costKind = "paid" as const;
  readonly maximumCreditsPerAction = 1 as const;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HunterPersonalRevealOptions) {
    this.apiKey = assertApiKey(options.apiKey ?? "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async reveal(input: PersonalContactRevealRequest): Promise<PersonalContactRevealResult> {
    const handle = blankToUndefined(input.providerRef);
    if (!handle) {
      throw new HunterDiscoveryError("invalid_input", "A provider reference is required.");
    }
    const handles = [handle];
    if (handles.length !== 1) {
      throw new HunterDiscoveryError("invalid_input", "Reveal accepts exactly one handle.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(HUNTER_MULTI_DOMAIN_REVEAL_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
        },
        body: JSON.stringify({ handles }),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new HunterDiscoveryError("timeout", "Hunter personal reveal timed out.", {
          apiKey: this.apiKey,
        });
      }
      const raw = err instanceof Error ? err.message : "Hunter personal reveal network error.";
      throw new HunterDiscoveryError("provider_unavailable", redactSecret(raw, this.apiKey), {
        apiKey: this.apiKey,
      });
    } finally {
      clearTimeout(timer);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }

    if (response.status === 429) {
      if (hunterErrorsMentionInsufficient(parsed)) {
        return { outcome: "quota_exhausted", creditsCharged: 0 };
      }
      return { outcome: "rate_limited", creditsCharged: 0 };
    }

    if (!response.ok) {
      throw hunterErrorFromHttpStatus(response.status, this.apiKey, "Hunter personal reveal");
    }

    if (parsed === undefined) {
      return { outcome: "invalid_response", creditsCharged: null };
    }

    return parseOkBody(parsed, handle);
  }
}

export function createHunterPersonalContactRevealProvider(
  options: HunterPersonalRevealOptions,
): PersonalContactRevealProvider {
  return new HunterPersonalContactRevealProvider(options);
}
