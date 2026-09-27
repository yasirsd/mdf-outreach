-- MUTATING TRANSACTIONAL VERIFICATION for migration 0028.
-- LOCAL / DISPOSABLE DATABASE ONLY. DO NOT RUN IN PRODUCTION.
-- Requires migrations through 0028 and at least three local auth.users rows.
-- Every fixture write is rolled back.

begin;

create temporary table verify_0028_users(position integer primary key, user_id uuid not null);
insert into verify_0028_users(position, user_id)
select row_number() over (order by created_at, id), id
from auth.users
order by created_at, id
limit 3;

do $$
begin
  if (select count(*) from verify_0028_users) <> 3 then
    raise exception '0028 verification requires three local auth.users rows';
  end if;
  if to_regclass('mdf.user_workspace_selection') is null then
    raise exception '0028 selection table is missing';
  end if;
  if to_regprocedure('public.set_current_workspace(uuid)') is null then
    raise exception '0028 switch RPC is missing';
  end if;
  if has_function_privilege('anon', 'public.set_current_workspace(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.set_current_workspace(uuid)', 'EXECUTE') then
    raise exception '0028 switch RPC grants are incorrect';
  end if;
end
$$;

insert into public.workspaces(id, name, slug) values
  ('28000000-0000-4000-8000-00000000000a', '0028 Workspace A', 'verify-0028-a'),
  ('28000000-0000-4000-8000-00000000000b', '0028 Workspace B', 'verify-0028-b'),
  ('28000000-0000-4000-8000-00000000000c', '0028 Workspace C', 'verify-0028-c');

insert into public.workspace_members(workspace_id, user_id, role, active)
select '28000000-0000-4000-8000-00000000000a', user_id, 'owner', true
from verify_0028_users where position = 1
union all
select '28000000-0000-4000-8000-00000000000a', user_id, 'owner', true
from verify_0028_users where position = 2
union all
select '28000000-0000-4000-8000-00000000000b', user_id, 'member', true
from verify_0028_users where position = 2
union all
select '28000000-0000-4000-8000-00000000000c', user_id, 'owner', true
from verify_0028_users where position = 3
on conflict (workspace_id, user_id) do update set active = excluded.active;

delete from mdf.user_workspace_selection
where user_id in (select user_id from verify_0028_users);

-- Re-run the migration's safe backfill against the isolated users.
insert into mdf.user_workspace_selection(user_id, workspace_id)
select membership.user_id, (array_agg(membership.workspace_id order by membership.workspace_id))[1]
from public.workspace_members as membership
where membership.active = true
  and membership.user_id in (select user_id from verify_0028_users)
group by membership.user_id
having count(*) = 1
on conflict (user_id) do nothing;

do $$
declare
  v_single uuid := (select user_id from verify_0028_users where position = 1);
  v_multi uuid := (select user_id from verify_0028_users where position = 2);
begin
  if (select workspace_id from mdf.user_workspace_selection where user_id = v_single)
     <> '28000000-0000-4000-8000-00000000000a' then
    raise exception 'single-workspace user was not safely backfilled';
  end if;
  if exists (select 1 from mdf.user_workspace_selection where user_id = v_multi) then
    raise exception 'multi-workspace user was auto-selected';
  end if;
end
$$;

insert into public.buyer_candidates(id, workspace_id, company_name, country) values
  ('28000000-0000-4000-8000-00000000001a', '28000000-0000-4000-8000-00000000000a', '0028 Candidate A', 'India'),
  ('28000000-0000-4000-8000-00000000001b', '28000000-0000-4000-8000-00000000000b', '0028 Candidate B', 'India');

grant select on verify_0028_users to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from verify_0028_users where position = 2), true);

do $$
declare v_count integer;
begin
  if mdf.current_workspace_id() is not null then
    raise exception 'missing selection fell back to a membership';
  end if;
  select count(*) into v_count from public.buyer_candidates;
  if v_count <> 0 then raise exception 'RLS exposed rows without a selection'; end if;
end
$$;

select public.set_current_workspace('28000000-0000-4000-8000-00000000000a');
do $$
declare v_count integer;
begin
  if mdf.current_workspace_id() <> '28000000-0000-4000-8000-00000000000a' then
    raise exception 'explicit selection A did not resolve';
  end if;
  select count(*) into v_count from public.buyer_candidates;
  if v_count <> 1 or not exists (
    select 1 from public.buyer_candidates where id = '28000000-0000-4000-8000-00000000001a'
  ) then raise exception 'RLS did not expose only workspace A'; end if;
end
$$;

select public.set_current_workspace('28000000-0000-4000-8000-00000000000b');
do $$
declare v_count integer;
begin
  if mdf.current_workspace_id() <> '28000000-0000-4000-8000-00000000000b' then
    raise exception 'switching to B did not resolve';
  end if;
  select count(*) into v_count from public.buyer_candidates;
  if v_count <> 1 or not exists (
    select 1 from public.buyer_candidates where id = '28000000-0000-4000-8000-00000000001b'
  ) then raise exception 'switching did not change RLS-visible rows'; end if;
end
$$;

do $$
begin
  begin
    perform public.set_current_workspace('28000000-0000-4000-8000-00000000000c');
    raise exception 'unauthorized workspace selection succeeded';
  exception when sqlstate '42501' then
    if sqlerrm <> 'WORKSPACE_SELECTION_FORBIDDEN' then raise; end if;
  end;
  begin
    update mdf.user_workspace_selection
    set workspace_id = '28000000-0000-4000-8000-00000000000a';
    raise exception 'authenticated role modified private selections directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
update public.workspace_members
set active = false
where user_id = (select user_id from verify_0028_users where position = 2)
  and workspace_id = '28000000-0000-4000-8000-00000000000b';

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from verify_0028_users where position = 2), true);
do $$
begin
  if mdf.current_workspace_id() is not null then
    raise exception 'inactive selected membership remained authoritative';
  end if;
  begin
    perform public.set_current_workspace('28000000-0000-4000-8000-00000000000b');
    raise exception 'inactive membership selection succeeded';
  exception when sqlstate '42501' then
    if sqlerrm <> 'WORKSPACE_SELECTION_FORBIDDEN' then raise; end if;
  end;
end
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.set_current_workspace('28000000-0000-4000-8000-00000000000a');
    raise exception 'anon executed workspace selection RPC';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
rollback;
