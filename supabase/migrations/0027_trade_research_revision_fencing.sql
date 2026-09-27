-- MDF Outreach — Wave 0 / T02 trade-research revision fencing.
-- Additive only: migrations 0025 and 0026 remain immutable.

create or replace function public.finalize_buyer_trade_research_job_v2(
  p_job_id uuid,
  p_worker_id text,
  p_revision bigint,
  p_status text,
  p_outcome text,
  p_result_summary jsonb,
  p_now timestamptz default now()
)
returns public.buyer_trade_research_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.buyer_trade_research_jobs;
  v_event_type text;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id required';
  end if;
  if p_revision < 0 then
    raise exception 'revision must be non-negative';
  end if;
  if p_status not in ('completed', 'partial', 'needs_review', 'failed', 'cancelled') then
    raise exception 'invalid terminal status';
  end if;
  if p_outcome not in (
    'trade_activity_only', 'official_importer_program_corroboration',
    'no_verified_evidence', 'unsupported_coverage', 'needs_review',
    'partial', 'failed', 'cancelled'
  ) then
    raise exception 'invalid trade research outcome';
  end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary) <> 'object' then
    raise exception 'result summary must be a JSON object';
  end if;
  if coalesce((p_result_summary ->> 'automaticSpendRupees')::numeric, 0) <> 0 then
    raise exception 'automatic trade research spend must remain zero';
  end if;

  update public.buyer_trade_research_jobs
  set status = p_status,
      stage = 'complete',
      outcome = p_outcome,
      result_summary = p_result_summary,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = p_now,
      last_progress_at = p_now,
      completed_at = p_now,
      revision = revision + 1
  where id = p_job_id
    and lease_owner = p_worker_id
    and revision = p_revision
    and status in ('running', 'cancel_requested')
  returning * into v_job;

  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'STALE_JOB_REVISION';
  end if;

  v_event_type := case
    when p_status = 'failed' then 'job_failed'
    when p_status = 'cancelled' then 'job_cancelled'
    when p_status = 'partial' then 'job_partial'
    else 'job_completed'
  end;

  insert into public.buyer_trade_research_events(
    workspace_id, batch_id, job_id, event_type, safe_details
  ) values (
    v_job.workspace_id,
    v_job.batch_id,
    v_job.id,
    v_event_type,
    jsonb_build_object('status', v_job.status, 'outcome', v_job.outcome, 'revision', v_job.revision)
  );

  perform public.recompute_buyer_trade_research_batch(v_job.batch_id);
  return v_job;
end
$$;

create or replace function public.finish_buyer_trade_research_attempt(
  p_attempt_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_revision bigint,
  p_state text,
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

  -- Lock the parent first so reclaim/finalize cannot cross the validation
  -- and attempt update boundary. The transaction stays local and short.
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

  update public.buyer_trade_research_attempts
  set state = p_state,
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

create or replace function public.reconcile_buyer_trade_research_attempt(
  p_attempt_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_revision bigint,
  p_safe_error_code text default 'STALE_LEASE_RECOVERED',
  p_finished_at timestamptz default now()
)
returns public.buyer_trade_research_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.buyer_trade_research_attempts;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id required';
  end if;
  if p_revision < 0 then
    raise exception 'revision must be non-negative';
  end if;
  if nullif(trim(p_safe_error_code), '') is null then
    raise exception 'safe error code required';
  end if;

  perform 1
  from public.buyer_trade_research_jobs
  where id = p_job_id
    and lease_owner = p_worker_id
    and revision = p_revision
    and status = 'running'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'STALE_JOB_REVISION';
  end if;

  update public.buyer_trade_research_attempts
  set state = 'failed_retryable',
      safe_error_code = p_safe_error_code,
      automatic_spend_rupees = 0,
      lease_owner = null,
      lease_expires_at = null,
      finished_at = p_finished_at
  where id = p_attempt_id
    and job_id = p_job_id
    and state = 'running'
  returning * into v_attempt;

  -- An already-reconciled row is an idempotent no-op. A stale parent job
  -- was rejected above before this branch can be reached.
  return v_attempt;
end
$$;

revoke all on function public.finalize_buyer_trade_research_job_v2(uuid, text, bigint, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_buyer_trade_research_attempt(uuid, uuid, text, bigint, text, text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.reconcile_buyer_trade_research_attempt(uuid, uuid, text, bigint, text, timestamptz) from public, anon, authenticated;

grant execute on function public.finalize_buyer_trade_research_job_v2(uuid, text, bigint, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.finish_buyer_trade_research_attempt(uuid, uuid, text, bigint, text, text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.reconcile_buyer_trade_research_attempt(uuid, uuid, text, bigint, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
