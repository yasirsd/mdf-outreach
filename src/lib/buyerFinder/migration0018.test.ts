import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0018_buyer_finder_candidate_conversion.sql"),
  "utf8",
);

describe("BF5A migration 0018", () => {
  it("is additive and does not edit historical migrations or apply itself", () => {
    expect(
      path.basename(
        path.resolve(process.cwd(), "supabase/migrations/0018_buyer_finder_candidate_conversion.sql"),
      ),
    ).toBe("0018_buyer_finder_candidate_conversion.sql");
    expect(SQL).toMatch(/Does NOT apply itself/);
    expect(SQL).toMatch(/create table if not exists public\.buyer_finder_candidate_conversions/);
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/update public\.buyer_candidates/i);
    expect(SQL).not.toMatch(/insert into public\.buyers[\s\S]{0,400}from public\.buyer_candidates/i);
  });

  it("does not auto-convert existing candidates or call the network", () => {
    expect(SQL).toContain("Does NOT convert existing candidates");
    expect(SQL).toContain("Does NOT create Buyers");
    expect(SQL).not.toMatch(/http:\/\//i);
    expect(SQL).not.toMatch(/hunter\.io/i);
    expect(SQL).not.toMatch(/gmail\.google|@\/lib\/gmail/i);
  });

  it("stores one conversion per candidate with source-kind shape constraints", () => {
    expect(SQL).toMatch(/unique \(candidate_id\)/);
    expect(SQL).toContain("revealed_personal_contact");
    expect(SQL).toContain("public_company_email");
    expect(SQL).toContain("company_only");
    expect(SQL).toContain("buyer_finder_candidate_conversions_source_kind_allowed");
    expect(SQL).toContain("buyer_finder_candidate_conversions_source_shape");
  });

  it("uses workspace RLS, composite FKs, and authenticated grants", () => {
    expect(SQL).toContain("mdf.__apply_workspace_rls");
    expect(SQL).toMatch(/foreign key \(candidate_id, workspace_id\)/);
    expect(SQL).toMatch(/foreign key \(buyer_id, workspace_id\)/);
    expect(SQL).toMatch(/foreign key \(contact_id, candidate_id, workspace_id\)/);
    expect(SQL).toMatch(/foreign key \(public_email_id, candidate_id, workspace_id\)/);
    expect(SQL).toMatch(
      /grant select, insert, update, delete on public\.buyer_finder_candidate_conversions to authenticated/,
    );
    expect(SQL).toMatch(
      /revoke all on public\.buyer_finder_candidate_conversions from anon, authenticated, public/,
    );
    expect(SQL).not.toMatch(/service_role/i);
  });

  it("converts through an atomic SECURITY INVOKER RPC with a workspace advisory lock", () => {
    expect(SQL).toContain("create or replace function public.convert_buyer_finder_candidate");
    expect(SQL).toContain("security invoker");
    expect(SQL).toContain("pg_advisory_xact_lock");
    expect(SQL).toContain("buyer_type");
    expect(SQL).toContain("'Buyer Finder'");
    expect(SQL).toContain("'new'");
    expect(SQL).toContain("suppressed");
    expect(SQL).toContain("grant execute on function public.convert_buyer_finder_candidate");
  });

  it("rechecks duplicates inside the transaction using exact host comparison", () => {
    expect(SQL).toContain("mdf.normalize_host");
    expect(SQL).toContain("mdf.normalize_company_name");
    expect(SQL).not.toMatch(/like '%/);
    expect(SQL).toContain("^www\\.");
  });
});
