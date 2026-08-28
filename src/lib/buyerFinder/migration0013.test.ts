import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF2.1 — migration file guardrail. The migration is NOT applied by
 * this test; the operator applies it separately. These assertions
 * confirm the SQL file has the safety shape reported in the report.
 */

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0013_buyer_finder_search_runs.sql"),
  "utf8",
);

describe("BF2.1 migration 0013", () => {
  it("only adds new objects — never edits historical tables", () => {
    // No ALTER TABLE against pre-existing tables.
    for (const table of [
      "buyers",
      "campaigns",
      "campaign_recipients",
      "email_templates",
      "email_assets",
      "workspaces",
      "email_send_events",
      "buyer_candidates",
      "buyer_candidate_contacts",
      "buyer_candidate_product_matches",
    ]) {
      expect(SQL).not.toMatch(new RegExp(`alter table[\\s\\S]*${table}`, "i"));
    }
  });

  it("creates the buyer_finder_search_runs table with 'create table if not exists'", () => {
    expect(SQL).toMatch(/create table if not exists\s+public\.buyer_finder_search_runs/);
  });

  it("applies workspace-membership RLS through the existing mdf helper", () => {
    expect(SQL).toContain("mdf.__apply_workspace_rls('public.buyer_finder_search_runs'::regclass)");
  });

  it("revokes anon access and grants only to authenticated", () => {
    expect(SQL).toContain(
      "revoke all on public.buyer_finder_search_runs from anon, authenticated, public;",
    );
    expect(SQL).toContain(
      "grant select, insert, update, delete on public.buyer_finder_search_runs to authenticated;",
    );
  });

  it("enforces non-negative counters + processed ≤ usable", () => {
    for (const c of [
      "discovered_count >= 0",
      "usable_count >= 0",
      "processed_count >= 0",
      "created_count >= 0",
      "enriched_existing_count >= 0",
      "duplicate_count >= 0",
      "product_matches_added >= 0",
      "failure_count >= 0",
      "credits_used >= 0",
      "processed_count <= usable_count",
    ]) {
      expect(SQL).toContain(c);
    }
  });

  it("carries workspace-scoped indexes plus a one-active-run unique guard", () => {
    expect(SQL).toMatch(/buyer_finder_search_runs_workspace_created_idx/);
    expect(SQL).toMatch(/buyer_finder_search_runs_workspace_status_idx/);
    expect(SQL).toMatch(/create unique index if not exists buyer_finder_search_runs_one_active_per_workspace_idx/);
    expect(SQL).toMatch(/where status in \('queued', 'running'\)/i);
  });

  it("cost_class defaults to 'free' and is bounded to {free, paid}", () => {
    expect(SQL).toMatch(/cost_class\s+text not null default 'free'/);
    expect(SQL).toMatch(/cost_class in \('free', 'paid'\)/);
  });

  it("declares 5 run statuses and 5 stages, matching the domain contract", () => {
    for (const s of [
      "queued",
      "running",
      "completed",
      "partial",
      "failed",
    ]) {
      expect(SQL).toContain(`'${s}'`);
    }
    for (const s of [
      "preparing",
      "discovering",
      "processing_candidates",
      "finalizing",
      "complete",
    ]) {
      expect(SQL).toContain(`'${s}'`);
    }
  });
});
