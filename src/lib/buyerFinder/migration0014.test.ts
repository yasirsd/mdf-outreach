import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0014_buyer_candidate_contacts_person_discovery.sql"),
  "utf8",
);

describe("BF3A migration 0014", () => {
  it("does not edit historical migration files — this is additive SQL only", () => {
    expect(SQL).toMatch(/alter table public\.buyer_candidate_contacts/);
    expect(SQL).toMatch(/alter table public\.buyer_candidates/);
    expect(SQL).not.toMatch(/drop table/i);
  });

  it("relaxes email uniqueness from workspace-wide to candidate-scoped", () => {
    expect(SQL).toContain("drop index if exists public.buyer_candidate_contacts_workspace_email_unique_idx");
    expect(SQL).toMatch(
      /create unique index if not exists buyer_candidate_contacts_candidate_email_unique_idx/,
    );
    expect(SQL).toMatch(
      /buyer_candidate_contacts \(workspace_id, candidate_id, lower\(business_email\)\)/,
    );
  });

  it("adds provider_ref plus masked-person metadata columns", () => {
    for (const col of [
      "provider_ref",
      "department",
      "seniority",
      "is_decision_maker",
      "email_type",
      "verification_status",
      "full_name_available",
      "linkedin_available",
      "phone_available",
      "evidence jsonb",
    ]) {
      expect(SQL).toContain(col);
    }
  });

  it("uniques provider_ref per workspace + source when present", () => {
    expect(SQL).toContain("buyer_candidate_contacts_provider_ref_unique_idx");
    expect(SQL).toMatch(/\(workspace_id, source, provider_ref\)/);
    expect(SQL).toMatch(/where provider_ref is not null/);
  });

  it("adds people_searched_at / people_has_more on candidates", () => {
    expect(SQL).toContain("people_searched_at timestamptz");
    expect(SQL).toContain("people_has_more boolean not null default false");
  });

  it("does not re-apply RLS helpers — existing table policies inherit", () => {
    expect(SQL).not.toContain("mdf.__apply_workspace_rls");
    expect(SQL).not.toMatch(/create policy/i);
  });

  it("describes provider_ref as an opaque current reveal handle, not permanent identity", () => {
    expect(SQL).toMatch(/opaque provider reference \/ current reveal handle/i);
    expect(SQL).toMatch(/NOT permanent MDF person identity/i);
  });

  it("enforces at most one primary contact per candidate", () => {
    expect(SQL).toContain("buyer_candidate_contacts_one_primary_per_candidate_idx");
    expect(SQL).toMatch(
      /on public\.buyer_candidate_contacts \(workspace_id, candidate_id\)/,
    );
    expect(SQL).toMatch(/where is_primary = true/);
  });

  it("requires evidence JSON to be an array", () => {
    expect(SQL).toContain("buyer_candidate_contacts_evidence_is_array");
    expect(SQL).toContain("jsonb_typeof(evidence) = 'array'");
  });
});
