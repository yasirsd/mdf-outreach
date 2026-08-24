-- MDF Outreach — workspaces + membership + recursion-safe helpers.
-- Executed once. Idempotent-safe with IF NOT EXISTS.

create extension if not exists pgcrypto;

create schema if not exists mdf;

--
-- workspaces: one row per MDF workspace. In production there is a single
-- row representing MDF Exports & Imports; the design keeps room for
-- future isolated environments.
--
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

--
-- workspace_members: the authorization allowlist. A Supabase Auth user
-- is only granted access to business data when they have an active row
-- here for a workspace.
--
create table if not exists public.workspace_members (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'member')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_active_idx
  on public.workspace_members (user_id) where active;

--
-- SECURITY DEFINER helper. Returns the caller's single active workspace_id
-- without triggering RLS on workspace_members itself. RLS policies on the
-- business tables call this function.
--
create or replace function mdf.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid() and active = true
  order by created_at asc
  limit 1
$$;

revoke all on function mdf.current_workspace_id() from public;
grant execute on function mdf.current_workspace_id() to authenticated;

-- Companion boolean helper used in WITH CHECK clauses.
create or replace function mdf.is_member_of(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
    where user_id = auth.uid()
      and workspace_id = target_workspace_id
      and active = true
  )
$$;

revoke all on function mdf.is_member_of(uuid) from public;
grant execute on function mdf.is_member_of(uuid) to authenticated;

--
-- Enable RLS on workspaces + workspace_members. Direct writes to these
-- tables are always forbidden from the app; provisioning happens via
-- Supabase Dashboard SQL editor (service_role) per docs/supabase-setup.md.
--
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Members can SELECT the workspaces they belong to (needed for the UI to
-- show the workspace name). No INSERT/UPDATE/DELETE from the app.
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select
  to authenticated
  using ( id = mdf.current_workspace_id() );

-- Members can SELECT their own membership row (for UI). Nothing else.
-- Deliberately no INSERT/UPDATE/DELETE policy: prevents a normal member
-- from adding themselves to another workspace or elevating role.
drop policy if exists workspace_members_select_self on public.workspace_members;
create policy workspace_members_select_self on public.workspace_members
  for select
  to authenticated
  using ( user_id = auth.uid() );

-- Explicit privileges: anon has zero access.
revoke all on public.workspaces from anon, authenticated, public;
revoke all on public.workspace_members from anon, authenticated, public;

grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
