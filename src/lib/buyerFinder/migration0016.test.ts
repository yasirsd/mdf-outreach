import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0016_buyer_finder_personal_reveal.sql"),
  "utf8",
);

const EVENTS_TABLE = SQL.slice(
  SQL.indexOf("create table if not exists public.buyer_finder_contact_reveal_events"),
);

describe("BF3B.1 migration 0016", () => {
  it("is additive and does not drop tables or edit historical migrations", () => {
    expect(path.basename(path.resolve(process.cwd(), "supabase/migrations/0016_buyer_finder_personal_reveal.sql"))).toBe(
      "0016_buyer_finder_personal_reveal.sql",
    );
    expect(SQL).toMatch(/create table if not exists public\.buyer_finder_contact_reveal_events/);
    expect(SQL).toMatch(/alter table public\.buyer_candidate_contacts/);
    expect(SQL).not.toMatch(/drop table/i);
    expect(SQL).not.toMatch(/add column if not exists revealed_email/);
    expect(SQL).not.toMatch(/add column if not exists personal_email/);
  });

  it("adds phone_number and revealed_at as nullable so existing contacts stay compatible", () => {
    expect(SQL).toMatch(/add column if not exists phone_number text/);
    expect(SQL).toMatch(/add column if not exists revealed_at timestamptz/);
    expect(SQL).not.toMatch(/phone_number text not null/i);
    expect(SQL).not.toMatch(/revealed_at timestamptz not null/i);
  });

  it("rejects whitespace-only phone_number and error_code", () => {
    expect(SQL).toContain("buyer_candidate_contacts_phone_number_not_blank");
    expect(SQL).toMatch(/phone_number is null or btrim\(phone_number\) <> ''/);
    expect(SQL).toContain("buyer_finder_contact_reveal_events_error_code_not_blank");
    expect(SQL).toMatch(/error_code is null or btrim\(error_code\) <> ''/);
  });

  it("uses workspace RLS, authenticated grants, and contact-belongs-to-candidate FK", () => {
    expect(SQL).toContain("mdf.__apply_workspace_rls");
    expect(SQL).toMatch(
      /grant select, insert, update, delete on public\.buyer_finder_contact_reveal_events to authenticated/,
    );
    expect(SQL).not.toMatch(/service_role/i);
    expect(SQL).toMatch(/revoke all on public\.buyer_finder_contact_reveal_events from anon, authenticated, public/);
    expect(SQL).toContain("buyer_candidate_contacts_id_candidate_workspace_unique");
    expect(SQL).toMatch(/unique \(id, candidate_id, workspace_id\)/);
    expect(EVENTS_TABLE).toMatch(/foreign key \(candidate_id, workspace_id\)/);
    expect(EVENTS_TABLE).toMatch(/foreign key \(contact_id, candidate_id, workspace_id\)/);
    expect(EVENTS_TABLE).toMatch(
      /references public\.buyer_candidate_contacts \(id, candidate_id, workspace_id\)/,
    );
    expect(EVENTS_TABLE).not.toMatch(/foreign key \(contact_id, workspace_id\)/);
    expect(SQL).not.toContain("buyer_candidate_contacts_id_workspace_unique");
  });

  it("locks unresolved events including reconciliation_required; succeeded/failed are terminal", () => {
    expect(SQL).toContain("buyer_finder_contact_reveal_events_active_contact_idx");
    expect(SQL).toMatch(
      /where status in \(\s*'pending',\s*'processing',\s*'reconciliation_required'\s*\)/,
    );
    const uniqueWhere = SQL.match(
      /buyer_finder_contact_reveal_events_active_contact_idx[\s\S]*?where status in \(([\s\S]*?)\)/,
    )?.[1];
    expect(uniqueWhere).toContain("'pending'");
    expect(uniqueWhere).toContain("'processing'");
    expect(uniqueWhere).toContain("'reconciliation_required'");
    expect(uniqueWhere).not.toContain("'succeeded'");
    expect(uniqueWhere).not.toContain("'failed'");
    expect(SQL).toContain("buyer_finder_contact_reveal_events_credits_range");
    expect(SQL).toContain("credits_charged >= 0 and credits_charged <= 1");
    expect(SQL).toContain("buyer_finder_contact_reveal_events_provider_allowed");
    expect(SQL).toContain("check (provider = 'hunter')");
    expect(SQL).toContain("buyer_finder_contact_reveal_events_status_allowed");
  });

  it("does not persist reveal_handle or provider_ref on the event table", () => {
    expect(EVENTS_TABLE).not.toMatch(/^\s*reveal_handle\s/m);
    expect(EVENTS_TABLE).not.toMatch(/^\s*provider_ref\s/m);
    expect(EVENTS_TABLE).not.toMatch(/reveal_handle text/);
    expect(EVENTS_TABLE).not.toMatch(/provider_ref text/);
  });
});
