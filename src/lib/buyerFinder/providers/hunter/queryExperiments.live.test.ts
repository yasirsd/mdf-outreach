// @vitest-environment node
/**
 * Phase 5C Hunter Discover quality experiments.
 *
 * Ordinary `npm test` skips this file.
 *
 * HUNTER_LIVE_TEST=1
 * BUYER_FINDER_HUNTER_ENABLED=true
 * BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED !== true
 * HUNTER_API_KEY present
 *
 * HUNTER_LIVE_ACTION=usage | discover
 * HUNTER_KEYWORD_INTENT=product-led | food-trade | hybrid  (discover only)
 *
 * Budget per process: 1 Usage OR 1 Discover. No contact endpoints.
 */

import { describe, it, expect } from "vitest";
import { HunterCompanyDiscoveryProvider } from "./companyDiscovery";
import { HunterUsageProvider, HUNTER_USAGE_URL } from "./usage";
import { HunterDiscoveryError, redactSecret } from "./errors";
import {
  buildHunterDiscoverPlan,
  HUNTER_DISCOVER_URL,
  type HunterKeywordIntent,
} from "./query";

const liveEnabled = process.env.HUNTER_LIVE_TEST === "1";
const hunterEnabled = process.env.BUYER_FINDER_HUNTER_ENABLED === "true";
const enrichmentEnabled = process.env.BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED === "true";
const liveApiKey = (process.env.HUNTER_API_KEY ?? "").trim();
const action = (process.env.HUNTER_LIVE_ACTION ?? "").trim();
const canRunLive =
  liveEnabled && hunterEnabled && liveApiKey.length > 0 && !enrichmentEnabled && Boolean(action);

const budget = { discover: 0, usage: 0 };

function parseIntent(raw: string): HunterKeywordIntent {
  if (raw === "food-trade" || raw === "hybrid" || raw === "product-led") return raw;
  return "product-led";
}

function liveFetch(apiKey: string, allowed: "usage" | "discover"): typeof fetch {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("api_key=")) {
      throw new Error("Hunter live test refused a URL that contains api_key=.");
    }
    if (url === HUNTER_USAGE_URL) {
      if (allowed !== "usage") throw new Error("Hunter live test refused Usage during a Discover run.");
      if (budget.usage >= 1) throw new Error("Hunter live test refused Usage request #2 — budget is 1.");
      budget.usage += 1;
    } else if (url === HUNTER_DISCOVER_URL) {
      if (allowed !== "discover") throw new Error("Hunter live test refused Discover during a Usage run.");
      if (budget.discover >= 1) throw new Error("Hunter live test refused Discover request #2 — budget is 1.");
      budget.discover += 1;
    } else {
      throw new Error("Hunter live test refused a non-allowlisted URL.");
    }
    try {
      const response = await globalThis.fetch(input, init);
      if (url === HUNTER_USAGE_URL) console.log("HUNTER_LIVE_USAGE_HTTP\t" + String(response.status));
      if (url === HUNTER_DISCOVER_URL) {
        console.log("HUNTER_LIVE_DISCOVER_HTTP\t" + String(response.status));
        try {
          const cloned = await response.clone().json();
          const rows = cloned && typeof cloned === "object" ? (cloned as { data?: unknown }).data : undefined;
          console.log("HUNTER_LIVE_DISCOVER_RAW_COUNT\t" + String(Array.isArray(rows) ? rows.length : 0));
        } catch {
          console.log("HUNTER_LIVE_DISCOVER_RAW_COUNT\tn/a");
        }
      }
      return response;
    } catch (err) {
      const raw = err instanceof Error ? err.message : "network error";
      throw new Error(redactSecret(raw, apiKey));
    }
  };
  return fetchImpl;
}

describe.skipIf(!canRunLive)("Hunter 5C experiments (developer only)", () => {
  it("runs the selected live action once", async () => {
    if (process.env.BUYER_FINDER_HUNTER_ENRICHMENT_ENABLED === "true") {
      throw new Error("Enrichment gate is on. Aborting.");
    }
    const apiKey = (process.env.HUNTER_API_KEY ?? "").trim();
    if (action === "usage") {
      const usage = await new HunterUsageProvider({ apiKey, fetchImpl: liveFetch(apiKey, "usage") }).getUsage();
      expect(usage.provider).toBe("hunter");
      expect(JSON.stringify(usage)).not.toContain(apiKey);
      console.log("HUNTER_LIVE_USAGE_RESET\t" + String(usage.resetDate ?? "null"));
      if (usage.unifiedCredits) {
        const c = usage.unifiedCredits;
        console.log(
          `HUNTER_LIVE_USAGE_CREDITS\tused=${c.used}\tremaining=${c.remaining}\tavailable=${c.available}`,
        );
      }
      if (usage.searches) {
        const c = usage.searches;
        console.log(`HUNTER_LIVE_USAGE_SEARCHES\tused=${c.used}\tremaining=${c.remaining}\tavailable=${c.available}`);
      }
      if (usage.verifications) {
        const c = usage.verifications;
        console.log(
          `HUNTER_LIVE_USAGE_VERIFICATIONS\tused=${c.used}\tremaining=${c.remaining}\tavailable=${c.available}`,
        );
      }
      expect(budget.usage).toBe(1);
      expect(budget.discover).toBe(0);
      return;
    }

    if (action !== "discover") {
      throw new Error("HUNTER_LIVE_ACTION must be usage or discover.");
    }

    const intent = parseIntent(process.env.HUNTER_KEYWORD_INTENT ?? "product-led");
    const query = {
      country: "Thailand" as const,
      productId: "guntur-dry-red-chilli" as const,
      keywordIntent: intent,
      limit: 10,
    };
    const plan = buildHunterDiscoverPlan(query);
    console.log("HUNTER_LIVE_INTENT\t" + intent);
    console.log("HUNTER_LIVE_KEYWORDS\t" + plan.keywords.join(" | "));

    let hits;
    try {
      hits = await new HunterCompanyDiscoveryProvider({
        apiKey,
        fetchImpl: liveFetch(apiKey, "discover"),
      }).discover(query);
    } catch (err) {
      if (err instanceof HunterDiscoveryError) {
        throw new Error(
          `Hunter live Discover failed: code=${err.code} status=${err.status ?? "n/a"} message=${err.message}`,
        );
      }
      throw err;
    }

    expect(budget.discover).toBe(1);
    expect(budget.usage).toBe(0);
    expect(hits.length).toBeLessThanOrEqual(10);
    expect(hits.every((h) => h.isImporter === undefined)).toBe(true);
    expect(hits.every((h) => h.isDistributor === undefined)).toBe(true);
    expect(JSON.stringify(hits)).not.toContain(apiKey);
    console.log("HUNTER_LIVE_DISCOVER_COUNT\t" + String(hits.length));
    for (const h of hits) {
      console.log(`HUNTER_LIVE_ROW\t${h.companyName}\t${h.domain ?? ""}\t${h.country}\t${h.source}`);
    }
  }, 30_000);
});
