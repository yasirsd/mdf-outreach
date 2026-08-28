import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

const ACTIONS = read("src/app/(app)/buyer-finder/searchRunActions.ts");
const EXECUTE = read("src/lib/buyerFinder/executeSearchRun.ts");
const ROUTE = read("src/app/api/buyer-finder/search-runs/[id]/execute/route.ts");
const VIEW = read("src/app/(app)/buyer-finder/BuyerFinderView.tsx");
const QUEUE = read("src/app/(app)/buyer-finder/QueueView.tsx");
const PROGRESS = read("src/components/buyerFinder/SearchRunProgress.tsx");
const MIGRATION = read("supabase/migrations/0013_buyer_finder_search_runs.sql");

describe("BF2.2 search-run security guardrails", () => {
  it("searchRunActions.ts is a server module gated by requireMdfSession", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
    for (const name of [
      "createBuyerFinderSearchRunAction",
      "executeBuyerFinderSearchRunAction",
      "getBuyerFinderSearchRunAction",
      "getLatestActiveBuyerFinderSearchRunAction",
      "finalizeStaleBuyerFinderSearchRunAction",
    ]) {
      expect(ACTIONS).toContain(`export async function ${name}`);
    }
    const guards = ACTIONS.match(/await requireMdfSession\(\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(5);
  });

  it("create input never accepts workspaceId, provider, credits, cost, status, stage, or apiKey", () => {
    const iface = ACTIONS.match(/export interface CreateBuyerFinderSearchRunInput\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(iface).toContain("country");
    expect(iface).toContain("productId");
    expect(iface).not.toMatch(/workspaceId|apiKey|provider|creditsUsed|costClass|status|stage|\blimit\b/);
  });

  it("provider and cost are server-stamped, never browser-selected", () => {
    expect(ACTIONS).not.toMatch(/input\.provider/);
    expect(ACTIONS).not.toMatch(/input\.costClass/);
    expect(ACTIONS).not.toMatch(/input\.creditsUsed/);
    expect(ACTIONS).not.toMatch(/input\.workspaceId/);
    expect(ACTIONS).not.toMatch(/input\.limit/);
  });

  it("API key never crosses the response and is not NEXT_PUBLIC", () => {
    expect(ACTIONS).not.toMatch(/NEXT_PUBLIC/);
    expect(ACTIONS).not.toMatch(/process\.env/);
    expect(EXECUTE).not.toMatch(/NEXT_PUBLIC/);
    expect(ROUTE).not.toMatch(/NEXT_PUBLIC/);
    expect(ACTIONS).toContain("toSnapshot");
    expect(EXECUTE).toContain("toSnapshot");
  });

  it("execute route does not read search parameters from the request body", () => {
    expect(ROUTE).toMatch(/_request/);
    expect(ROUTE).not.toMatch(/await _request\.(json|formData)/);
    expect(ROUTE).toContain("executeSearchRun");
    expect(ROUTE).toContain("requireMdfSession");
    expect(ROUTE).toContain("maxDuration");
  });

  it("no Gmail / Buyer Send / campaign / Buyer creation / LinkedIn scraping", () => {
    for (const src of [ACTIONS, EXECUTE, ROUTE, VIEW, PROGRESS]) {
      expect(src).not.toMatch(/@\/lib\/gmail/);
      expect(src).not.toMatch(/buyerSendActions/);
      expect(src).not.toMatch(/BUYER_SEND_ENABLED/);
      expect(src).not.toMatch(/repos\.buyers\.create/);
      expect(src).not.toMatch(/repos\.campaigns\./);
      expect(src).not.toMatch(/repos\.recipients\./);
      expect(src).not.toMatch(/linkedin\.com\/scrape/i);
    }
  });

  it("production path does not import mock contact enrichment", () => {
    expect(ACTIONS).not.toMatch(/contactEnrichment/);
    expect(EXECUTE).not.toMatch(/contactProvider:/);
    expect(EXECUTE).toMatch(/no contactProvider/);
  });

  it("Queue browsing has no provider side effect", () => {
    expect(QUEUE).not.toMatch(/discoverAndIngest/);
    expect(QUEUE).not.toMatch(/createHunter/);
    expect(QUEUE).not.toMatch(/executeBuyerFinder/);
    expect(QUEUE).not.toMatch(/fetch\(/);
  });

  it("page refresh resumes observation and does not auto-execute", () => {
    expect(VIEW).toContain("initialActiveRun");
    expect(VIEW).toContain("startExecute");
    expect(VIEW).toMatch(
      /if \(result\.outcome === "created"\) \{\s*startExecute\(result\.run\.id\)/,
    );
    expect(VIEW).not.toMatch(/useEffect\([^;]*startExecute/);
  });

  it("migration keeps workspace RLS and the one-active-run unique index", () => {
    expect(MIGRATION).toContain("mdf.__apply_workspace_rls('public.buyer_finder_search_runs'::regclass)");
    expect(MIGRATION).toContain("buyer_finder_search_runs_one_active_per_workspace_idx");
  });

  it("process cap is server-authoritative; browser cannot raise it", () => {
    const iface = ACTIONS.match(/export interface CreateBuyerFinderSearchRunInput\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(iface).not.toMatch(/\blimit\b/);
    expect(VIEW).not.toMatch(/createBuyerFinderSearchRunAction\([\s\S]{0,400}\blimit\s*:/);
    expect(EXECUTE).toContain("BUYER_FINDER_PROCESS_CAP");
    expect(EXECUTE).not.toMatch(/page\s*[:=]\s*2/);
    expect(EXECUTE).not.toMatch(/offset/);
  });

  it("execute and create honor the runtime enabled gate before Hunter", () => {
    expect(ACTIONS).toContain("isBuyerFinderHunterEnabled");
    expect(ACTIONS).toContain("isBuyerFinderHunterReady");
    expect(ROUTE).toContain("isBuyerFinderHunterReady");
    expect(ROUTE).toContain("HUNTER_DISCOVERY_DISABLED_MESSAGE");
    expect(VIEW).not.toMatch(/NEXT_PUBLIC/);
    expect(VIEW).not.toMatch(/BUYER_FINDER_HUNTER_API_KEY/);
    expect(VIEW).toContain("hunterDiscovery");
    expect(ACTIONS).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
    expect(ROUTE).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
    expect(EXECUTE).not.toContain("isBuyerFinderHunterEnrichmentEnabled");
  });
});
