import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const actions = read("src/app/(app)/buyer-finder/tradeResearchActions.ts");
const drain = read("src/app/api/internal/trade-research/drain/route.ts");
const worker = read("src/lib/tradeResearch/server/worker.ts");
const service = read("src/lib/tradeResearch/server/serviceRoleClient.ts");

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
    expect(drain).toContain("maxJobs: 2");
    expect(drain).toContain("timeBudgetMs: 45_000");
  });

  it("has no paid fallback, ImportYeti, or Buyer Intelligence ingestion path", () => {
    const all = `${actions}\n${drain}\n${worker}`.toLowerCase();
    expect(all).not.toContain("importyeti");
    expect(all).not.toContain("ingest_buyer_intelligence");
    expect(all).not.toContain("buyer_trade_observations");
    expect(all).not.toContain("paid fallback");
  });
});

