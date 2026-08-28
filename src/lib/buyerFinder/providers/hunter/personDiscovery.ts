import "server-only";

import { blankToUndefined, normalizeDomain } from "@/lib/buyerFinder/normalize";
import type { CandidateEvidence } from "@/lib/buyerFinder/types";
import type {
  MaskedPerson,
  PersonDiscoveryProvider,
  PersonDiscoveryQuery,
  PersonDiscoveryResult,
} from "../types";
import { HunterDiscoveryError, hunterErrorFromHttpStatus, redactSecret } from "./errors";

export const HUNTER_MULTI_DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/multi-domain-search";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_LIMIT = 25;

export interface HunterPersonDiscoveryOptions {
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

function asBool(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function asEmailType(value: unknown): "personal" | "generic" | undefined {
  if (value === "personal" || value === "generic") return value;
  return undefined;
}

function evidenceFor(person: {
  position: string;
  seniority?: string;
  decisionMaker?: boolean;
  department?: string;
}): CandidateEvidence[] {
  const dm =
    person.decisionMaker === true ? "yes" : person.decisionMaker === false ? "no" : "unknown";
  const seniority = person.seniority ? person.seniority : "unknown";
  const dept = person.department ? person.department : "unknown";
  return [
    {
      note: `Hunter masked professional record. Position: ${person.position || "unknown"}. Seniority: ${seniority}. Department: ${dept}. Decision maker: ${dm}. Not proof of import or chilli buying.`,
      confidence: 0,
    },
  ];
}

function mapMaskedRow(raw: unknown): MaskedPerson | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const providerRef = blankToUndefined(typeof rec.reveal_handle === "string" ? rec.reveal_handle : undefined);
  const domain = normalizeDomain(typeof rec.domain === "string" ? rec.domain : undefined);
  if (!providerRef || !domain) return undefined;

  const maskedName = blankToUndefined(typeof rec.name === "string" ? rec.name : undefined);
  const position = blankToUndefined(typeof rec.position === "string" ? rec.position : undefined) ?? "";
  const name = maskedName ?? "";
  if (!name && !position) return undefined;

  const department = blankToUndefined(typeof rec.department === "string" ? rec.department : undefined);
  const seniority = blankToUndefined(typeof rec.seniority === "string" ? rec.seniority : undefined);
  const decisionMaker = asBool(rec.decision_maker);
  const verification =
    rec.verification && typeof rec.verification === "object"
      ? blankToUndefined(
          typeof (rec.verification as { status?: unknown }).status === "string"
            ? ((rec.verification as { status: string }).status)
            : undefined,
        )
      : undefined;

  return {
    providerRef,
    source: "hunter",
    domain,
    companyName: blankToUndefined(typeof rec.company_name === "string" ? rec.company_name : undefined),
    maskedName: name || position,
    position,
    department,
    seniority,
    emailType: asEmailType(rec.type),
    decisionMaker,
    verificationStatus: verification,
    fullNameAvailable: asBool(rec.full_name_exists),
    linkedinAvailable: asBool(rec.linkedin_exists),
    phoneAvailable: asBool(rec.phone_number_exists),
    evidence: evidenceFor({
      position: position || name,
      seniority,
      decisionMaker,
      department,
    }),
  };
}

/**
 * Free Hunter Multi-Domain Search (masked). Constructor-injected API key.
 * Does not reveal emails. Does not follow pagination cursors.
 */
export class HunterPersonDiscoveryProvider implements PersonDiscoveryProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HunterPersonDiscoveryOptions) {
    this.apiKey = assertApiKey(options.apiKey ?? "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async findPeople(query: PersonDiscoveryQuery): Promise<PersonDiscoveryResult> {
    const companyName = blankToUndefined(query.companyName);
    if (!companyName) {
      throw new HunterDiscoveryError("invalid_input", "Company name is required.");
    }
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(query.limit) ? Math.floor(query.limit as number) : MAX_LIMIT),
    );

    const url = new URL(HUNTER_MULTI_DOMAIN_SEARCH_URL);
    url.searchParams.set("company_name", companyName);
    url.searchParams.set("type", "personal");
    url.searchParams.set("limit", String(limit));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
        },
        body: JSON.stringify({
          company_name: companyName,
          type: "personal",
          limit,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new HunterDiscoveryError("timeout", "Hunter person search timed out.", {
          apiKey: this.apiKey,
        });
      }
      const raw = err instanceof Error ? err.message : "Hunter person search network error.";
      throw new HunterDiscoveryError("provider_unavailable", redactSecret(raw, this.apiKey), {
        apiKey: this.apiKey,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw hunterErrorFromHttpStatus(response.status, this.apiKey, "Hunter person search");
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new HunterDiscoveryError("invalid_response", "Hunter person search returned invalid JSON.", {
        apiKey: this.apiKey,
      });
    }

    if (!parsed || typeof parsed !== "object") {
      throw new HunterDiscoveryError("invalid_response", "Hunter person search response was not an object.", {
        apiKey: this.apiKey,
      });
    }
    const data = (parsed as { data?: unknown }).data;
    if (data == null) return { people: [], hasMore: false };
    if (!Array.isArray(data)) {
      throw new HunterDiscoveryError("invalid_response", "Hunter person search data was not an array.", {
        apiKey: this.apiKey,
      });
    }

    const people: MaskedPerson[] = [];
    for (const row of data) {
      const mapped = mapMaskedRow(row);
      if (mapped) people.push(mapped);
    }

    const meta = (parsed as { meta?: { next_search_after?: unknown } }).meta;
    const cursor = blankToUndefined(
      typeof meta?.next_search_after === "string" ? meta.next_search_after : undefined,
    );
    return { people, hasMore: Boolean(cursor) && people.length > 0 };
  }
}

export function createHunterPersonDiscoveryProvider(
  options: HunterPersonDiscoveryOptions,
): PersonDiscoveryProvider {
  return new HunterPersonDiscoveryProvider(options);
}
