import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPORT_CHUNK_SIZE,
  ExportTooLargeError,
  MAX_EXPORT_ROWS,
} from "./exportTypes";

/**
 * F9-follow-up — filtered CSV export guardrails.
 *
 * The action itself relies on a live Supabase session, so behavioural
 * safety guarantees are asserted via source inspection.
 */

const SRC = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyers/exportAction.ts"),
  "utf8",
);

const VIEW = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/buyers/BuyersView.tsx"),
  "utf8",
);

describe("F9-follow-up exportFilteredBuyersAction — architecture guardrails", () => {
  it("declares 'use server'", () => {
    expect(SRC.split("\n")[0]).toContain('"use server"');
  });

  it("uses serverRepositories (auth-gated, RLS-scoped)", () => {
    expect(SRC).toContain("serverRepositories");
  });

  it("does NOT accept a workspaceId argument", () => {
    expect(SRC).not.toMatch(/workspaceId\??:/);
  });

  it("iterates listPaginated in bounded chunks — not one giant query", () => {
    expect(SRC).toContain("listPaginated");
    expect(SRC).toContain("EXPORT_CHUNK_SIZE");
    expect(EXPORT_CHUNK_SIZE).toBe(500);
  });

  it("safety cap = 25,000 rows and REFUSES beyond it instead of truncating", () => {
    expect(MAX_EXPORT_ROWS).toBe(25_000);
    expect(SRC).toContain("ExportTooLargeError");
  });

  it("emits CSV through buyersToCsv (which is formula-injection-safe)", () => {
    expect(SRC).toContain("buyersToCsv");
  });

  it("ExportTooLargeError carries the observed total and mentions the safety limit", () => {
    const e = new ExportTooLargeError(999_999);
    expect(e.total).toBe(999_999);
    expect(e.message).toContain("safety limit");
    expect(e.message).toContain("25,000");
  });
});

describe("F9-follow-up BuyersView — uses the new filtered export", () => {
  it("Export button calls exportFilteredBuyersAction with the current filters", () => {
    expect(VIEW).toContain("exportFilteredBuyersAction");
    // Filters are forwarded — search / status / country / product all
    // appear in the call site.
    expect(VIEW).toMatch(/search:\s*initialFilters\.search/);
    expect(VIEW).toMatch(/status:\s*initialFilters\.status/);
    expect(VIEW).toMatch(/country:\s*initialFilters\.country/);
    expect(VIEW).toMatch(/product:\s*initialFilters\.product/);
  });

  it("Export button no longer uses the pre-F9-followup client-side buyersToCsv path", () => {
    // The old label was "Export current page" via `mdf-buyers-page-N`.
    expect(VIEW).not.toContain("mdf-buyers-page-");
  });
});
