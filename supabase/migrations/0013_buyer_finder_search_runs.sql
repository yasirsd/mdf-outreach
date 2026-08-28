-- BF2.1 — Buyer Finder Search Run persistence.
-- Additive only. Does not alter existing tables, policies, enums, or grants.
--
-- One row per operator-initiated Buyer Finder search. Ingestion updates
-- progress counters throughout the run; the UI polls for progress and
-- terminal state. RLS enforces workspace isolation identically to the
-- other buyer_candidate_* tables added in migration 0010.

do $$ begin
  create type public.buyer_finder_search_run_status as enum (
    'queued', 'running', 'completed', 'partial', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.buyer_finder_search_run_stage as enum (
    'preparing', 'discovering', 'processing_candidates', 'finalizing', 'complete'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.buyer_finder_provider_outcome as enum (
    'success',
    'no_result',
    'quota_exhausted',
    'rate_limited',
    'temporarily_unavailable',
    'invalid_request',
    'not_configured'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- buyer_finder_search_runs — one row per operator-initiated search
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_finder_search_runs (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,

  -- Query inputs (business ids, not email theme keys)
  country                 text not null default '',
  business_product_id     text not null default '',
  desired_buyer_types     text[] not null default '{}'::text[],
  contact_priorities      text[] not null default '{}'::text[],

  -- Provider
  provider                text not null default 'hunter',
  provider_status         public.buyer_finder_provider_outcome,

  -- Run lifecycle
  status                  public.buyer_finder_search_run_status not null default 'queued',
  stage                   public.buyer_finder_search_run_stage not null default 'preparing',

  -- Progress counters
  discovered_count        integer not null default 0,
  usable_count            integer not null default 0,
  processed_count         integer not null default 0,
  created_count           integer not null default 0,
  enriched_existing_count integer not null default 0,
  duplicate_count         integer not null default 0,
  product_matches_added   integer not null default 0,
  failure_count           integer not null default 0,

  -- Cost — BF2.1 Hunter Discover is free.
  credits_used            integer not null default 0,
  cost_class              text not null default 'free',

  -- Safe error only. Never a raw provider payload.
  error_code              text,
  error_message           text,

  started_at              timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint buyer_finder_search_runs_discovered_nonneg
    check (discovered_count >= 0),
  constraint buyer_finder_search_runs_usable_nonneg
    check (usable_count >= 0),
  constraint buyer_finder_search_runs_processed_nonneg
    check (processed_count >= 0),
  constraint buyer_finder_search_runs_created_nonneg
    check (created_count >= 0),
  constraint buyer_finder_search_runs_enriched_nonneg
    check (enriched_existing_count >= 0),
  constraint buyer_finder_search_runs_duplicate_nonneg
    check (duplicate_count >= 0),
  constraint buyer_finder_search_runs_matches_nonneg
    check (product_matches_added >= 0),
  constraint buyer_finder_search_runs_failure_nonneg
    check (failure_count >= 0),
  constraint buyer_finder_search_runs_credits_nonneg
    check (credits_used >= 0),
  constraint buyer_finder_search_runs_processed_le_usable
    check (processed_count <= usable_count),
  constraint buyer_finder_search_runs_cost_class_shape
    check (cost_class in ('free', 'paid'))
);

create index if not exists buyer_finder_search_runs_workspace_created_idx
  on public.buyer_finder_search_runs (workspace_id, created_at desc);

create index if not exists buyer_finder_search_runs_workspace_status_idx
  on public.buyer_finder_search_runs (workspace_id, status);

-- BF2.2 — at most one queued/running Buyer Finder search per workspace.
-- Stops double-clicks and multi-tab races from launching two Hunter
-- Discover calls. Terminal rows (completed / partial / failed) are
-- excluded so a later search can start after the previous one ends.
create unique index if not exists buyer_finder_search_runs_one_active_per_workspace_idx
  on public.buyer_finder_search_runs (workspace_id)
  where status in ('queued', 'running');

-- Reuse existing set_updated_at trigger function.
drop trigger if exists buyer_finder_search_runs_set_updated_at on public.buyer_finder_search_runs;
create trigger buyer_finder_search_runs_set_updated_at
  before update on public.buyer_finder_search_runs
  for each row execute function public.set_updated_at();

-- Workspace-membership RLS — same macro as migrations 0003 / 0010.
select mdf.__apply_workspace_rls('public.buyer_finder_search_runs'::regclass);

revoke all on public.buyer_finder_search_runs from anon, authenticated, public;
grant select, insert, update, delete on public.buyer_finder_search_runs to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification SQL (run manually AFTER applying):
--
--   -- Table + RLS state.
--   select relname, relrowsecurity from pg_class
--     where relname = 'buyer_finder_search_runs';
--
--   -- Non-negative counter check.
--   insert into public.buyer_finder_search_runs (workspace_id, created_count)
--     values (gen_random_uuid(), -1); -- MUST raise 23514
--
--   -- Anon zero access:
--   set role anon; select count(*) from public.buyer_finder_search_runs;
--   reset role;
-- ---------------------------------------------------------------------------
