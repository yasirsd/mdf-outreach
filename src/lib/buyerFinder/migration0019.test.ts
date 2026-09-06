import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BF5B-final — migration 0019 enforces "email required" for Buyer
 * conversion at the database layer. It must:
 *   • CREATE OR REPLACE the conversion RPC with source_kind whitelist
 *     restricted to the two email-bearing kinds and reject company_only.
 *   • Add an additive CHECK on buyer_finder_candidate_conversions.
 *   • Preserve every BF5A.1 authority + isolation invariant.
 *   • NOT touch the Buyers workspace/email unique index (that historical
 *     rule is what makes email='' a duplicate; keep it).
 *   • NOT edit 0018 or any prior migration.
 */

const HERE = process.cwd();
const M18 = readFileSync(
  path.resolve(HERE, "supabase/migrations/0018_buyer_finder_candidate_conversion.sql"),
  "utf8",
);
const M19 = readFileSync(
  path.resolve(HERE, "supabase/migrations/0019_buyer_email_required_conversion.sql"),
  "utf8",
);
const ACTIVE_M19 = M19.replace(/--[^\n]*/g, "");
const PREFLIGHT = readFileSync(
  path.resolve(HERE, "supabase/tests/preflight_0019_buyer_email_required.sql"),
  "utf8",
);

