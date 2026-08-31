import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0017_buyer_finder_free_enrichment_queue.sql"),
  "utf8",
);

describe("BF3C migration 0017", () => {
  it("is additive and does not edit historical migrations or apply itself", () => {
    expect(path.basename(path.resolve(process.cwd(), "supabase/migrations/0017_buyer_finder_free_enrichment_queue.sql"))).toBe(
      "0017_buyer_finder_free_enrichment_queue.sql",
    );
    expect(SQL).toMatch(/create table if not exists public\.buyer_finder_free_enrichment_jobs/);
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).toMatch(/Does NOT apply itself/);
  });

  it("stores one current-state job per workspace+candidate+capability", () => {
    expect(SQL).toMatch(/unique \(workspace_id, candidate_id, capability\)/);
    expect(SQL).toContain("public_company_contacts");
    expect(SQL).toContain("decision_makers");
    expect(SQL).not.toMatch(/reveal_handle/);
    expect(SQL).not.toMatch(/provider_ref/);
    expect(SQL).not.toMatch(/^\s*email\s/m);
  });

  it("uses workspace RLS, candidate FK, status/capability checks, and attempt_count >= 0", () => {
    expect(SQL).toContain("mdf.__apply_workspace_rls");
    expect(SQL).toMatch(/foreign key \(candidate_id, workspace_id\)/);
    expect(SQL).toContain("buyer_finder_free_enrichment_jobs_status_allowed");
    expect(SQL).toContain("buyer_finder_free_enrichment_jobs_capability_allowed");
    expect(SQL).toContain("attempt_count >= 0");
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.buyer_finder_free_enrichment_jobs to authenticated/);
  });

  it("enforces one processing job per capability and seeds backlog without network", () => {
    expect(SQL).toContain("buyer_finder_free_enrichment_jobs_one_processing_idx");
    expect(SQL).toMatch(/where status = 'processing'/);
    expect(SQL).toMatch(/insert into public\.buyer_finder_free_enrichment_jobs/);
    expect(SQL).toContain("already_complete");
    expect(SQL).not.toMatch(/http:\/\//i);
    expect(SQL).not.toMatch(/hunter\.io/i);
  });
});
