-- MDF Outreach — Phase D2/D3A hardening.
--
-- Database-backed idempotency for email test sends.
--
-- The in-process guard in src/lib/gmail/idempotency.ts was insufficient
-- for a serverless / multi-instance deployment: two concurrent requests
-- can execute on different Vercel functions and both pass the memory
-- check. This table gives us an atomic, cross-instance claim via a
-- single INSERT that either wins the unique constraint or does not.
--
-- The row's presence is the claim. If the INSERT succeeds we own the
-- nonce; if it violates the unique constraint the caller is a duplicate
-- and Gmail is NEVER called.

create table if not exists public.email_send_idempotency (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  nonce         text not null,
  claimed_by    uuid not null references auth.users(id) on delete set null,
  claimed_at    timestamptz not null default now(),
  primary key (workspace_id, nonce)
);

create index if not exists email_send_idempotency_claimed_at_idx
  on public.email_send_idempotency (claimed_at desc);

-- Workspace-scoped RLS using the standard membership helper.
select mdf.__apply_workspace_rls('public.email_send_idempotency'::regclass);

revoke all on public.email_send_idempotency from anon, authenticated, public;
grant select, insert, delete on public.email_send_idempotency to authenticated;

-- Housekeeping helper: prune rows older than 24 hours. The application
-- may call this opportunistically; keeping the table tiny is enough for
-- this phase.
create or replace function mdf.prune_send_idempotency(older_than interval default '24 hours')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.email_send_idempotency
    where claimed_at < now() - older_than;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function mdf.prune_send_idempotency(interval) from public;
grant execute on function mdf.prune_send_idempotency(interval) to authenticated;

notify pgrst, 'reload schema';
