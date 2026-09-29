-- T10: durable, attempt-level provider checkpoints.
-- Historical terminal attempts intentionally remain NULL and are handled by
-- the application's conservative legacy-resume path.

alter table public.buyer_trade_research_attempts
  add column provider_result jsonb;

alter table public.buyer_trade_research_attempts
  add constraint buyer_trade_research_attempts_provider_result_object_check
  check (provider_result is null or jsonb_typeof(provider_result) = 'object');

create or replace function public.finish_buyer_trade_research_attempt_v2(
  p_attempt_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_revision bigint,
  p_state text,
  p_provider_result jsonb,
  p_safe_error_code text default null,
  p_duration_ms integer default null,
  p_record_count integer default null,
  p_match_count integer default null,
  p_finished_at timestamptz default now()
)
returns public.buyer_trade_research_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.buyer_trade_research_attempts;
  v_provider_id text;
  v_expected_execution_status text;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id required';
  end if;
  if p_revision < 0 then
    raise exception 'revision must be non-negative';
  end if;
  if p_state not in (
    'completed', 'completed_no_match', 'skipped_cached', 'skipped_quota',
    'skipped_cost', 'skipped_terms', 'failed_retryable', 'retry_wait',
    'failed_terminal', 'cancelled'
  ) then
    raise exception 'invalid finished attempt state';
  end if;
  if p_duration_ms < 0 or p_record_count < 0 or p_match_count < 0 then
    raise exception 'attempt counters must be non-negative';
  end if;

  -- Preserve the T02 lock/CAS boundary. Completing an attempt does not change
  -- the parent job revision; it only verifies the currently owned revision.
  perform 1
  from public.buyer_trade_research_jobs
  where id = p_job_id
    and lease_owner = p_worker_id
    and revision = p_revision
    and status in ('running', 'cancel_requested')
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'STALE_JOB_REVISION';
  end if;

  select plan.provider_id
  into v_provider_id
  from public.buyer_trade_research_attempts attempt
  join public.buyer_trade_research_provider_plans plan
    on plan.id = attempt.provider_plan_id
   and plan.workspace_id = attempt.workspace_id
   and plan.job_id = attempt.job_id
  where attempt.id = p_attempt_id
    and attempt.job_id = p_job_id
    and attempt.state = 'running'
    and attempt.lease_owner = p_worker_id;

  if v_provider_id is null then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_STATE_CONFLICT';
  end if;

  v_expected_execution_status := case p_state
    when 'completed' then 'completed'
    when 'completed_no_match' then 'no_match'
    when 'skipped_cached' then 'cached'
    else null
  end;

  if v_expected_execution_status is not null then
    if p_safe_error_code is not null then
      raise exception using errcode = '22023', message = 'SUCCESS_SAFE_ERROR_NOT_ALLOWED';
    end if;
    if p_provider_result is null or jsonb_typeof(p_provider_result) <> 'object' then
      raise exception using errcode = '22023', message = 'PROVIDER_RESULT_REQUIRED';
    end if;
    if p_provider_result ->> 'providerId' is distinct from v_provider_id then
      raise exception using errcode = '22023', message = 'PROVIDER_RESULT_PROVIDER_MISMATCH';
    end if;
    if p_provider_result #>> '{execution,status}' is distinct from v_expected_execution_status then
      raise exception using errcode = '22023', message = 'PROVIDER_RESULT_EXECUTION_MISMATCH';
    end if;
    if jsonb_typeof(p_provider_result -> 'execution') is distinct from 'object'
       or not (p_provider_result -> 'execution' ? 'safeErrorCode')
       or p_provider_result #>> '{execution,safeErrorCode}' is not null
       or jsonb_typeof(p_provider_result -> 'evidence') is distinct from 'object'
       or jsonb_typeof(p_provider_result -> 'sourceRecordIds') is distinct from 'array'
       or jsonb_typeof(p_provider_result -> 'datasetId') is distinct from 'string'
       or jsonb_typeof(p_provider_result -> 'datasetVersion') is distinct from 'string'
       or jsonb_typeof(p_provider_result -> 'parserVersion') is distinct from 'string'
       or jsonb_typeof(p_provider_result -> 'sourcePeriod') is distinct from 'string'
       or jsonb_typeof(p_provider_result -> 'retrievedAt') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'PROVIDER_RESULT_SHAPE_INVALID';
    end if;
  else
    if p_provider_result is not null then
      raise exception using errcode = '22023', message = 'PROVIDER_RESULT_NOT_ALLOWED';
    end if;
  end if;

  if p_provider_result is not null and exists (
    select 1
    from jsonb_object_keys(p_provider_result) as key_name
    where key_name not in (
      'providerId', 'datasetId', 'datasetVersion', 'parserVersion',
      'sourceRecordIds', 'sourcePeriod', 'retrievedAt', 'execution', 'evidence'
    )
  ) then
    raise exception using errcode = '22023', message = 'PROVIDER_RESULT_UNSAFE_FIELD';
  end if;

  update public.buyer_trade_research_attempts
  set state = p_state,
      provider_result = p_provider_result,
      safe_error_code = p_safe_error_code,
      duration_ms = p_duration_ms,
      record_count = p_record_count,
      match_count = p_match_count,
      automatic_spend_rupees = 0,
      lease_owner = null,
      lease_expires_at = null,
      finished_at = p_finished_at
  where id = p_attempt_id
    and job_id = p_job_id
    and state = 'running'
    and lease_owner = p_worker_id
  returning * into v_attempt;

  if v_attempt.id is null then
    raise exception using errcode = 'P0001', message = 'ATTEMPT_STATE_CONFLICT';
  end if;

  return v_attempt;
end
$$;

revoke all on function public.finish_buyer_trade_research_attempt_v2(uuid, uuid, text, bigint, text, jsonb, text, integer, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_buyer_trade_research_attempt_v2(uuid, uuid, text, bigint, text, jsonb, text, integer, integer, integer, timestamptz) to service_role;

notify pgrst, 'reload schema';
