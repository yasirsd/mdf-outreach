import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F9 — recipient candidate search safety guardrails.
 *
 * The server action is auth-gated and uses request-scoped repositories,
 * so it depends on a live Supabase session. These tests inspect the
 * shipped source to prove the safety invariants:
 *
 *   1. Uses serverRepositories() (RLS-scoped).
 *   2. Validates campaignId as UUID before any query.
 *   3. Never trusts a client-provided workspaceId.
 *   4. Excludes existing recipients server-side.
 *   5. Uses listPaginated (bounded), not list().
 *   6. Result is capped by MAX_PAGE_SIZE.
 */

const SRC = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/campaigns/[id]/recipients/actions.ts"),
  "utf8",
);
const PAGE = readFileSync(
  path.resolve(process.cwd(), "src/app/(app)/campaigns/[id]/recipients/page.tsx"),
  "utf8",
);

describe("F9 searchAvailableRecipientsAction — safety", () => {
  it("declares 'use server' at the top", () => {
    expect(SRC.split("\n")[0]).toContain('"use server"');
  });

  it("uses serverRepositories() — RLS-scoped by session", () => {
    expect(SRC).toContain("serverRepositories");
  });

  it("does NOT accept a workspaceId argument", () => {
    // The input interface has no workspaceId; the server derives it.
    expect(SRC).not.toMatch(/workspaceId\??:/);
  });

  it("validates campaignId as a UUID before any query", () => {
    expect(SRC).toContain("UUID_RE");
    expect(SRC).toMatch(/if\s*\(!\s*UUID_RE\.test\(input\.campaignId\)/);
  });

  it("excludes existing recipients SERVER-SIDE (uses recipients.listByCampaign, not client-supplied)", () => {
    expect(SRC).toContain("recipients.listByCampaign(input.campaignId)");
    expect(SRC).toContain("excludedIds");
  });

  it("uses listPaginated (bounded), NOT list() (unbounded)", () => {
    expect(SRC).toContain("listPaginated");
    expect(SRC).not.toMatch(/repos\.buyers\.list\(\)/);
  });

  it("caps result size at MAX_PAGE_SIZE = 100 rows", () => {
    expect(SRC).toContain("MAX_PAGE_SIZE = 100");
  });

  it("Recipients page no longer downloads the full workspace buyer roster", () => {
    // Post-F9 the page loads only recipients + their buyer records
    // via listByIds. `list()` on buyers must be gone from this file.
    expect(PAGE).not.toMatch(/repos\.buyers\.list\(\)/);
    expect(PAGE).toContain("listByIds");
  });
});
