-- MUTATING TRANSACTIONAL VERIFICATION for migration 0027.
-- LOCAL / DISPOSABLE DATABASE ONLY. DO NOT RUN IN PRODUCTION.
-- Requires migrations through 0027 and at least one local auth.users row.
-- Every fixture write is rolled back.

begin;

do $$
declare
  v_workspace_id uuid := gen_random_uuid();
  v_candidate_id uuid := gen_random_uuid();
  v_batch_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
  v_plan_id uuid := gen_random_uuid();
  v_finish_attempt_id uuid := gen_random_uuid();
  v_reconcile_attempt_id uuid := gen_random_uuid();
  v_stale_attempt_id uuid := gen_random_uuid();
  v_user_id uuid;
  v_job public.buyer_trade_research_jobs;
  v_attempt public.buyer_trade_research_attempts;
  v_signature text;
begin
  if to_regprocedure('public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamp with time zone)') is null
    or to_regprocedure('public.finish_buyer_trade_research_attempt(uuid,uuid,text,bigint,text,text,integer,integer,integer,timestamp with time zone)') is null
    or to_regprocedure('public.reconcile_buyer_trade_research_attempt(uuid,uuid,text,bigint,text,timestamp with time zone)') is null then
    raise exception '0027 functions are missing';
  end if;

  foreach v_signature in array array[
    'public.finalize_buyer_trade_research_job_v2(uuid,text,bigint,text,text,jsonb,timestamp with time zone)',
    'public.finish_buyer_trade_research_attempt(uuid,uuid,text,bigint,text,text,integer,integer,integer,timestamp with time zone)',
    'public.reconcile_buyer_trade_research_attempt(uuid,uuid,text,bigint,text,timestamp with time zone)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service_role lacks EXECUTE on %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'EXECUTE')
      or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'untrusted role has EXECUTE on %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_class
    where oid in (
      'public.buyer_trade_research_jobs'::regclass,
      'public.buyer_trade_research_attempts'::regclass
    ) and relrowsecurity
    group by relrowsecurity
    having count(*) = 2
  ) then
    raise exception 'trade-research RLS is not enabled';
  end if;

  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then
    raise exception 'verification requires one local auth.users row';
  end if;

  insert into public.workspaces(id, name, slug)
  values (v_workspace_id, '0027 disposable verification', 'verify-0027-' || substr(v_workspace_id::text, 1, 8));

  insert into public.buyer_candidates(id, workspace_id, company_name, country)
  values (v_candidate_id, v_workspace_id, '0027 verification candidate', 'United States');

  insert into public.buyer_trade_research_batches(
    id, workspace_id, requested_goal, status, total_jobs, running_count,
    created_by, planner_version
  ) values (
    v_batch_id, v_workspace_id, 'screen_trade_activity', 'running', 1, 1,
    v_user_id, 'verify-0027'
  );

  insert into public.buyer_trade_research_jobs(
    id, batch_id, workspace_id, candidate_id, product_id, country_code,
    requested_goal, status, stage, planner_version, lease_owner,
    lease_expires_at, heartbeat_at, revision
  ) values (
    v_job_id, v_batch_id, v_workspace_id, v_candidate_id, 'guntur-dry-red-chilli', 'US',
    'screen_trade_activity', 'running', 'finalizing', 'verify-0027', 'worker-a',
    now() + interval '60 seconds', now(), 1
  );

  insert into public.buyer_trade_research_provider_plans(
    id, job_id, workspace_id, provider_id, provider_descriptor_version,
    role, sequence, eligibility, decision_reason, cost_class, terms_version
  ) values (
    v_plan_id, v_job_id, v_workspace_id, 'verify-provider', 'v1',
    'COMPANY_MATCH', 1, 'eligible', 'eligible', 'free', 'v1'
  );

  insert into public.buyer_trade_research_attempts(
    id, provider_plan_id, job_id, workspace_id, attempt_number, state,
    lease_owner, lease_expires_at, heartbeat_at, started_at
  ) values
    (v_finish_attempt_id, v_plan_id, v_job_id, v_workspace_id, 1, 'running', 'worker-a', now() + interval '60 seconds', now(), now()),
    (v_reconcile_attempt_id, v_plan_id, v_job_id, v_workspace_id, 2, 'running', 'dead-worker', now() - interval '60 seconds', now() - interval '60 seconds', now() - interval '60 seconds'),
    (v_stale_attempt_id, v_plan_id, v_job_id, v_workspace_id, 3, 'running', 'worker-a', now() + interval '60 seconds', now(), now());

  v_attempt := public.finish_buyer_trade_research_attempt(
    v_finish_attempt_id, v_job_id, 'worker-a', 1, 'completed', null, 10, 2, 1
  );
  if v_attempt.state <> 'completed' or v_attempt.automatic_spend_rupees <> 0 then
    raise exception 'fenced finish attempt did not persist expected zero-spend state';
  end if;
  if (select revision from public.buyer_trade_research_jobs where id = v_job_id) <> 1 then
    raise exception 'attempt completion unexpectedly advanced job revision';
  end if;

  v_attempt := public.reconcile_buyer_trade_research_attempt(
    v_reconcile_attempt_id, v_job_id, 'worker-a', 1, 'STALE_LEASE_RECOVERED'
  );
  if v_attempt.state <> 'failed_retryable' then
    raise exception 'current owner could not reconcile stale attempt';
  end if;
  v_attempt := public.reconcile_buyer_trade_research_attempt(
    v_reconcile_attempt_id, v_job_id, 'worker-a', 1, 'STALE_LEASE_RECOVERED'
  );
  if v_attempt.id is not null then
    raise exception 'second reconciliation was not an idempotent no-op';
  end if;

  update public.buyer_trade_research_jobs
  set lease_owner = 'worker-b', revision = 2
  where id = v_job_id;

  begin
    perform public.finish_buyer_trade_research_attempt(
      v_stale_attempt_id, v_job_id, 'worker-a', 1, 'failed_terminal', 'SHOULD_NOT_WRITE'
    );
    raise exception 'stale attempt completion unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STALE_JOB_REVISION' then raise; end if;
  end;

  begin
    perform public.reconcile_buyer_trade_research_attempt(
      v_stale_attempt_id, v_job_id, 'worker-a', 1, 'STALE_LEASE_RECOVERED'
    );
    raise exception 'stale reconciliation unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STALE_JOB_REVISION' then raise; end if;
  end;

  begin
    perform public.finalize_buyer_trade_research_job_v2(
      v_job_id, 'worker-a', 1, 'completed', 'no_verified_evidence',
      jsonb_build_object('automaticSpendRupees', 0)
    );
    raise exception 'stale finalization unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STALE_JOB_REVISION' then raise; end if;
  end;

  v_job := public.finalize_buyer_trade_research_job_v2(
    v_job_id, 'worker-b', 2, 'completed', 'no_verified_evidence',
    jsonb_build_object('automaticSpendRupees', 0)
  );
  if v_job.revision <> 3 or v_job.status <> 'completed' or v_job.automatic_spend_rupees <> 0 then
    raise exception 'correct-revision finalization did not increment and preserve zero spend';
  end if;

  if exists (
    select 1 from public.buyer_trade_research_attempts
    where job_id = v_job_id and automatic_spend_rupees <> 0
  ) then
    raise exception 'attempt automatic-spend invariant failed';
  end if;
end
$$;

rollback;
