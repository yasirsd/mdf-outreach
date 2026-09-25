import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const actions = read("src/app/(app)/buyer-finder/tradeResearchActions.ts");
const drain = read("src/app/api/internal/trade-research/drain/route.ts");
const middleware = read("middleware.ts");
const worker = read("src/lib/tradeResearch/server/worker.ts");
const fda = read("src/lib/tradeResearch/fdaFsvp.ts");
const service = read("src/lib/tradeResearch/server/serviceRoleClient.ts");
const packageJson = JSON.parse(read("package.json")) as {
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
};
const panel = read("src/components/buyerFinder/TradeResearchPanel.tsx");
const polling = read("src/lib/tradeResearch/useTradeResearchPolling.ts");
const appLayout = read("src/app/(app)/layout.tsx");
const freeAutopump = read("src/components/buyerFinder/FreeEnrichmentAutopump.tsx");

describe("trade research security and evidence isolation", () => {
  it("requires an owner for create/cancel and derives workspace from the session", () => {
    expect(actions).toContain('session.membership.role !== "owner"');
    expect(actions).toContain("session.membership.workspaceId");
    expect(actions).not.toMatch(/workspaceId:\s*input\./);
  });

  it("does not accept provider, cost, quota, paid, or source URL controls from the browser", () => {
    expect(actions).toMatch(/createTradeResearchBatchAction\(candidateIds: readonly string\[\]\)/);
    expect(actions).not.toMatch(/export async function createTradeResearchBatchAction\([^)]*(provider|cost|quota|paid|sourceUrl)/i);
  });

  it("keeps the modern Supabase secret server-only and rejects public/legacy credentials", () => {
    expect(service).toContain('import "server-only"');
    expect(service).toContain('"SUPABASE_SECRET_KEY"');
    expect(service).toContain('startsWith("sb_secret_")');
    expect(service).not.toContain("NEXT_PUBLIC_SUPABASE_SECRET_KEY");
    expect(service).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("makes the worker route bounded and independently scheduler-authenticated", () => {
    expect(drain).toContain("TRADE_RESEARCH_DRAIN_SECRET");
    expect(drain).toContain("timingSafeEqual");
    expect(drain).toContain("maxJobs: JOBS_PER_DRAIN");
    expect(drain).toContain("timeBudgetMs: TIME_BUDGET_MS");
    expect(drain).toContain('runtime = "nodejs"');
    const bypass = middleware.indexOf('pathname === "/api/internal/trade-research/drain"');
    const globalClient = middleware.indexOf(
      "createMiddlewareClient(request)",
      middleware.indexOf("export async function middleware"),
    );
    expect(bypass).toBeGreaterThan(-1);
    expect(bypass).toBeLessThan(globalClient);
  });

  it("pins the production runtime required by the pure-JavaScript XLSX and SHA-256 path", () => {
    expect(packageJson.engines?.node).toBe("22.x");
    expect(packageJson.dependencies?.fflate).toBe("0.8.3");
    expect(fda).toContain('from "node:crypto"');
    expect(fda).toContain('from "fflate"');
    expect(fda).not.toMatch(/\b(?:fs|filesystem|window|document)\b/);
  });

  it("keeps Phase 2A browser behavior read-only after creation and identifies the unrelated legacy drain", () => {
    expect(`${panel}\n${polling}`).not.toContain("/api/internal/trade-research/drain");
    expect(`${panel}\n${polling}`).not.toContain("TRADE_RESEARCH_DRAIN_SECRET");
    expect(polling).not.toMatch(/fetch\s*\([^)]*drain/);
    expect(appLayout).toContain("FreeEnrichmentAutopump");
    expect(freeAutopump).toContain("/api/buyer-finder/free-enrichment/drain");
    expect(freeAutopump).not.toContain("TRADE_RESEARCH_DRAIN_SECRET");
  });

  it("keeps queued execution independent from browser session lifetime", () => {
    expect(worker).not.toContain("requireMdfSession");
    expect(drain).toContain("validSchedulerSecret(request)");
    expect(drain).toContain("getTradeResearchServiceRoleClient()");
    expect(polling).not.toMatch(/cancelTradeResearch|request.*cancel/i);
  });

  it("has no paid fallback, ImportYeti, or Buyer Intelligence ingestion path", () => {
    const all = `${actions}\n${drain}\n${worker}`.toLowerCase();
    expect(all).not.toContain("importyeti");
    expect(all).not.toContain("ingest_buyer_intelligence");
    expect(all).not.toContain("buyer_trade_observations");
    expect(all).not.toContain("paid fallback");
  });
});
