-- MDF Outreach — one-time production bootstrap.
--
-- Run this **once**, from the Supabase Dashboard SQL editor, AFTER:
--   1. All migrations in supabase/migrations/ have been applied.
--   2. The first authorized MDF user has been created via
--      Supabase Dashboard → Authentication → Users → Add user.
--
-- Replace <MDF_USER_EMAIL> with the email you used above.
-- Do NOT commit any real email you use here (this file only holds a placeholder).

do $$
declare
  v_user_id   uuid;
  v_workspace uuid;
begin
  select id into v_user_id
    from auth.users
    where lower(email) = lower('<MDF_USER_EMAIL>')
    limit 1;

  if v_user_id is null then
    raise exception 'Auth user with email % not found. Create it first in Dashboard → Authentication → Users.', '<MDF_USER_EMAIL>';
  end if;

  insert into public.workspaces (name, slug)
  values ('MDF Exports & Imports', 'mdf')
  on conflict (slug) do update set name = excluded.name
  returning id into v_workspace;

  if v_workspace is null then
    select id into v_workspace from public.workspaces where slug = 'mdf' limit 1;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, active)
  values (v_workspace, v_user_id, 'owner', true)
  on conflict (workspace_id, user_id)
  do update set role = 'owner', active = true;

  insert into public.workspace_settings (workspace_id, onboarding_complete)
  values (v_workspace, true)
  on conflict (workspace_id) do nothing;

  raise notice 'MDF workspace ready: workspace_id=%, owner_user_id=%', v_workspace, v_user_id;
end $$;
