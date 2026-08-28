// @vitest-environment node
/**
 * Developer-only Hunter live tests.
 *
 * Does NOT run during ordinary `npm test`.
 * Enable with ALL of:
 *   HUNTER_LIVE_TEST=1
 *   BUYER_FINDER_HUNTER_ENABLED=true
 *   HUNTER_API_KEY present
 *   BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED !== true
 *
 * process.env is allowed in this file only. Production providers
 * still require constructor-injected apiKey.
 *
 * Sequence and budget:
 *   1. GET  /v2/usage     <= 1  (free; if this fails, STOP — no Discover)
 *   2. POST /v2/discover  <= 1
 *   any other Hunter endpoint = 0 (no Domain Search, Email Finder,
 *   Email Verifier, enrichment, account, usage/history, or retries)
 */

import { describe, it, expect } from "vitest";
import { HunterCompanyDiscoveryProvider } from "./companyDiscovery";
import { HunterUsageProvider, HUNTER_USAGE_URL } from "./usage";
import { HunterDiscoveryError, redactSecret } from "./errors";
import { HUNTER_DISCOVER_URL } from "./query";

const liveEnabled = process.env.HUNTER_LIVE_TEST === "1";
const hunterEnabled = process.env.BUYER_FINDER_HUNTER_ENABLED === "true";
const enrichmentEnabled = process.env.BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED === "true";
const liveApiKey = (process.env.HUNTER_API_KEY ?? "").trim();
const canRunLive = liveEnabled && hunterEnabled && liveApiKey.length > 0 && !enrichmentEnabled;

const budget = {
  discover: 0,
  usage: 0,
};
let usageSucceeded = false;

const SAFE_NETWORK_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "CERT_HAS_EXPIRED",
  "CERT_UNTRUSTED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
];

function walkCauses(err: unknown, depth = 0): Array<{ name?: string; code?: string; message?: string }> {
  if (depth > 5 || !err || typeof err !== "object") return [];
  const rec = err as { name?: string; code?: string; message?: string; cause?: unknown };
  const row = { name: rec.name, code: rec.code, message: rec.message };
  return [row, ...walkCauses(rec.cause, depth + 1)];
}

function classifyNetworkFailure(codes: string[], names: string[]): string {
  const blob = [...codes, ...names].join(" ").toUpperCase();
  if (
    blob.includes("CERT") ||
    blob.includes("TLS") ||
    blob.includes("SSL") ||
    blob.includes("UNABLE_TO_VERIFY") ||
    blob.includes("SELF_SIGNED")
  ) {
    return "tls_certificate";
  }
  if (blob.includes("ENOTFOUND") || blob.includes("EAI_AGAIN")) return "dns";
  if (blob.includes("ETIMEDOUT") || blob.includes("ABORT") || blob.includes("TIMEOUT")) return "timeout";
  if (blob.includes("ECONNRESET") || blob.includes("ECONNREFUSED") || blob.includes("ENETUNREACH")) {
    return "connection";
  }
  return "unknown_network";
}

function sanitizeNetworkFailure(err: unknown, apiKey: string): string {
  const rows = walkCauses(err);
  const names = rows.map((r) => r.name).filter((v): v is string => Boolean(v));
  const codes = rows.map((r) => r.code).filter((v): v is string => Boolean(v));
  for (const row of rows) {
    const msg = row.message ?? "";
    for (const token of SAFE_NETWORK_CODES) {
      if (msg.includes(token) && !codes.includes(token)) codes.push(token);
    }
  }
  const cls = classifyNetworkFailure(codes, names);
  const safe = redactSecret(
    `network_failure class=${cls} name=${names[0] ?? "n/a"} code=${codes[0] ?? "n/a"} causeCode=${codes[1] ?? "n/a"}`,
    apiKey,
  );
  return safe;
}

function liveFetch(apiKey: string): typeof fetch {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("api_key=")) {
      throw new Error("Hunter live test refused a URL that contains api_key=.");
    }
    if (url === HUNTER_USAGE_URL) {
      if (budget.usage >= 1) {
        throw new Error("Hunter live test refused Usage request #2 — budget is 1.");
      }
      budget.usage += 1;
    } else if (url === HUNTER_DISCOVER_URL) {
      if (budget.discover >= 1) {
        throw new Error("Hunter live test refused Discover request #2 — budget is 1.");
      }
      if (!usageSucceeded) {
        throw new Error("Hunter live test refused Discover before a successful Usage call.");
      }
      budget.discover += 1;
    } else {
      throw new Error("Hunter live test refused a non-allowlisted URL.");
    }
    try {
      const response = await globalThis.fetch(input, init);
      if (url === HUNTER_USAGE_URL) {
        console.log("HUNTER_LIVE_USAGE_HTTP\t" + String(response.status));
      }
      if (url === HUNTER_DISCOVER_URL) {
        console.log("HUNTER_LIVE_DISCOVER_HTTP\t" + String(response.status));
        try {
          const cloned = await response.clone().json();
          const rows = cloned && typeof cloned === "object" ? (cloned as { data?: unknown }).data : undefined;
          const rawCount = Array.isArray(rows) ? rows.length : 0;
          console.log("HUNTER_LIVE_DISCOVER_RAW_COUNT\t" + String(rawCount));
        } catch {
          console.log("HUNTER_LIVE_DISCOVER_RAW_COUNT\tn/a");
        }
      }
      return response;
    } catch (err) {
      throw new Error(sanitizeNetworkFailure(err, apiKey));
    }
  };
  return fetchImpl;
}

