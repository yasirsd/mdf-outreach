import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MI1C — SERVER-ONLY boundary tests.
 *
 * These tests never spin up a real Supabase client. They prove:
 *   • `import "server-only"` appears at the top of every server file.
 *   • Missing `SUPABASE_SERVICE_ROLE_KEY` fails closed with a typed
 *     error.
 *   • `NEXT_PUBLIC_*` never carries a service-role variable name.
 *   • The service-role file itself never exports the key value.
 *   • The writer exposes only the approved contract shape.
 */

const HERE = process.cwd();
const CLIENT = readFileSync(
  path.resolve(HERE, "src/lib/marketIntelligence/server/serviceRoleClient.ts"),
  "utf8",
);
const WRITER = readFileSync(
  path.resolve(HERE, "src/lib/marketIntelligence/server/writer.ts"),
  "utf8",
);
const ACTIONS = readFileSync(
  path.resolve(HERE, "src/lib/marketIntelligence/server/actions.ts"),
  "utf8",
);
const TYPES = readFileSync(
  path.resolve(HERE, "src/lib/marketIntelligence/server/types.ts"),
  "utf8",
);

vi.mock("server-only", () => ({}));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("MI1C server-only boundary shape", () => {
  it("every server module carries an import \"server-only\" directive", () => {
    for (const source of [CLIENT, WRITER, ACTIONS, TYPES]) {
      expect(source).toMatch(/import "server-only";/);
    }
  });

  it("the actions module is marked 'use server'", () => {
    expect(ACTIONS.split("\n")[0]).toContain('"use server"');
    expect(ACTIONS).toMatch(/await requireMdfSession\(\)/);
  });

  it("no server file mentions a NEXT_PUBLIC_ service-role env var", () => {
    for (const source of [CLIENT, WRITER, ACTIONS, TYPES]) {
      expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/);
    }
  });

  it("the service-role file reads the key exclusively from process.env and never returns or logs it", () => {
    expect(CLIENT).toContain('"SUPABASE_SERVICE_ROLE_KEY"');
    // No console.log / console.info anywhere in the client.
    expect(CLIENT).not.toMatch(/console\.(log|info|warn|error)\(/);
    // No `return key` or `return process.env`.
    expect(CLIENT).not.toMatch(/return\s+key\b/);
    expect(CLIENT).not.toMatch(/return\s+process\.env\b/);
    // No re-export of the raw key.
    expect(CLIENT).not.toMatch(/export\s+.*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("the writer never provides a generic .from(table) / .rpc(name) escape hatch", () => {
    // Every rpc call in the writer names one of the five approved RPCs.
    const rpcCalls = WRITER.match(/supabase\.rpc\("([^"]+)"/g) ?? [];
    const approved = new Set([
      'supabase.rpc("ingest_market_intelligence_source"',
      'supabase.rpc("verify_market_intelligence_source"',
      'supabase.rpc("ingest_market_trade_observation"',
      'supabase.rpc("record_market_fetch_result"',
      'supabase.rpc("refresh_market_intelligence"',
      'supabase.rpc("sync_product_trade_mappings"',
    ]);
    for (const call of rpcCalls) expect(approved.has(call)).toBe(true);
    // The writer NEVER exposes .from(table).
    expect(WRITER).not.toMatch(/supabase\.from\(/);
    // No `executeSql` / `insertAnyTable` shapes.
    expect(WRITER).not.toMatch(/executeSql|insertAny|adminDb|adminSupabase|serviceRoleRepository/i);
  });

  it("the actions module is the only ingress that must call requireMdfSession", () => {
    expect(ACTIONS).toMatch(/requireMdfSession/);
    // The writer itself never RESOLVES the MDF session (mentioning
    // requireMdfSession by name inside prose is fine; calling it would
    // duplicate authority). Assert on the call form only.
    expect(WRITER).not.toMatch(/await requireMdfSession\(\)/);
    expect(WRITER).not.toMatch(/from "@\/lib\/auth\/require"/);
    // No arbitrary global-write function outside the writer.
    expect(ACTIONS).not.toMatch(/supabase\.rpc\(/);
    expect(ACTIONS).not.toMatch(/supabase\.from\(/);
  });
});

describe("MI1C service-role client fail-closed behaviour", () => {
  it("throws a typed error when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const mod = await import("./serviceRoleClient");
    mod.__resetMarketIntelligenceServiceRoleClientForTests();
    expect(() => mod.getMarketIntelligenceServiceRoleClient()).toThrow(
      mod.MarketIntelligenceServiceRoleConfigError,
    );
  });

  it("throws a typed error when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const mod = await import("./serviceRoleClient");
    mod.__resetMarketIntelligenceServiceRoleClientForTests();
    expect(() => mod.getMarketIntelligenceServiceRoleClient()).toThrow(
      mod.MarketIntelligenceServiceRoleConfigError,
    );
  });

  it("returns a stable cached instance once configured", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const mod = await import("./serviceRoleClient");
    mod.__resetMarketIntelligenceServiceRoleClientForTests();
    const a = mod.getMarketIntelligenceServiceRoleClient();
    const b = mod.getMarketIntelligenceServiceRoleClient();
    expect(a).toBe(b);
  });
});

describe("MI1C writer contract shape", () => {
  it("the exported writer interface names exactly the six approved operations", async () => {
    // The interface itself is a TypeScript-level declaration; assert
    // shape from the source.
    for (const method of [
      "ingestSource",
      "verifySourceRights",
      "ingestTradeObservation",
      "recordFetchResult",
      "refreshMarketIntelligence",
      "syncProductTradeMappings",
    ]) {
      expect(WRITER).toContain(`${method}(`);
    }
    // No sneaky extras.
    expect(WRITER).not.toMatch(/executeRawSql|arbitraryInsert|adminUpdate/i);
  });
});
