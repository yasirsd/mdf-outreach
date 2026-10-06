-- TH07 DEFECT 04 — Supabase pg_cron wake-up for retry-due trade-research jobs.
--
-- Decisive production evidence:
--   • job be269328-44d0-425b-803d-4c7900fd1a51 has
--       status='running', lease_owner=null, next_attempt_at<=now()
--   • production claim_buyer_trade_research_job directly ran against that
--     row returns claim_rank=1 (running_lease_free) — the DB state
--     machine ACCEPTS the retry; the issue is NOT the predicate.
--   • /api/buyer-finder/free-enrichment/drain is a DIFFERENT subsystem
--     and must not process trade-research jobs.
--   • /api/cron/trade-research-drain is wired to Vercel Cron, but
--     vercel.json schedules it ONCE PER DAY (03:00 UTC) due to Vercel
--     Hobby cron limits.
--   • Nothing wakes the trade-research worker in the 30–120 s window a
--     retryable failure needs. Retries sit idle until the next 03:00 UTC
--     daily tick.
--
-- Minimum correct ₹0 fix: schedule a once-per-minute invocation of the
-- EXISTING authenticated internal drain endpoint
--   POST /api/internal/trade-research/drain
--   Authorization: Bearer <TRADE_RESEARCH_DRAIN_SECRET>
-- using Supabase pg_cron + pg_net. Both extensions are free on all
-- Supabase plans. The drain endpoint already:
--   • rejects unauthorized callers (401),
--   • is idempotent — returns {outcome:"no_work"} on empty queue,
--   • bounds itself with INLINE_KICK_HARD_CEILING_MS and the shared
--     deadline helper so one tick cannot run beyond the function
--     ceiling.
--
-- This migration ONLY defines infrastructure:
--   1. enables pg_cron + pg_net (idempotent),
--   2. creates a `public.schedule_trade_research_drain(url, secret, schedule)`
--      helper the operator calls ONCE from the Supabase SQL console
--      with the production URL + the same TRADE_RESEARCH_DRAIN_SECRET
--      that Vercel env carries. Nothing secret is committed to this
--      file.
--   3. creates a matching `public.unschedule_trade_research_drain()`
--      so operators can rotate / remove the schedule.
--
-- The daily Vercel Cron entry in vercel.json remains in place as a
-- recovery sweeper — Supabase pg_cron is the primary retry waker.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Allow service_role to USAGE the cron + net schemas so the helper and
-- any audits can be run. (pg_cron grants `cron` USAGE to the owner by
-- default; Supabase's `postgres` owner creates these objects. The
-- grants below are idempotent and additive.)
grant usage on schema cron to service_role;
grant usage on schema net to service_role;

-- The helper is SECURITY DEFINER so an operator calling it from the
-- SQL console (as `postgres`) creates/updates the cron entry under
-- the owner that owns pg_cron. We NEVER grant EXECUTE to public /
-- anon / authenticated so unauthenticated callers cannot register
-- or alter the schedule.
create or replace function public.schedule_trade_research_drain(
  p_url      text,
  p_secret   text,
  p_schedule text default '* * * * *'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
begin
  if nullif(trim(p_url), '') is null then
    raise exception 'TRADE_RESEARCH_DRAIN_URL_REQUIRED';
  end if;
  if p_url !~ '^https://' then
    raise exception 'TRADE_RESEARCH_DRAIN_URL_MUST_BE_HTTPS';
  end if;
  if nullif(trim(p_secret), '') is null then
    raise exception 'TRADE_RESEARCH_DRAIN_SECRET_REQUIRED';
  end if;

  -- Idempotent: remove any prior schedule with the same name.
  perform cron.unschedule(j.jobid)
    from cron.job j
    where j.jobname = 'trade_research_drain';

  -- Register a new cron entry. The command is a bounded, authenticated
  -- POST that returns 200/202 immediately (pg_net is async) and lets
  -- the Vercel function run on its own timeout. The 50_000 ms
  -- timeout_milliseconds matches the drain route's INLINE_KICK_HARD_CEILING_MS.
  select cron.schedule(
    'trade_research_drain',
    p_schedule,
    format($fmt$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 50000
      );
    $fmt$, p_url, p_secret)
  ) into v_job_id;
  return v_job_id;
end
$$;

create or replace function public.unschedule_trade_research_drain()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from cron.job
    where jobname = 'trade_research_drain';
  if v_count = 0 then
    return false;
  end if;
  perform cron.unschedule(j.jobid)
    from cron.job j
    where j.jobname = 'trade_research_drain';
  return true;
end
$$;

revoke all on function public.schedule_trade_research_drain(text, text, text) from public, anon, authenticated;
revoke all on function public.unschedule_trade_research_drain() from public, anon, authenticated;
-- No grant to service_role either: these helpers are operator-only
-- and are called from the Supabase SQL console as `postgres`. The
-- secret value NEVER leaves the Postgres instance.

-- Reader helper so an operator (or a smoke test) can confirm the
-- cron entry EXISTS without reading the command (which contains the
-- bearer secret). Returns schedule + nextrun only.
create or replace function public.describe_trade_research_drain_schedule()
returns table(jobname text, schedule text, active boolean)
language sql
security definer
set search_path = ''
as $$
  select jobname::text, schedule::text, active
    from cron.job
    where jobname = 'trade_research_drain';
$$;

revoke all on function public.describe_trade_research_drain_schedule() from public, anon, authenticated;
grant execute on function public.describe_trade_research_drain_schedule() to service_role;

notify pgrst, 'reload schema';
