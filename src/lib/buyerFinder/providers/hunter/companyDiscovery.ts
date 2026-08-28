import "server-only";

import { isActiveBusinessProductId } from "@/lib/buyerFinder/businessCatalogue";
import { blankToUndefined, normalizeDomain, normalizeOptionalUrl } from "@/lib/buyerFinder/normalize";
import type { CandidateEvidence } from "@/lib/buyerFinder/types";
import type { CompanyDiscoveryProvider, CompanyDiscoveryQuery, DiscoveredCompany } from "../types";
import { HunterDiscoveryError, hunterErrorFromHttpStatus, redactSecret } from "./errors";
import { buildHunterDiscoverPlan, HUNTER_DISCOVER_URL } from "./query";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HunterCompanyDiscoveryOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function localLimit(queryLimit: number | undefined): number | undefined {
  if (queryLimit == null || !Number.isFinite(queryLimit)) return undefined;
  return Math.max(0, Math.floor(queryLimit));
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

function evidenceFor(query: CompanyDiscoveryQuery, isoCountry: string, keywords: string[]): CandidateEvidence[] {
  const types = (query.buyerTypes ?? []).join(", ") || "none";
  return [
    {
      note: `Hunter Discover company match. Country ${query.country} (${isoCountry}). Product ${query.productId}. Keywords (match any): ${keywords.join(", ")}. Buyer type SEARCH INTENT (not fact): ${types}. Directory match only — not proof of import or distribution.`,
      confidence: 40,
    },
  ];
}

function mapHunterRecord(
  raw: unknown,
  query: CompanyDiscoveryQuery,
  isoCountry: string,
  keywords: string[],
): DiscoveredCompany | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const companyName = blankToUndefined(typeof rec.organization === "string" ? rec.organization : undefined);
  const domain = normalizeDomain(typeof rec.domain === "string" ? rec.domain : undefined);
  if (!companyName || !domain) return undefined;
  const website = normalizeOptionalUrl(`https://${domain}`);
  // Free Discover fields we persist: organization → companyName, domain,
  // synthesized website. Country is the search query, not a Hunter row field.
  // Fixture `emails_count` is discarded — no persisted column and it is not
  // a buyer-quality signal. Industry, headcount, description, city, and
  // company type are not present in our mapped Discover records.
  return {
    providerRecordId: `hunter-${domain}`,
    companyName,
    domain,
    website,
    country: query.country,
    evidence: evidenceFor(query, isoCountry, keywords),
    source: "hunter",
  };
}

/**
 * Real Hunter Discover company provider. API key is injected — never read from process.env.
 * Tests must pass fetchImpl; production omits it (globalThis.fetch).
 */
export class HunterCompanyDiscoveryProvider implements CompanyDiscoveryProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HunterCompanyDiscoveryOptions) {
    this.apiKey = assertApiKey(options.apiKey ?? "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async discover(query: CompanyDiscoveryQuery): Promise<DiscoveredCompany[]> {
    if (!isActiveBusinessProductId(query.productId)) {
      throw new HunterDiscoveryError(
        "invalid_input",
        `Invalid MDF business product id: ${String(query.productId || "(empty)")}`,
      );
    }
    const plan = buildHunterDiscoverPlan(query);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(HUNTER_DISCOVER_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": this.apiKey,
        },
        body: JSON.stringify(plan.body),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new HunterDiscoveryError("timeout", "Hunter Discover request timed out.", {
          apiKey: this.apiKey,
        });
      }
      const raw = err instanceof Error ? err.message : "Hunter Discover network error.";
      throw new HunterDiscoveryError("provider_unavailable", redactSecret(raw, this.apiKey), {
        apiKey: this.apiKey,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw hunterErrorFromHttpStatus(response.status, this.apiKey);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new HunterDiscoveryError("invalid_response", "Hunter Discover returned invalid JSON.", {
        apiKey: this.apiKey,
      });
    }

    if (!parsed || typeof parsed !== "object") {
      throw new HunterDiscoveryError("invalid_response", "Hunter Discover response was not an object.", {
        apiKey: this.apiKey,
      });
    }
    const data = (parsed as { data?: unknown }).data;
    if (data == null) return [];
    if (!Array.isArray(data)) {
      throw new HunterDiscoveryError("invalid_response", "Hunter Discover data was not an array.", {
        apiKey: this.apiKey,
      });
    }

    const mapped: DiscoveredCompany[] = [];
    for (const row of data) {
      const hit = mapHunterRecord(row, query, plan.isoCountry, plan.keywords);
      if (hit) mapped.push(hit);
    }

    const cap = localLimit(query.limit);
    return cap == null ? mapped : mapped.slice(0, cap);
  }
}

export function createHunterCompanyDiscoveryProvider(
  options: HunterCompanyDiscoveryOptions,
): CompanyDiscoveryProvider {
  return new HunterCompanyDiscoveryProvider(options);
}
