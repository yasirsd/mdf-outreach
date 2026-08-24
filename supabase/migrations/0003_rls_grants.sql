-- MDF Outreach — RLS + explicit grants for business tables.
-- anon: ZERO business data access.
-- authenticated: only rows belonging to the caller's active workspace,
-- and only via helper mdf.current_workspace_id() to prevent
-- workspace_id reassignment attacks.

-- Utility to (idempotently) apply the standard 4-verb membership policy set.
create or replace function mdf.__apply_workspace_rls(target regclass)
returns void
language plpgsql
as $$
declare tname text := target::text;
begin
  execute format('alter table %s enable row level security;', tname);

  execute format('drop policy if exists %I_select on %s;', tname, tname);
  execute format($p$create policy %I_select on %s
    for select to authenticated
    using (workspace_id = mdf.current_workspace_id());$p$, tname, tname);

  execute format('drop policy if exists %I_insert on %s;', tname, tname);
  execute format($p$create policy %I_insert on %s
    for insert to authenticated
    with check (workspace_id = mdf.current_workspace_id());$p$, tname, tname);

  execute format('drop policy if exists %I_update on %s;', tname, tname);
  execute format($p$create policy %I_update on %s
    for update to authenticated
    using (workspace_id = mdf.current_workspace_id())
    with check (workspace_id = mdf.current_workspace_id());$p$, tname, tname);

  execute format('drop policy if exists %I_delete on %s;', tname, tname);
  execute format($p$create policy %I_delete on %s
    for delete to authenticated
    using (workspace_id = mdf.current_workspace_id());$p$, tname, tname);
end;
$$;

select mdf.__apply_workspace_rls('public.buyers'::regclass);
select mdf.__apply_workspace_rls('public.campaigns'::regclass);
select mdf.__apply_workspace_rls('public.campaign_recipients'::regclass);
select mdf.__apply_workspace_rls('public.email_templates'::regclass);
select mdf.__apply_workspace_rls('public.email_assets'::regclass);
select mdf.__apply_workspace_rls('public.activity_events'::regclass);
select mdf.__apply_workspace_rls('public.workspace_settings'::regclass);

-- Explicit privileges: revoke everything, then grant only what the app needs.
do $$
declare t text;
begin
  for t in select unnest(array[
    'public.buyers',
    'public.campaigns',
    'public.campaign_recipients',
    'public.email_templates',
    'public.email_assets',
    'public.activity_events',
    'public.workspace_settings'
  ])
  loop
    execute format('revoke all on %s from anon, authenticated, public;', t);
    execute format('grant select, insert, update, delete on %s to authenticated;', t);
  end loop;
end $$;

-- anon must not read the workspace lookup either.
revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;
