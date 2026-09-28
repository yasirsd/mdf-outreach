-- LOCAL / DISPOSABLE DATABASE ONLY.
-- Metadata and function-contract assertions for migration 0029. This script
-- raises on the first failed invariant and rolls back its transaction.

begin;

do $$
declare
  v_batch_rpc text;
  v_finalize_rpc text;
  v_guard text;
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.buyer_trade_research_jobs'::regclass
      and attname = 'research_context' and atttypid = 'jsonb'::regtype
      and not attisdropped
  ) then
    raise exception '0029 verification: research_context jsonb column missing';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.buyer_trade_research_jobs'::regclass
      and attname = 'context_fingerprint' and atttypid = 'text'::regtype
      and not attisdropped
  ) then
    raise exception '0029 verification: context_fingerprint text column missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buyer_trade_research_jobs'::regclass
      and conname = 'buyer_trade_research_jobs_context_pair_check'
  ) then
    raise exception '0029 verification: context pair constraint missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buyer_trade_research_jobs'::regclass
      and conname = 'buyer_trade_research_jobs_context_fingerprint_check'
  ) then
    raise exception '0029 verification: fingerprint constraint missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'buyer_trade_research_jobs_one_active_context_idx'
      and indexdef ilike '%context_fingerprint is not null%'
  ) then
    raise exception '0029 verification: typed active-context index missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'buyer_trade_research_jobs_one_active_legacy_scope_idx'
      and indexdef ilike '%context_fingerprint is null%'
  ) then
    raise exception '0029 verification: legacy active-scope index missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'buyer_trade_research_jobs_context_read_idx'
  ) then
    raise exception '0029 verification: exact-context read index missing';
  end if;

  select pg_get_functiondef(
    'public.create_buyer_trade_research_batch(jsonb)'::regprocedure
  ) into v_batch_rpc;
  select pg_get_functiondef(
    'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)'::regprocedure
  ) into v_finalize_rpc;
  select pg_get_functiondef(
    'mdf.__trade_research_job_guard()'::regprocedure
  ) into v_guard;

  if v_guard not ilike '%research_context is distinct from old.research_context%'
     or v_guard not ilike '%context_fingerprint is distinct from old.context_fingerprint%' then
    raise exception '0029 verification: stored context is not immutable';
  end if;
  if v_batch_rpc not ilike '%research context workspace mismatch%'
     or v_batch_rpc not ilike '%research context provider-plan version mismatch%'
     or v_batch_rpc not ilike '%context_fingerprint%' then
    raise exception '0029 verification: create RPC does not validate/store context';
  end if;
  if v_finalize_rpc not ilike '%result_context_conflict%'
     or v_finalize_rpc not ilike '%v_job.research_context%'
     or v_finalize_rpc not ilike '%revision = p_revision%' then
    raise exception '0029 verification: finalizer does not preserve context and CAS';
  end if;

  if has_function_privilege(
    'anon', 'public.create_buyer_trade_research_batch(jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.create_buyer_trade_research_batch(jsonb)', 'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)',
    'EXECUTE'
  ) then
    raise exception '0029 verification: browser role can execute mutation RPC';
  end if;
  if not has_function_privilege(
    'service_role', 'public.create_buyer_trade_research_batch(jsonb)', 'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamptz)',
    'EXECUTE'
  ) then
    raise exception '0029 verification: service_role cannot execute required mutation RPC';
  end if;
end
$$;

rollback;
