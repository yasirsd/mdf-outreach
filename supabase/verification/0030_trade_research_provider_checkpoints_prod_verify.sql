-- PRODUCTION-SAFE READ-ONLY verification for migration 0030.
-- This file contains one WITH/SELECT statement and performs no writes.

with metadata as (
  select
    to_regprocedure('public.finish_buyer_trade_research_attempt_v2(uuid,uuid,text,bigint,text,jsonb,text,integer,integer,integer,timestamptz)') as rpc_oid,
    'public.finish_buyer_trade_research_attempt_v2(uuid,uuid,text,bigint,text,jsonb,text,integer,integer,integer,timestamptz)'::text as rpc_signature
), function_defs as (
  select
    case when rpc_oid is null then '' else pg_get_functiondef(rpc_oid) end as finish_rpc,
    pg_get_functiondef('mdf.__trade_research_attempt_guard()'::regprocedure) as attempt_guard,
    regexp_replace(
      lower(case when rpc_oid is null then '' else pg_get_functiondef(rpc_oid) end),
      '\s+', ' ', 'g'
    ) as normalized_finish_rpc,
    regexp_replace(
      lower(pg_get_functiondef('mdf.__trade_research_attempt_guard()'::regprocedure)),
      '\s+', ' ', 'g'
    ) as normalized_attempt_guard,
    rpc_signature
  from metadata
), guard_trigger as (
  select
    trigger_row.tgenabled,
    lower(pg_get_triggerdef(trigger_row.oid)) as trigger_definition
  from pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.buyer_trade_research_attempts'::regclass
    and trigger_row.tgname = 'buyer_trade_research_attempts_guard'
    and not trigger_row.tgisinternal
), checks(check_name, passed, detail) as (
  values
    (
      'provider_result column exists',
      exists (
        select 1 from pg_attribute
        where attrelid = 'public.buyer_trade_research_attempts'::regclass
          and attname = 'provider_result'
          and atttypid = 'jsonb'::regtype
          and not attisdropped
      ),
      'Expected public.buyer_trade_research_attempts.provider_result jsonb'
    ),
    (
      'provider_result JSON-object constraint exists',
      exists (
        select 1 from pg_constraint
        where conrelid = 'public.buyer_trade_research_attempts'::regclass
          and conname = 'buyer_trade_research_attempts_provider_result_object_check'
          and pg_get_constraintdef(oid) ilike '%jsonb_typeof(provider_result)%object%'
      ),
      'Checkpoint must be NULL or a JSON object'
    ),
    (
      'v2 finish RPC exists',
      (select rpc_oid is not null from metadata),
      'Expected the exact fenced v2 RPC signature'
    ),
    (
      'success states require provider_result',
      (select finish_rpc ilike '%provider_result_required%'
           and finish_rpc ilike '%completed_no_match%'
           and finish_rpc ilike '%skipped_cached%'
       from function_defs),
      'Completed, no-match, and cached attempts need an atomic checkpoint'
    ),
    (
      'non-success states reject provider_result',
      (select normalized_finish_rpc like '%else if p_provider_result is not null then raise exception using errcode = ''22023'', message = ''provider_result_not_allowed''; end if; end if;%'
           and finish_rpc ilike '%skipped_quota%'
           and finish_rpc ilike '%skipped_cost%'
           and finish_rpc ilike '%skipped_terms%'
           and finish_rpc ilike '%failed_retryable%'
           and finish_rpc ilike '%retry_wait%'
           and finish_rpc ilike '%failed_terminal%'
           and finish_rpc ilike '%cancelled%'
       from function_defs),
      'Failure, cancellation, and blocked attempt states must persist NULL provider_result'
    ),
    (
      'success states reject attempt safe_error_code',
      (select normalized_finish_rpc like '%if v_expected_execution_status is not null then if p_safe_error_code is not null then raise exception using errcode = ''22023'', message = ''success_safe_error_not_allowed''; end if;%'
       from function_defs),
      'A successful typed result and its attempt row must both have no safe error code'
    ),
    (
      'provider identity is validated',
      (select finish_rpc ilike '%provider_result_provider_mismatch%'
           and finish_rpc ilike '%plan.provider_id%'
           and finish_rpc ilike '%providerId%'
       from function_defs),
      'Checkpoint providerId must match the durable provider plan'
    ),
    (
      'execution state is validated',
      (select finish_rpc ilike '%provider_result_execution_mismatch%'
           and finish_rpc ilike '%{execution,status}%'
           and finish_rpc ilike '%no_match%'
           and finish_rpc ilike '%cached%'
       from function_defs),
      'Attempt and typed execution states must map exactly'
    ),
    (
      'T02 lease and revision fencing remains present',
      (select finish_rpc ilike '%for update%'
           and finish_rpc ilike '%lease_owner = p_worker_id%'
           and finish_rpc ilike '%revision = p_revision%'
           and finish_rpc ilike '%status in (''running'', ''cancel_requested'')%'
       from function_defs),
      'The parent job is locked and checked against owner and revision'
    ),
    (
      'attempt ownership and running state are checked',
      (select finish_rpc ilike '%attempt.state = ''running''%'
           and finish_rpc ilike '%attempt.lease_owner = p_worker_id%'
       from function_defs),
      'Only the owning worker may complete its running attempt'
    ),
    (
      'terminal guard rejects every UPDATE including provider_result',
      (select normalized_attempt_guard like '%if old.state in (%completed%completed_no_match%skipped_cached%) then raise exception ''terminal trade research attempts are immutable''; end if;%'
       from function_defs),
      'The guard raises solely from OLD terminal state, before considering which column changed'
    ),
    (
      'terminal immutability trigger is active for row updates',
      exists (
        select 1
        from guard_trigger
        where tgenabled <> 'D'
          and trigger_definition ilike '%before update on public.buyer_trade_research_attempts%'
          and trigger_definition ilike '%for each row execute function mdf.__trade_research_attempt_guard()%'
      ),
      'The unconditional terminal guard must be attached as an enabled BEFORE UPDATE row trigger'
    ),
    (
      'browser roles cannot execute v2 finish RPC',
      (select rpc_oid is not null
           and not exists (
             select 1
             from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
             where p.oid = metadata.rpc_oid
               and acl.grantee = 0
               and acl.privilege_type = 'EXECUTE'
           )
           and not has_function_privilege('anon', rpc_signature, 'EXECUTE')
           and not has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
       from metadata),
      'PUBLIC, anon, and authenticated must have no EXECUTE privilege'
    ),
    (
      'service_role can execute v2 finish RPC',
      (select rpc_oid is not null
           and has_function_privilege('service_role', rpc_signature, 'EXECUTE')
       from metadata),
      'Only the server worker role should execute checkpoint completion'
    )
)
select
  case when passed then 'PASS' else 'FAIL' end as result,
  check_name,
  detail
from checks
order by check_name;
