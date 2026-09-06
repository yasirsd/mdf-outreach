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

  it("uses workspace RLS, composite FKs, and a SELECT-only grant on the linkage", () => {
    expect(SQL).toContain("mdf.__apply_workspace_rls");
    expect(SQL).toMatch(/foreign key \(candidate_id, workspace_id\)/);
    expect(SQL).toMatch(/foreign key \(buyer_id, workspace_id\)/);
    expect(SQL).toMatch(/foreign key \(contact_id, candidate_id, workspace_id\)/);
    expect(SQL).toMatch(/foreign key \(public_email_id, candidate_id, workspace_id\)/);
    // BF5A.1 — Issue 2. The conversion table is durable/immutable from the
    // app plane; INSERT/UPDATE/DELETE must NEVER be granted to authenticated.
    expect(SQL).toMatch(
      /grant select on public\.buyer_finder_candidate_conversions to authenticated/,
    );
    expect(SQL).not.toMatch(
      /grant select, insert, update, delete on public\.buyer_finder_candidate_conversions/,
    );
    expect(SQL).not.toMatch(
      /grant\s+(?:.*,\s*)?(?:insert|update|delete)\b[\s\S]{0,200}public\.buyer_finder_candidate_conversions[\s\S]{0,80}to\s+authenticated/i,
    );
    expect(SQL).toMatch(
      /revoke all on public\.buyer_finder_candidate_conversions from anon, authenticated, public/,
    );
    expect(SQL).not.toMatch(/service_role/i);
  });

  it("converts through an atomic SECURITY DEFINER RPC with a fixed search_path and workspace advisory lock", () => {
    expect(SQL).toContain("create or replace function public.convert_buyer_finder_candidate");
    // BF5A.1 — Issue 2. Only the RPC may INSERT into the linkage.
    expect(SQL).toContain("security definer");
    expect(SQL).not.toMatch(/^\s*security invoker\b/m);
    expect(SQL).toMatch(/set search_path\s*=\s*public,\s*mdf,\s*pg_temp/);
    // Workspace resolved from the caller's session, never a parameter.
    expect(SQL).toContain("mdf.current_workspace_id()");
    expect(SQL).not.toMatch(/p_workspace_id\b/);
    expect(SQL).toContain("pg_advisory_xact_lock");
    expect(SQL).toContain("buyer_type");
    expect(SQL).toContain("'Buyer Finder'");
    expect(SQL).toContain("'new'");
    expect(SQL).toContain("suppressed");
    expect(SQL).toContain("grant execute on function public.convert_buyer_finder_candidate");
    // Public/anon must not carry EXECUTE on a SECURITY DEFINER function.
    expect(SQL).toMatch(
      /revoke all on function public\.convert_buyer_finder_candidate\(uuid, text, uuid, uuid, uuid\)[\s\S]{0,80}from public, anon/,
    );
  });

  it("derives product_interest from an authoritative persisted product match, never from browser text (BF5A.1 Issue 1)", () => {
    // RPC signature no longer takes a free-text product label.
    expect(SQL).not.toMatch(/\bp_product_interest\b/);
    expect(SQL).toMatch(/p_product_match_id uuid default null/);
    // The RPC re-loads the product match filtered by (id, candidate_id, workspace_id).
    expect(SQL).toMatch(
      /from public\.buyer_candidate_product_matches[\s\S]{0,200}where id = p_product_match_id[\s\S]{0,200}candidate_id = p_candidate_id[\s\S]{0,200}workspace_id = v_ws/,
    );
    // Display label is whitelisted in SQL — mirrors src/lib/catalogue/products.ts.
    for (const label of [
      "Guntur Dry Red Chilli",
      "Banganapalli Mango",
      "Indian Pomegranate",
      "Indian Apples",
    ]) {
      expect(SQL).toContain(`'${label}'`);
    }
    // Never copies search intent or a candidate free-text buyer_type into buyer_type.
    expect(SQL).toMatch(/buyer_type[\s\S]{0,200}null/);
    // Never reads a candidate/search desired_buyer_types column as SQL.
    expect(SQL).not.toMatch(/\bv_candidate\.desired_buyer_types\b/);
    expect(SQL).not.toMatch(/\bdesired_buyer_types\s+text/);
  });

  it("rejects a mismatched product_match id and an unrecognized product_key rather than silently creating a Buyer with null product_interest (BF5A.1 final)", () => {
    // Isolate the product-authority block: it starts at the whitelist
    // comment and runs until the Buyer INSERT statement.
    const block =
      SQL.match(
        /if p_product_match_id is not null then[\s\S]*?end if;\s*end if;/,
      )?.[0] ?? "";
    expect(block).toContain("p_product_match_id");

    // Case 4 — mismatched id (right shape, wrong candidate or wrong
    // workspace) is caught by the composite-key SELECT + not-found path.
    expect(block).toMatch(
      /if not found then\s*return jsonb_build_object\('outcome',\s*'invalid_selection'\)/,
    );

    // Case 3 — persisted match exists but its product_key is not in the
    // canonical whitelist. Must NOT fall through to a Buyer INSERT with
    // product_interest=null; must return invalid_selection with a
    // discriminating reason so operators can diagnose it.
    expect(block).toMatch(
      /if v_product_interest is null then\s*return jsonb_build_object\(\s*'outcome',\s*'invalid_selection',\s*'reason',\s*'unsupported_product'/,
    );

    // The Buyer INSERT still uses the whitelist-derived value, not the raw
    // product_key or the parameter.
    expect(SQL).toMatch(/values \([\s\S]{0,600}v_product_interest,/);
  });

  it("gates revealed_personal_contact on a real personal reveal (BF5A.1 Issue 3)", () => {
    // Both proof gates must fire inside the revealed_personal_contact branch.
    const branch =
      SQL.match(
        /if p_source_kind = 'revealed_personal_contact' then[\s\S]*?elsif p_source_kind = 'public_company_email'/,
      )?.[0] ?? "";
    expect(branch).toContain("v_contact.revealed_at is null");
    expect(branch).toMatch(/v_contact\.email_type[\s\S]{0,40}<>\s*'personal'/);
    // Does NOT require decision-maker status; Ahmed/Natureland is valid.
    // (Comments in the branch may mention is_decision_maker as prose; the
    // gate we forbid is a SQL read of v_contact.is_decision_maker.)
    expect(branch).not.toMatch(/\bv_contact\.is_decision_maker\b/);
    // Does NOT require phone as a gate. Reading v_contact.phone_number for
    // storage is fine; blocking on it is not.
    expect(branch).not.toMatch(/v_contact\.phone_number[\s\S]{0,80}(?:is null|=\s*'')/);
    // Still requires a real @ email.
    expect(branch).toContain("position('@' in v_email) = 0");
  });

  it("rechecks duplicates inside the transaction using exact host comparison", () => {
    expect(SQL).toContain("mdf.normalize_host");
    expect(SQL).toContain("mdf.normalize_company_name");
    expect(SQL).not.toMatch(/like '%/);
    expect(SQL).toContain("^www\\.");
  });
});
