import "server-only";

import { toUsageBucket, type ProviderUsage, type UsageBucket } from "@/lib/buyerFinder/usage";
import { HunterDiscoveryError, hunterErrorFromHttpStatus, redactSecret } from "./errors";

export const HUNTER_USAGE_URL = "https://api.hunter.io/v2/usage";

const DEFAULT_TIMEOUT_MS = 15_000;
const USAGE_OPERATION = "Hunter usage";

export interface HunterUsageProviderOptions {
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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseBucket(raw: unknown): UsageBucket | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const used = finiteNumber(rec.used);
  const available = finiteNumber(rec.available);
  const remaining = finiteNumber(rec.remaining);
  if (used == null && available == null && remaining == null) return undefined;
  return toUsageBucket(used ?? 0, available ?? 0, remaining ?? 0);
}

function parseResetDate(raw: unknown): string | null {
  if (typeof raw === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
    return m?.[1] ?? null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1e12) {
      const iso = new Date(raw).toISOString();
      return iso.slice(0, 10);
    }
    if (raw > 1e9) {
      const iso = new Date(raw * 1000).toISOString();
      return iso.slice(0, 10);
    }
  }
  return null;
}

export function normalizeHunterUsage(payload: unknown, fetchedAt: string): ProviderUsage {
  if (!payload || typeof payload !== "object") {
    throw new HunterDiscoveryError("invalid_response", "Hunter usage response was not an object.");
  }
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (data == null) {
    return { provider: "hunter", resetDate: null, fetchedAt };
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new HunterDiscoveryError("invalid_response", "Hunter usage data was not an object.");
  }
  const rec = data as Record<string, unknown>;
  const requests =
    rec.requests && typeof rec.requests === "object" && !Array.isArray(rec.requests)
      ? (rec.requests as Record<string, unknown>)
      : undefined;

  const usage: ProviderUsage = {
    provider: "hunter",
    resetDate: parseResetDate(rec.reset_date),
    fetchedAt,
  };
  const unified = requests ? parseBucket(requests.credits) : undefined;
  const searches = requests ? parseBucket(requests.searches) : undefined;
  const verifications = requests ? parseBucket(requests.verifications) : undefined;
  if (unified) usage.unifiedCredits = unified;
  if (searches) usage.searches = searches;
  if (verifications) usage.verifications = verifications;
  return usage;
}

/**
 * Real Hunter usage provider. GET /v2/usage is free (0 credits).
 * API key is injected — never read from process.env.
 */
export class HunterUsageProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HunterUsageProviderOptions) {
    this.apiKey = assertApiKey(options.apiKey ?? "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getUsage(): Promise<ProviderUsage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(HUNTER_USAGE_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-KEY": this.apiKey,
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new HunterDiscoveryError("timeout", "Hunter usage request timed out.", {
          apiKey: this.apiKey,
        });
      }
      const raw = err instanceof Error ? err.message : "Hunter usage network error.";
      throw new HunterDiscoveryError("provider_unavailable", redactSecret(raw, this.apiKey), {
        apiKey: this.apiKey,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw hunterErrorFromHttpStatus(response.status, this.apiKey, USAGE_OPERATION);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new HunterDiscoveryError("invalid_response", "Hunter usage returned invalid JSON.", {
        apiKey: this.apiKey,
      });
    }

    return normalizeHunterUsage(parsed, new Date().toISOString());
  }
}

export function createHunterUsageProvider(options: HunterUsageProviderOptions): HunterUsageProvider {
  return new HunterUsageProvider(options);
}
