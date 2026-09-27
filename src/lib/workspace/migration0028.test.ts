import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/0028_selected_workspace_context.sql"),
  "utf8",
).toLowerCase();
const VERIFY = readFileSync(
  join(process.cwd(), "supabase/verification/0028_selected_workspace_context_verify.sql"),
  "utf8",
).toLowerCase();

describe("migration 0028 selected workspace context", () => {
  it("persists one private selection per auth user with membership integrity", () => {
    expect(SQL).toContain("create table if not exists mdf.user_workspace_selection");
    expect(SQL).toContain("user_id uuid primary key references auth.users(id)");
    expect(SQL).toContain("references public.workspace_members(workspace_id, user_id)");
    expect(SQL).toContain("revoke all on table mdf.user_workspace_selection from public, anon, authenticated");
  });

  it("backfills exactly one active membership and never orders or limits a fallback", () => {
    expect(SQL).toContain("having count(*) = 1");
    const currentBody = SQL.match(/create or replace function mdf\.current_workspace_id\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(currentBody).toContain("mdf.user_workspace_selection");
    expect(currentBody).toContain("membership.active = true");
    expect(currentBody).not.toMatch(/order by|limit 1/);
  });

  it("switches only the authenticated caller to an active membership", () => {
    expect(SQL).toContain("v_user_id uuid := auth.uid()");
    expect(SQL).toContain("membership.user_id = v_user_id");
    expect(SQL).toContain("membership.workspace_id = p_workspace_id");
    expect(SQL).toContain("membership.active = true");
    expect(SQL).toContain("on conflict (user_id) do update");
    expect(SQL).not.toMatch(/p_user_id/);
  });

  it("denies anon and grants only authenticated RPC execution", () => {
    expect(SQL).toContain("revoke all on function public.set_current_workspace(uuid) from public, anon");
    expect(SQL).toContain("grant execute on function public.set_current_workspace(uuid) to authenticated");
  });

  it("ships rollback-only verification for backfill, switching, RLS, inactive and unauthorized cases", () => {
    expect(VERIFY).toContain("begin;");
    expect(VERIFY).toContain("rollback;");
    for (const phrase of [
      "multi-workspace user was auto-selected",
      "missing selection fell back",
      "switching did not change rls-visible rows",
      "unauthorized workspace selection succeeded",
      "inactive membership selection succeeded",
      "anon executed workspace selection rpc",
      "authenticated role modified private selections directly",
    ]) expect(VERIFY).toContain(phrase);
  });
});