describe.skipIf(!canRunLive)("Hunter live (developer only)", () => {
  it("runs Usage once, then Discover once for Thailand + guntur-chilli", async () => {
    if (process.env.HUNTER_LIVE_TEST !== "1") {
      throw new Error("Live-test safety: HUNTER_LIVE_TEST is not 1. Aborting without network.");
    }
    if (process.env.BUYER_FINDER_HUNTER_ENABLED !== "true") {
      throw new Error("Live-test safety: BUYER_FINDER_HUNTER_ENABLED is not true. Aborting without network.");
    }
    if (process.env.BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED === "true") {
      throw new Error("Live-test safety: BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED is true. Aborting.");
    }
    const apiKey = (process.env.HUNTER_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error("Live-test safety: HUNTER_API_KEY missing. Aborting without network.");
    }

    const fetchImpl = liveFetch(apiKey);
    const usageProvider = new HunterUsageProvider({ apiKey, fetchImpl });
    let usage;
    try {
      usage = await usageProvider.getUsage();
    } catch (err) {
      if (err instanceof HunterDiscoveryError) {
        throw new Error(
          `Hunter live Usage failed: code=${err.code} status=${err.status ?? "n/a"} message=${err.message}. Discover was not attempted.`,
        );
      }
      throw err;
    }

    usageSucceeded = true;
    expect(budget.usage).toBe(1);
    expect(budget.discover).toBe(0);
    expect(usage.provider).toBe("hunter");
    expect(JSON.stringify(usage)).not.toContain(apiKey);

    console.log("HUNTER_LIVE_USAGE_RESET\t" + String(usage.resetDate ?? "null"));
    if (usage.unifiedCredits) {
      const c = usage.unifiedCredits;
      console.log(
        `HUNTER_LIVE_USAGE_CREDITS\tused=${c.used}\tremaining=${c.remaining}\tavailable=${c.available}\tpercentUsed=${c.percentUsed}`,
      );
    }
    if (usage.searches) {
      const c = usage.searches;
      console.log(
        `HUNTER_LIVE_USAGE_SEARCHES\tused=${c.used}\tremaining=${c.remaining}\tavailable=${c.available}\tpercentUsed=${c.percentUsed}`,
      );
    }
    if (usage.verifications) {
      const c = usage.verifications;
      console.log(
        `HUNTER_LIVE_USAGE_VERIFICATIONS\tused=${c.used}\tremaining=${c.remaining}\tavailable=${c.available}\tpercentUsed=${c.percentUsed}`,
      );
    }

    const discoverProvider = new HunterCompanyDiscoveryProvider({ apiKey, fetchImpl });
    let hits;
    try {
      hits = await discoverProvider.discover({
        country: "Thailand",
        productId: "guntur-dry-red-chilli",
        buyerTypes: ["Importer"],
        limit: 10,
      });
    } catch (err) {
      if (err instanceof HunterDiscoveryError) {
        throw new Error(
          `Hunter live Discover failed: code=${err.code} status=${err.status ?? "n/a"} message=${err.message}`,
        );
      }
      throw err;
    }

    expect(budget.usage).toBe(1);
    expect(budget.discover).toBe(1);
    expect(hits.length).toBeLessThanOrEqual(10);
    expect(hits.every((h) => h.source === "hunter")).toBe(true);
    expect(hits.every((h) => h.country === "Thailand")).toBe(true);
    expect(hits.every((h) => h.isImporter === undefined)).toBe(true);
    expect(hits.every((h) => h.isDistributor === undefined)).toBe(true);

    const serialized = JSON.stringify(hits);
    expect(serialized).not.toContain(apiKey);

    console.log("HUNTER_LIVE_DISCOVER_COUNT\t" + String(hits.length));
    for (const h of hits) {
      const evidence = (h.evidence[0]?.note ?? "").replace(/\s+/g, " ").slice(0, 120);
      console.log(`HUNTER_LIVE_ROW\t${h.companyName}\t${h.domain ?? ""}\t${h.country}\t${h.source}\t${evidence}`);
    }
  }, 30_000);
});
