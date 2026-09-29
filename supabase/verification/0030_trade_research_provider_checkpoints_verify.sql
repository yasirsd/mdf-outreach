-- LOCAL / DISPOSABLE DATABASE ONLY.
-- Metadata and function-contract assertions for migration 0030. This script
-- raises on the first failed invariant and rolls back its transaction.

begin;

do $$
declare
  v_rpc text;
  v_guard text;
  v_rpc_oid oid;
  v_signature text := 'public.finish_buyer_trade_research_attempt_v2(uuid,uuid,text,bigint,text,jsonb,text,integer,integer,integer,timestamptz)';
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.buyer_trade_research_attempts'::regclass
      and attname = 'provider_result'
      and atttypid = 'jsonb'::regtype
      and not attisdropped
  ) then
    raise exception '0030 verification: provider_result jsonb column missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buyer_trade_research_attempts'::regclass
      and conname = 'buyer_trade_research_attempts_provider_result_object_check'
      and pg_get_constraintdef(oid) ilike '%jsonb_typeof(provider_result)%object%'
  ) then
    raise exception '0030 verification: provider_result object constraint missing';
  end if;

  if to_regprocedure(v_signature) is null then
    raise exception '0030 verification: v2 finish RPC missing';
  end if;

  v_rpc_oid := to_regprocedure(v_signature);
  select pg_get_functiondef(v_rpc_oid) into v_rpc;
  select pg_get_functiondef('mdf.__trade_research_attempt_guard()'::regprocedure) into v_guard;

  if v_rpc not ilike '%for update%'
     or v_rpc not ilike '%lease_owner = p_worker_id%'
     or v_rpc not ilike '%revision = p_revision%'
     or v_rpc not ilike '%attempt.state = ''running''%'
     or v_rpc not ilike '%attempt.lease_owner = p_worker_id%' then
    raise exception '0030 verification: T02 fencing checks missing';
  end if;
  if v_rpc not ilike '%provider_result_required%'
     or v_rpc not ilike '%provider_result_provider_mismatch%'
     or v_rpc not ilike '%provider_result_execution_mismatch%'
     or v_rpc not ilike '%{execution,status}%'
     or v_rpc not ilike '%provider_result = p_provider_result%' then
    raise exception '0030 verification: checkpoint validation/storage missing';
  end if;
  if v_guard not ilike '%completed_no_match%'
     or v_guard not ilike '%skipped_cached%'
     or v_guard not ilike '%terminal trade research attempts are immutable%' then
    raise exception '0030 verification: terminal checkpoint immutability missing';
  end if;
  if exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = v_rpc_oid
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', v_signature, 'EXECUTE')
     or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
    raise exception '0030 verification: browser role can execute v2 finish RPC';
  end if;
  if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception '0030 verification: service_role cannot execute v2 finish RPC';
  end if;
end
$$;

rollback;
