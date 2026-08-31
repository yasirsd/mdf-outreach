import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0015_buyer_candidate_public_emails.sql"),
  "utf8",
);

describe("BF3A.5 migration 0015", () => {
  it("is additive and does not drop tables", () => {
    expect(SQL).toMatch(/create table if not exists public\.buyer_candidate_public_emails/);
    expect(SQL).toMatch(/alter table public\.buyer_candidates/);
    expect(SQL).not.toMatch(/drop table/i);
  });

  it("uniques email per candidate and one primary per candidate", () => {
    expect(SQL).toContain("buyer_candidate_public_emails_candidate_email_unique_idx");
    expect(SQL).toMatch(
      /buyer_candidate_public_emails \(workspace_id, candidate_id, lower\(email\)\)/,
    );
    expect(SQL).toContain("buyer_candidate_public_emails_one_primary_per_candidate_idx");
    expect(SQL).toMatch(/where is_primary = true/);
  });

  it("uses workspace RLS and authenticated grants, not service-role bypass", () => {
    expect(SQL).toContain("mdf.__apply_workspace_rls");
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.buyer_candidate_public_emails to authenticated/);
    expect(SQL).not.toMatch(/service_role/i);
    expect(SQL).toMatch(/revoke all on public\.buyer_candidate_public_emails from anon, authenticated, public/);
  });

  it("adds public_contacts_searched_at bookkeeping", () => {
    expect(SQL).toContain("public_contacts_searched_at timestamptz");
  });

  it("constrains mailbox_type, mailbox_kind, source, and nonblank email/url", () => {
    expect(SQL).toContain("buyer_candidate_public_emails_mailbox_type_allowed");
    expect(SQL).toContain("buyer_candidate_public_emails_mailbox_kind_allowed");
    expect(SQL).toContain("buyer_candidate_public_emails_source_allowed");
    expect(SQL).toContain("check (source = 'company_website')");
    expect(SQL).toContain("buyer_candidate_public_emails_email_not_blank");
    expect(SQL).toContain("buyer_candidate_public_emails_source_url_not_blank");
    expect(SQL).toContain("updated_at     timestamptz not null default now()");
  });

  it("uses a workspace-safe composite candidate FK", () => {
    expect(SQL).toMatch(/foreign key \(candidate_id, workspace_id\)/);
    expect(SQL).toContain("id             uuid primary key default gen_random_uuid()");
  });

  it("does not edit historical migrations — filename is 0015", () => {
    expect(path.basename(path.resolve(process.cwd(), "supabase/migrations/0015_buyer_candidate_public_emails.sql"))).toBe(
      "0015_buyer_candidate_public_emails.sql",
    );
  });

  it("adds public_contacts_searched_at as nullable so existing candidate rows stay compatible", () => {
    expect(SQL).toMatch(/add column if not exists public_contacts_searched_at timestamptz;/);
    expect(SQL).not.toMatch(/public_contacts_searched_at timestamptz not null/i);
  });
});
