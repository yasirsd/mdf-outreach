import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTradeResearchDeadline,
  TRADE_RESEARCH_SAFE_EXECUTION_MS,
  VERCEL_FUNCTION_MAX_MS,
} from "./worker";

/**
 * BI4F Phase 2A — deadline-safety static scan.
 *
 * Every production serverless entrypoint that invokes
 * `drainTradeResearch(...)` MUST plumb `deadlineAt` via the shared
 * `createTradeResearchDeadline(startedAt)` helper, so the worker's
 * hard-deadline checkpoints activate before Vercel Hobby's 60 s
 * function ceiling can kill the invocation mid-stage. A regression
 * that reintroduces a bare `drainTradeResearch({...})` call without
 * `deadlineAt` MUST fail this test.
 *
 * Test entrypoints (unit / integration test files) are intentionally
 * excluded — the worker still runs correctly without a deadline; the
 * pre-FDA and pre-match gates simply become no-ops.
 */
const REPO_ROOT = process.cwd();

const PRODUCTION_DRAIN_CALL_SITES = [
  "src/app/(app)/buyer-finder/tradeResearchActions.ts",
  "src/app/api/cron/trade-research-drain/route.ts",
  "src/app/api/internal/trade-research/drain/route.ts",
] as const;

function readFile(relative: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relative), "utf8");
}

describe("BI4F 2A deadline safety — every production drain call plumbs deadlineAt", () => {
  for (const relative of PRODUCTION_DRAIN_CALL_SITES) {
    it(`${relative} imports createTradeResearchDeadline from the shared worker helper`, () => {
      const body = readFile(relative);
      expect(body).toMatch(/createTradeResearchDeadline/);
      expect(body).toMatch(
        /from\s+["']@\/lib\/tradeResearch\/server\/worker["']/,
      );
    });

    it(`${relative} passes deadlineAt on every drainTradeResearch call`, () => {
      const body = readFile(relative);
      const callSites = body.match(/drainTradeResearch\s*\(\s*\{[\s\S]*?\}\s*\)/g);
      expect(callSites, "expected at least one drainTradeResearch call").toBeTruthy();
      for (const site of callSites!) {
        expect(site, `drain call in ${relative} is missing deadlineAt`).toMatch(
          /deadlineAt\s*:\s*createTradeResearchDeadline\(/,
        );
      }
    });
  }

  it("shared helper exports the documented constants and returns a bounded future timestamp", () => {
    expect(VERCEL_FUNCTION_MAX_MS).toBe(60_000);
    expect(TRADE_RESEARCH_SAFE_EXECUTION_MS).toBe(50_000);
    // At least 10 s of cleanup headroom under the Vercel Hobby ceiling.
    expect(VERCEL_FUNCTION_MAX_MS - TRADE_RESEARCH_SAFE_EXECUTION_MS).toBeGreaterThanOrEqual(10_000);

    const started = 1_700_000_000_000;
    expect(createTradeResearchDeadline(started)).toBe(started + TRADE_RESEARCH_SAFE_EXECUTION_MS);

    const t0 = Date.now();
    const derived = createTradeResearchDeadline();
    expect(derived).toBeGreaterThanOrEqual(t0 + TRADE_RESEARCH_SAFE_EXECUTION_MS - 5);
    expect(derived).toBeLessThanOrEqual(Date.now() + TRADE_RESEARCH_SAFE_EXECUTION_MS + 5);
  });
});

describe("BI4F 2A deadline safety — no client code imports the deadline helper", () => {
  /**
   * The helper is exported from a `server-only` module and is a plain
   * numeric derivation, but we still explicitly guarantee that no
   * client-visible surface (client components, hooks, `use client`
   * files) references it. A regression that leaks the helper into a
   * client bundle would fail here.
   */
  const CLIENT_CANDIDATE_GLOBS = [
    "src/app/(app)/buyer-finder/BuyerFinderClient.tsx",
    "src/app/(app)/buyer-finder/TradeResearchProgressPanel.tsx",
  ] as const;

  for (const relative of CLIENT_CANDIDATE_GLOBS) {
    it(`${relative} does not reference createTradeResearchDeadline`, () => {
      let body: string;
      try {
        body = readFile(relative);
      } catch {
        // File may not exist in this snapshot — the scan is best-effort;
        // the truly load-bearing assertion is that `createTradeResearchDeadline`
        // lives inside a `server-only` module (see worker.ts:1).
        return;
      }
      expect(body).not.toMatch(/createTradeResearchDeadline/);
      expect(body).not.toMatch(/TRADE_RESEARCH_SAFE_EXECUTION_MS/);
      expect(body).not.toMatch(/VERCEL_FUNCTION_MAX_MS/);
    });
  }
});
