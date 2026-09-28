-- PRODUCTION-SAFE READ-ONLY verification for migration 0029.
-- This file contains one WITH/SELECT statement and performs no writes.

with function_defs as (
  select
    pg_get_functiondef(
      'public.create_buyer_trade_research_batch(jsonb)'::regprocedure
    ) as batch_rpc,
    pg_get_functiondef(
      'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)'::regprocedure
    ) as finalize_rpc,
    pg_get_functiondef(
      'mdf.__trade_research_job_guard()'::regprocedure
    ) as guard_fn
), checks(check_name, passed, detail) as (
  values
    (
      'research_context column exists',
      exists (
        select 1 from pg_attribute
        where attrelid = 'public.buyer_trade_research_jobs'::regclass
          and attname = 'research_context'
          and atttypid = 'jsonb'::regtype
          and not attisdropped
      ),
      'Expected public.buyer_trade_research_jobs.research_context jsonb'
    ),
    (
      'context_fingerprint column exists',
      exists (
        select 1 from pg_attribute
        where attrelid = 'public.buyer_trade_research_jobs'::regclass
          and attname = 'context_fingerprint'
          and atttypid = 'text'::regtype
          and not attisdropped
      ),
      'Expected public.buyer_trade_research_jobs.context_fingerprint text'
    ),
    (
      'context pair constraint exists',
      exists (
        select 1 from pg_constraint
        where conrelid = 'public.buyer_trade_research_jobs'::regclass
          and conname = 'buyer_trade_research_jobs_context_pair_check'
      ),
      'Both context columns must be null or non-null together'
    ),
    (
      'context object constraint exists',
      exists (
        select 1 from pg_constraint
        where conrelid = 'public.buyer_trade_research_jobs'::regclass
          and conname = 'buyer_trade_research_jobs_context_object_check'
          and pg_get_constraintdef(oid) ilike '%jsonb_typeof%object%'
      ),
      'research_context must be a JSON object when present'
    ),
    (
      'fingerprint format constraint exists',
      exists (
        select 1 from pg_constraint
        where conrelid = 'public.buyer_trade_research_jobs'::regclass
          and conname = 'buyer_trade_research_jobs_context_fingerprint_check'
          and pg_get_constraintdef(oid) like '%trctx-v1:%[0-9a-f]%64%'
      ),
      'Fingerprint must use trctx-v1 plus 64 lowercase hex characters'
    ),
    (
      'job guard makes context immutable',
      (select guard_fn ilike '%research_context is distinct from old.research_context%'
           and guard_fn ilike '%context_fingerprint is distinct from old.context_fingerprint%'
       from function_defs),
      'Guard must reject changes to both stored context fields'
    ),
    (
      'typed active-context unique index exists',
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'buyer_trade_research_jobs_one_active_context_idx'
          and indexdef ilike '%unique%workspace_id%context_fingerprint%'
          and indexdef ilike '%queued%running%cancel_requested%'
          and indexdef ilike '%context_fingerprint is not null%'
      ),
      'Typed active jobs must be unique by workspace and fingerprint'
    ),
    (
      'legacy active-scope unique index exists',
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'buyer_trade_research_jobs_one_active_legacy_scope_idx'
          and indexdef ilike '%unique%workspace_id%candidate_id%product_id%country_code%requested_goal%'
          and indexdef ilike '%context_fingerprint is null%'
      ),
      'Legacy contextless active jobs retain the previous scope'
    ),
    (
      'exact-context read index exists',
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'buyer_trade_research_jobs_context_read_idx'
          and indexdef ilike '%workspace_id%candidate_id%context_fingerprint%created_at desc%'
      ),
      'Latest exact-context reads need the four-column index'
    ),
    (
      'batch RPC stores context at insertion',
      (select batch_rpc ilike '%research_context%context_fingerprint%result_summary%'
           and batch_rpc ilike '%research context workspace mismatch%'
           and batch_rpc ilike '%research context product mismatch%'
       from function_defs),
      'Creation must validate and persist both context fields'
    ),
    (
      'finalize v2 preserves stored context and revision CAS',
      (select finalize_rpc ilike '%v_job.research_context%'
           and finalize_rpc ilike '%result_context_conflict%'
           and finalize_rpc ilike '%lease_owner = p_worker_id%'
           and finalize_rpc ilike '%revision = p_revision%'
       from function_defs),
      'Finalization must use stored context without weakening T02 fencing'
    ),
    (
      'browser roles cannot execute mutation RPCs',
      not has_function_privilege(
        'anon', 'public.create_buyer_trade_research_batch(jsonb)', 'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated', 'public.create_buyer_trade_research_batch(jsonb)', 'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)',
        'EXECUTE'
      ),
      'Creation and finalization stay service-role-only; PUBLIC grants would be inherited by these roles'
    ),
    (
      'service role can execute required RPCs',
      has_function_privilege(
        'service_role', 'public.create_buyer_trade_research_batch(jsonb)', 'EXECUTE'
      )
      and has_function_privilege(
        'service_role',
        'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)',
        'EXECUTE'
      ),
      'Creation and fenced finalization remain available to service_role'
    )
)
select
  case when passed then 'PASS' else 'FAIL' end as result,
  check_name,
  detail
from checks
order by check_name;