describe("BF5B-final migration 0019", () => {
  it("is additive, does not apply itself, and does not edit 0018 in place", () => {
    expect(M19).toMatch(/Does NOT apply itself/i);
    // A useful proxy that 0018 wasn't touched: BF5A.1 wording remains
    // present unchanged.
    expect(M18).toMatch(/BF5A\.1 — Issue 3: a "revealed personal contact" must actually be/);
    expect(M18).toContain("security definer");
  });

  it("does NOT drop or replace the Buyers workspace/email unique index and does NOT create a partial empty-email index", () => {
    expect(M19).not.toMatch(/drop index[\s\S]{0,80}buyers_workspace_email_unique_idx/i);
    expect(M19).not.toMatch(/create unique index[\s\S]{0,200}on public\.buyers/i);
    expect(M19).not.toMatch(/where btrim\(email\)\s*<>\s*''/);
    expect(M19).not.toMatch(/buyers_workspace_nonempty_email_unique_idx/);
    // Buyers.email NOT NULL is not touched either.
    expect(M19).not.toMatch(/alter table[\s\S]{0,60}public\.buyers[\s\S]{0,200}email[\s\S]{0,40}drop not null/i);
  });

  it("stages a global nonblank Buyer-email CHECK without scanning or rewriting historical rows", () => {
    expect(M19).toMatch(
      /alter table public\.buyers\s+add constraint buyers_email_not_blank\s+check \(btrim\(email\) <> ''\) not valid/,
    );
    expect(ACTIVE_M19).not.toMatch(/validate constraint buyers_email_not_blank/i);
    expect(ACTIVE_M19).not.toMatch(/update public\.buyers/i);
  });

  it("adds an additive CHECK constraint restricting linkage source_kind to the two email-bearing kinds", () => {
    expect(M19).toMatch(
      /alter table public\.buyer_finder_candidate_conversions[\s\S]{0,200}add constraint buyer_finder_candidate_conversions_source_kind_email_required[\s\S]{0,200}check \(source_kind in \(\s*'revealed_personal_contact',\s*'public_company_email'\s*\)\) not valid/,
    );
    // Idempotent add — safe to re-run.
    expect(M19).toMatch(/exception when duplicate_object then null/);
    // Existing constraint from 0018 is not dropped here.
    expect(M19).not.toMatch(/drop constraint[\s\S]{0,120}source_kind_allowed/i);
  });

  it("does NOT rewrite existing conversion linkage or Buyer rows", () => {
    expect(M19).not.toMatch(/update public\.buyer_finder_candidate_conversions/i);
    expect(M19).not.toMatch(/update public\.buyers/i);
    expect(M19).not.toMatch(/delete from public\.(buyers|buyer_finder_candidate_conversions)/i);
    expect(M19).not.toMatch(/insert into public\.buyers[\s\S]{0,400}from public\.buyer_candidates/i);
  });

  it("CREATE OR REPLACE's the conversion RPC with the identical BF5A.1-hardened signature", () => {
    expect(M19).toContain("create or replace function public.convert_buyer_finder_candidate");
    expect(M19).toMatch(
      /convert_buyer_finder_candidate\(\s*p_candidate_id uuid,\s*p_source_kind text,\s*p_contact_id uuid default null,\s*p_public_email_id uuid default null,\s*p_product_match_id uuid default null\s*\)/,
    );
    expect(M19).toContain("security definer");
    expect(M19).not.toMatch(/^\s*security invoker\b/m);
    expect(M19).toMatch(/set search_path\s*=\s*public,\s*mdf,\s*pg_temp/);
    expect(M19).toContain("mdf.current_workspace_id()");
    expect(M19).not.toMatch(/\bp_workspace_id\b/);
  });

  it("removes company_only from the RPC's source_kind whitelist", () => {
    // The RPC's source_kind guard now allows only two values (comments
    // may still describe the removed one in prose).
    expect(M19).toMatch(
      /p_source_kind not in\s*\(\s*'revealed_personal_contact',\s*'public_company_email'\s*\)/,
    );
    // The elsif-into-else refactor of the branch must never re-introduce
    // a company_only source-kind literal as a live SQL string tag.
    const activeSql = M19.replace(/--[^\n]*/g, ""); // strip line comments
    expect(activeSql).not.toMatch(/'company_only'/);
  });

  it("requires a persisted structurally usable email in both branches before every Buyer INSERT", () => {
    // Extract semantic branches by their stable source-kind markers. This
    // deliberately does not assume that `end if` is immediately before
    // `else`; the revealed branch assigns name and phone after validating.
    const revealedStart = M19.indexOf("if p_source_kind = 'revealed_personal_contact' then");
    const publicStart = M19.indexOf("else\n    -- public_company_email", revealedStart);
    const finalGuardStart = M19.indexOf("-- BF5B-final: belt-and-braces guard", publicStart);
    const buyerInsert = M19.indexOf("insert into public.buyers", finalGuardStart);
    expect(revealedStart).toBeGreaterThan(-1);
    expect(publicStart).toBeGreaterThan(revealedStart);
    expect(finalGuardStart).toBeGreaterThan(publicStart);
    expect(buyerInsert).toBeGreaterThan(finalGuardStart);

    const usableEmailCheck =
      /v_email !~ '\^\[\^\[:space:\]@\]\+@\[\^\[:space:\]@\]\+\[\.\]\[\^\[:space:\]@\]\+\$'/;
    const revealed = M19.slice(revealedStart, publicStart);
    expect(revealed).toMatch(
      /from public\.buyer_candidate_contacts[\s\S]*?candidate_id = p_candidate_id[\s\S]*?workspace_id = v_ws/,
    );
    expect(revealed).toContain("v_contact.revealed_at is null");
    expect(revealed).toMatch(/v_contact\.email_type[\s\S]{0,40}<> 'personal'/);
    expect(revealed).toMatch(usableEmailCheck);

    const publicBranch = M19.slice(publicStart, finalGuardStart);
    expect(publicBranch).toMatch(
      /from public\.buyer_candidate_public_emails[\s\S]*?candidate_id = p_candidate_id[\s\S]*?workspace_id = v_ws/,
    );
    expect(publicBranch).toMatch(usableEmailCheck);

    const finalGuard = M19.slice(finalGuardStart, buyerInsert);
    expect(finalGuard).toMatch(usableEmailCheck);
    expect(finalGuard).toContain("return jsonb_build_object('outcome', 'invalid_selection')");
    // Never falls through to an assignment that deliberately creates a
    // blank Buyer email (the historical company_only branch is gone).
    expect(M19).not.toMatch(/v_email\s*:=\s*''\s*;/);
  });

  it("preserves BF5A.1 product authority + revealed-personal proof", () => {
    // Whitelist labels present.
    expect(M19).toContain("'Guntur Dry Red Chilli'");
    expect(M19).toContain("'Banganapalli Mango'");
    expect(M19).toContain("'Indian Pomegranate'");
    expect(M19).toContain("'Indian Apples'");
    // unsupported_product reason preserved.
    expect(M19).toMatch(/'unsupported_product'/);
    // Revealed-personal proof gates.
    expect(M19).toContain("v_contact.revealed_at is null");
    expect(M19).toMatch(/v_contact\.email_type[\s\S]{0,40}<>\s*'personal'/);
    // No candidate-side desired_buyer_types read.
    expect(M19).not.toMatch(/\bv_candidate\.desired_buyer_types\b/);
  });

  it("preserves dedupe, advisory lock, and unique-violation recovery", () => {
    expect(M19).toContain("mdf.normalize_host");
    expect(M19).toContain("mdf.normalize_company_name");
    expect(M19).toContain("pg_advisory_xact_lock");
    expect(M19).toMatch(/exception\s+when unique_violation then/);
  });

  it("keeps EXECUTE granted only to authenticated on the 5-arg signature; public/anon revoked", () => {
    expect(M19).toMatch(
      /revoke all on function public\.convert_buyer_finder_candidate\(uuid, text, uuid, uuid, uuid\)[\s\S]{0,80}from public, anon/,
    );
    expect(M19).toMatch(
      /grant execute on function public\.convert_buyer_finder_candidate\(uuid, text, uuid, uuid, uuid\)[\s\S]{0,80}to authenticated/,
    );
  });

  it("does not touch the conversion linkage's SELECT-only grant established by 0018", () => {
    expect(M19).not.toMatch(/grant\s+[^;]*on public\.buyer_finder_candidate_conversions/i);
    expect(M19).not.toMatch(/revoke\s+[^;]*on public\.buyer_finder_candidate_conversions/i);
    expect(M18).toMatch(
      /grant select on public\.buyer_finder_candidate_conversions to authenticated/,
    );
    expect(M18).not.toMatch(
      /grant select, insert, update, delete on public\.buyer_finder_candidate_conversions/,
    );
  });

  it("ships an exact read-only historical-data preflight", () => {
    expect(PREFLIGHT).toContain("count(*)::bigint");
    expect(PREFLIGHT).toContain("group by source_kind");
    expect(PREFLIGHT).toContain("where source_kind = 'company_only'");
    expect(PREFLIGHT).toContain("where btrim(email) = ''");
    const active = PREFLIGHT.replace(/--[^\n]*/g, "");
    expect(active).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|call)\b/i);
  });
});
