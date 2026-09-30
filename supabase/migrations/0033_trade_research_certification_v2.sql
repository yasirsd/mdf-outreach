-- T12 remediation — certification classifier v2.
--
-- Migrations 0031 and 0032 are unchanged. This is additive.
--
-- Context: production deployments of T12 (schema-version `trcert-v1`)
-- created certification rows using an incorrect classifier that:
--
--   1. read the persisted research_context from the result_summary
--      JSON blob instead of the authoritative row-level column,
--      producing spurious `legacy_unverified` rows for jobs whose DB
--      row actually contained a valid context;
--
--   2. cross-compared `research_context.interpretationVersion` (a
--      research-level version namespace, e.g. `trade-interpretation-v1`)
--      with per-provider `evidence.interpretationVersion` (a parser-
--      anchored version namespace, e.g. `fsvp-xlsx-v1:t08-v1`),
--      producing spurious `quarantined` rows.
--
-- Because migration 0031 makes certification rows append-only and
-- makes the identity fields (including `snapshot_fingerprint`)
-- immutable, an in-place UPDATE to correct these rows is prohibited.
-- Deleting rows is likewise prohibited (append-only history).
--
-- Remediation model: introduce a `classifier_version` column and bump
-- the fingerprint schema from `trcert-v1` to `trcert-v2` in code. A
-- corrected classifier now emits fingerprints prefixed `trcert-v2:...`
-- which do NOT collide with existing v1 rows under the
-- `unique (job_id, snapshot_fingerprint)` constraint. The old v1 rows
-- remain intact and auditable; a new authoritative v2 row is written
-- alongside them by the reconciliation reader on the next drain.
--
-- Consumers can then read only the current classifier version via the
-- new helper.

-- 1. New column. Default `'trcert-v1'` so existing rows keep their
-- correct historical version. New writes carry `'trcert-v2'`.
alter table public.buyer_trade_research_certifications
  add column classifier_version text not null default 'trcert-v1'
    check (classifier_version in ('trcert-v1','trcert-v2'));

-- 2. Extend the identity-immutability guard so `classifier_version`
-- is immutable per row (a row's classifier version is set on INSERT
-- and never changes). The existing `certified → quarantined`
-- transition remains allowed on the SAME row.
create or replace function mdf.__trade_research_certification_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'certified' and new.status not in ('certified','quarantined') then
    raise exception 'certified snapshots may only be quarantined, never downgraded';
  end if;
  if old.job_id <> new.job_id
     or old.snapshot_fingerprint <> new.snapshot_fingerprint
     or old.context_fingerprint is distinct from new.context_fingerprint
     or old.provider_results_digest <> new.provider_results_digest
     or old.result_summary_digest <> new.result_summary_digest
     or old.candidate_id <> new.candidate_id
     or old.product_id is distinct from new.product_id
     or old.market_country_code <> new.market_country_code
     or old.research_goal <> new.research_goal
     or old.provider_plan_version is distinct from new.provider_plan_version
     or old.interpretation_version is distinct from new.interpretation_version
     or old.workspace_id <> new.workspace_id
     or old.created_at <> new.created_at
     or old.automatic_spend_rupees <> new.automatic_spend_rupees
     or old.classifier_version <> new.classifier_version then
    raise exception 'trade research certification identity fields are immutable';
  end if;
  return new;
end $$;

-- 3. Index for reading the "current" certification by classifier
-- version, workspace, and recency.
create index buyer_trade_research_certifications_workspace_classifier_idx
  on public.buyer_trade_research_certifications(workspace_id, classifier_version, status, created_at desc);

-- 4. New reconciliation reader. Same NOT EXISTS semantics as
-- migration 0032, plus a `classifier_version` filter so a job is
-- surfaced whenever it lacks a row for the CURRENT classifier. Old
-- rows for other classifier versions do not mask reconciliation.
--
-- The 1-argument RPC from 0032 remains callable (unused now) —
-- migration 0032 is unchanged.
create or replace function public.select_terminal_research_jobs_missing_current_certification(
  p_limit int,
  p_classifier_version text
)
returns setof public.buyer_trade_research_jobs
language sql
stable
security invoker
set search_path = ''
as $$
  select j.*
    from public.buyer_trade_research_jobs j
   where j.status in ('completed','partial','needs_review','failed','cancelled')
     and j.completed_at is not null
     and not exists (
       select 1
         from public.buyer_trade_research_certifications c
        where c.job_id = j.id
          and c.workspace_id = j.workspace_id
          and c.classifier_version = p_classifier_version
     )
   order by j.completed_at desc, j.id desc
   limit greatest(1, least(50, coalesce(p_limit, 5)));
$$;

revoke all on function public.select_terminal_research_jobs_missing_current_certification(int, text) from public, anon, authenticated;
grant execute on function public.select_terminal_research_jobs_missing_current_certification(int, text) to service_role;

notify pgrst, 'reload schema';
