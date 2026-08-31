-- MDF Outreach — BF3C: durable free-enrichment queue.
-- Additive only. Does NOT apply itself. Operator applies manually after review.
-- Does not edit historical migration files.
--
-- One current-state job per (workspace, candidate, capability).
-- Capabilities are FREE only: public website contacts and Hunter masked
-- decision-maker discovery. Never stores reveal handles, emails, or paid
-- provider payloads. Does not perform network calls.
--
-- Backlog seed inserts queue rows for existing eligible candidates.
-- Already-searched candidates are marked succeeded without refetch.

-- ---------------------------------------------------------------------------
-- buyer_finder_free_enrichment_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_finder_free_enrichment_jobs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  candidate_id     uuid not null,
  capability       text not null,
  status           text not null default 'queued',
  attempt_count    integer not null default 0,
  next_attempt_at  timestamptz,
  provider_outcome text,
  error_code       text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, candidate_id, capability),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates (id, workspace_id)
    on delete cascade,
  constraint buyer_finder_free_enrichment_jobs_capability_allowed
    check (capability in (
      'public_company_contacts',
      'decision_makers'
    )),
  constraint buyer_finder_free_enrichment_jobs_status_allowed
    check (status in (
      'queued',
      'processing',
      'retry_wait',
      'succeeded',
      'no_result',
      'failed',
      'cancelled'
    )),
  constraint buyer_finder_free_enrichment_jobs_attempt_count_nonnegative
    check (attempt_count >= 0),
  constraint buyer_finder_free_enrichment_jobs_error_code_not_blank
    check (error_code is null or btrim(error_code) <> '')
);

-- At most one processing row per workspace+capability (V1 concurrency = 1).
create unique index if not exists buyer_finder_free_enrichment_jobs_one_processing_idx
  on public.buyer_finder_free_enrichment_jobs (workspace_id, capability)
  where status = 'processing';

create index if not exists buyer_finder_free_enrichment_jobs_due_idx
  on public.buyer_finder_free_enrichment_jobs (workspace_id, capability, next_attempt_at)
  where status in ('queued', 'retry_wait');

create index if not exists buyer_finder_free_enrichment_jobs_candidate_idx
  on public.buyer_finder_free_enrichment_jobs (workspace_id, candidate_id);

create index if not exists buyer_finder_free_enrichment_jobs_workspace_status_idx
  on public.buyer_finder_free_enrichment_jobs (workspace_id, status, updated_at desc);

select mdf.__apply_workspace_rls('public.buyer_finder_free_enrichment_jobs'::regclass);

revoke all on public.buyer_finder_free_enrichment_jobs from anon, authenticated, public;
grant select, insert, update, delete on public.buyer_finder_free_enrichment_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Backlog: seed jobs for existing eligible candidates. No network.
-- Archived / rejected candidates are skipped.
-- ---------------------------------------------------------------------------
insert into public.buyer_finder_free_enrichment_jobs (
  workspace_id,
  candidate_id,
  capability,
  status,
  provider_outcome,
  completed_at
)
select
  c.workspace_id,
  c.id,
  'public_company_contacts',
  case
    when c.public_contacts_searched_at is not null then 'succeeded'
    else 'queued'
  end,
  case
    when c.public_contacts_searched_at is not null then 'already_complete'
    else null
  end,
  c.public_contacts_searched_at
from public.buyer_candidates c
where c.discovery_status is distinct from 'archived'
  and c.review_status is distinct from 'rejected'
on conflict (workspace_id, candidate_id, capability) do nothing;

insert into public.buyer_finder_free_enrichment_jobs (
  workspace_id,
  candidate_id,
  capability,
  status,
  provider_outcome,
  completed_at
)
select
  c.workspace_id,
  c.id,
  'decision_makers',
  case
    when c.people_searched_at is not null then 'succeeded'
    else 'queued'
  end,
  case
    when c.people_searched_at is not null then 'already_complete'
    else null
  end,
  c.people_searched_at
from public.buyer_candidates c
where c.discovery_status is distinct from 'archived'
  and c.review_status is distinct from 'rejected'
on conflict (workspace_id, candidate_id, capability) do nothing;

notify pgrst, 'reload schema';
