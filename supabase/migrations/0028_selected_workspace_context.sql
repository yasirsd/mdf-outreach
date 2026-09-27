-- MDF Outreach — canonical selected-workspace context.
-- Additive only. Do not apply automatically; review and deploy manually.

create table if not exists mdf.user_workspace_selection (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete cascade
);

revoke all on table mdf.user_workspace_selection from public, anon, authenticated;
revoke all on schema mdf from public, anon;
grant usage on schema mdf to authenticated;

-- A single active membership is unambiguous and can be migrated safely.
-- Users with zero or multiple active memberships deliberately remain unset.
insert into mdf.user_workspace_selection(user_id, workspace_id)
select user_id, (array_agg(workspace_id order by workspace_id))[1]
from public.workspace_members
where active = true
group by user_id
having count(*) = 1
on conflict (user_id) do nothing;

create or replace function mdf.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select selection.workspace_id
  from mdf.user_workspace_selection as selection
  join public.workspace_members as membership
    on membership.user_id = selection.user_id
   and membership.workspace_id = selection.workspace_id
   and membership.active = true
  where selection.user_id = (select auth.uid())
$$;

revoke all on function mdf.current_workspace_id() from public, anon;
grant execute on function mdf.current_workspace_id() to authenticated;

create or replace function public.set_current_workspace(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'WORKSPACE_SELECTION_UNAUTHENTICATED';
  end if;

  if not exists (
    select 1
    from public.workspace_members as membership
    where membership.user_id = v_user_id
      and membership.workspace_id = p_workspace_id
      and membership.active = true
  ) then
    raise exception using
      errcode = '42501',
      message = 'WORKSPACE_SELECTION_FORBIDDEN';
  end if;

  insert into mdf.user_workspace_selection(user_id, workspace_id, selected_at, updated_at)
  values (v_user_id, p_workspace_id, now(), now())
  on conflict (user_id) do update
    set workspace_id = excluded.workspace_id,
        selected_at = excluded.selected_at,
        updated_at = excluded.updated_at;

  return p_workspace_id;
end;
$$;

revoke all on function public.set_current_workspace(uuid) from public, anon;
grant execute on function public.set_current_workspace(uuid) to authenticated;

notify pgrst, 'reload schema';
