-- READ-ONLY preflight for migration 0025. Run before applying 0025.
with expected(name) as (values
  ('buyer_trade_research_batches'),('buyer_trade_research_jobs'),('buyer_trade_research_provider_plans'),
  ('buyer_trade_research_attempts'),('buyer_trade_research_events'),('buyer_trade_source_snapshots')
), report as (
  select 'target_tables_absent'::text check_id,
    case when count(*) filter (where to_regclass('public.' || name) is not null) = 0
      then 'ok' else 'BLOCK: one or more 0025 tables already exist' end status from expected
  union all select 'workspace_helper_present', case when to_regprocedure('mdf.current_workspace_id()') is not null then 'ok' else 'BLOCK: mdf.current_workspace_id() missing' end
  union all select 'candidate_composite_key_present', case when exists (
    select 1 from pg_constraint where conrelid='public.buyer_candidates'::regclass and contype in ('p','u')
      and pg_get_constraintdef(oid) ~ '\(id, workspace_id\)'
  ) then 'ok' else 'BLOCK: buyer_candidates(id, workspace_id) uniqueness missing' end
  union all select 'updated_at_trigger_function_present', case when to_regprocedure('public.set_updated_at()') is not null then 'ok' else 'BLOCK: public.set_updated_at() missing' end
)
select * from report order by check_id;

