-- MDF Outreach — T07 explicit trade-research context binding.
-- Additive only: migrations 0001–0028 remain immutable. Historical rows stay
-- contextless and are intentionally treated as legacy_unknown by readers.

alter table public.buyer_trade_research_jobs
  add column research_context jsonb,
  add column context_fingerprint text;

alter table public.buyer_trade_research_jobs
  add constraint buyer_trade_research_jobs_context_pair_check
    check ((research_context is null) = (context_fingerprint is null)),
  add constraint buyer_trade_research_jobs_context_object_check
    check (research_context is null or jsonb_typeof(research_context) = 'object'),
  add constraint buyer_trade_research_jobs_context_fingerprint_check
    check (
      context_fingerprint is null
      or context_fingerprint ~ '^trctx-v1:[0-9a-f]{64}$'
    );

-- Typed jobs deduplicate on the complete semantic context. Legacy active jobs
-- retain the old scope only among other legacy rows.
drop index public.buyer_trade_research_jobs_one_active_scope_idx;

create unique index buyer_trade_research_jobs_one_active_context_idx
  on public.buyer_trade_research_jobs(workspace_id, context_fingerprint)
  where status in ('queued', 'running', 'cancel_requested')
    and context_fingerprint is not null;

create unique index buyer_trade_research_jobs_one_active_legacy_scope_idx
  on public.buyer_trade_research_jobs(
    workspace_id,
    candidate_id,
    coalesce(product_id, ''),
    country_code,
    requested_goal
  )
  where status in ('queued', 'running', 'cancel_requested')
    and context_fingerprint is null;

create index buyer_trade_research_jobs_context_read_idx
  on public.buyer_trade_research_jobs(
    workspace_id,
    candidate_id,
    context_fingerprint,
    created_at desc
  );

-- Preserve the original transition rules and make the stored context immutable
-- after INSERT. The existing trigger already calls this function.
create or replace function mdf.__trade_research_job_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_rank integer;
  new_rank integer;
begin
  if old.status in ('completed', 'partial', 'needs_review', 'failed', 'cancelled') then
    raise exception 'terminal trade research jobs are immutable';
  end if;
  if new.research_context is distinct from old.research_context
     or new.context_fingerprint is distinct from old.context_fingerprint then
    raise exception 'trade research context is immutable';
  end if;
  old_rank := array_position(
    array[
      'preparing_identity', 'planning_sources', 'screening_sources',
      'resolving_company_matches', 'checking_trade_activity',
      'checking_product_evidence', 'checking_origin_evidence',
      'performing_deep_lookup', 'deduplicating_evidence',
      'classifying_evidence', 'finalizing', 'complete'
    ],
    old.stage
  );
  new_rank := array_position(
    array[
      'preparing_identity', 'planning_sources', 'screening_sources',
      'resolving_company_matches', 'checking_trade_activity',
      'checking_product_evidence', 'checking_origin_evidence',
      'performing_deep_lookup', 'deduplicating_evidence',
      'classifying_evidence', 'finalizing', 'complete'
    ],
    new.stage
  );
  if new_rank < old_rank then
    raise exception 'trade research stage cannot move backward';
  end if;
  if new.automatic_spend_rupees <> 0 then
    raise exception 'automatic trade research spend must remain zero';
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Every call now creates typed jobs. workspaceId is supplied by the trusted
-- server action from the selected session; the database also checks it against
-- every stored context. productForm has no separate authoritative column in
-- the current model and therefore remains JSON-authoritative (null today).
create or replace function public.create_buyer_trade_research_batch(p_input jsonb)
returns public.buyer_trade_research_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.buyer_trade_research_batches;
  v_job public.buyer_trade_research_jobs;
  item jsonb;
  plan jsonb;
  v_context jsonb;
  v_fingerprint text;
  v_candidate_id uuid;
  v_product_id text;
  v_country_code text;
begin
  if p_input->>'requestedGoal' <> 'screen_trade_activity' then
    raise exception 'unsupported trade research goal';
  end if;
  if jsonb_typeof(p_input->'jobs') <> 'array'
     or jsonb_array_length(p_input->'jobs') = 0 then
    raise exception 'at least one job required';
  end if;

  insert into public.buyer_trade_research_batches(
    workspace_id,
    requested_goal,
    product_id,
    country_code,
    created_by,
    planner_version,
    total_jobs,
    queued_count
  ) values (
    (p_input->>'workspaceId')::uuid,
    p_input->>'requestedGoal',
    nullif(p_input->>'productId', ''),
    nullif(p_input->>'countryCode', ''),
    (p_input->>'createdBy')::uuid,
    p_input->>'plannerVersion',
    jsonb_array_length(p_input->'jobs'),
    jsonb_array_length(p_input->'jobs')
  ) returning * into v_batch;

  insert into public.buyer_trade_research_events(
    workspace_id, batch_id, event_type, safe_details
  ) values (
    v_batch.workspace_id,
    v_batch.id,
    'batch_created',
    jsonb_build_object('jobCount', v_batch.total_jobs, 'goal', v_batch.requested_goal)
  );

  for item in select value from jsonb_array_elements(p_input->'jobs') loop
    v_context := item->'context';
    v_fingerprint := item->>'contextFingerprint';
    v_candidate_id := (item->>'candidateId')::uuid;
    v_product_id := nullif(item->>'productId', '');
    v_country_code := item->>'countryCode';

    if jsonb_typeof(v_context) <> 'object' then
      raise exception 'research context must be a JSON object';
    end if;
    if v_fingerprint is null
       or v_fingerprint !~ '^trctx-v1:[0-9a-f]{64}$' then
      raise exception 'invalid research context fingerprint';
    end if;
    if v_product_id is null then
      raise exception 'research product is required';
    end if;
    if (v_context->>'workspaceId') is distinct from v_batch.workspace_id::text then
      raise exception 'research context workspace mismatch';
    end if;
    if (v_context->>'candidateId') is distinct from v_candidate_id::text then
      raise exception 'research context candidate mismatch';
    end if;
    if (v_context->>'productId') is distinct from v_product_id then
      raise exception 'research context product mismatch';
    end if;
    if (v_context->>'marketCountryCode') is distinct from v_country_code then
      raise exception 'research context market mismatch';
    end if;
    if (v_context->>'researchGoal') is distinct from v_batch.requested_goal then
      raise exception 'research context goal mismatch';
    end if;
    if (v_context->>'providerPlanVersion') is distinct from v_batch.planner_version then
      raise exception 'research context provider-plan version mismatch';
    end if;
    if not (v_context ? 'productForm')
       or (
         jsonb_typeof(v_context->'productForm') not in ('null', 'string')
       ) then
      raise exception 'research context product form is invalid';
    end if;
    if nullif(trim(v_context->>'interpretationVersion'), '') is null
       or (v_context->>'interpretationVersion') !~ '^[a-z0-9][a-z0-9._-]{0,127}$' then
      raise exception 'research context interpretation version is invalid';
    end if;

    insert into public.buyer_trade_research_jobs(
      batch_id,
      workspace_id,
      candidate_id,
      product_id,
      country_code,
      requested_goal,
      planner_version,
      supersedes_job_id,
      research_context,
      context_fingerprint,
      result_summary
    ) values (
      v_batch.id,
      v_batch.workspace_id,
      v_candidate_id,
      v_product_id,
      v_country_code,
      v_batch.requested_goal,
      v_batch.planner_version,
      nullif(item->>'supersedesJobId', '')::uuid,
      v_context,
      v_fingerprint,
      jsonb_build_object(
        'context', v_context,
        'contextFingerprint', v_fingerprint
      )
    ) returning * into v_job;

    insert into public.buyer_trade_research_events(
      workspace_id, batch_id, job_id, event_type, safe_details
    ) values (
      v_batch.workspace_id,
      v_batch.id,
      v_job.id,
      'job_created',
      jsonb_build_object(
        'candidateId', v_job.candidate_id,
        'contextFingerprint', v_job.context_fingerprint
      )
    );

    for plan in select value from jsonb_array_elements(item->'plans') loop
      insert into public.buyer_trade_research_provider_plans(
        job_id,
        workspace_id,
        provider_id,
        provider_descriptor_version,
        role,
        sequence,
        eligibility,
        decision_reason,
        cost_class,
        terms_version,
        dataset_version,
        cache_key
      ) values (
        v_job.id,
        v_batch.workspace_id,
        plan->>'providerId',
        plan->>'providerDescriptorVersion',
        plan->>'role',
        (plan->>'sequence')::integer,
        plan->>'eligibility',
        plan->>'decisionReason',
        plan->>'costClass',
        plan->>'termsVersion',
        nullif(plan->>'datasetVersion', ''),
        nullif(plan->>'cacheKey', '')
      );
      insert into public.buyer_trade_research_events(
        workspace_id, batch_id, job_id, event_type, safe_details
      ) values (
        v_batch.workspace_id,
        v_batch.id,
        v_job.id,
        'provider_planned',
        jsonb_build_object(
          'providerId', plan->>'providerId',
          'eligibility', plan->>'eligibility',
          'reason', plan->>'decisionReason',
          'costClass', plan->>'costClass'
        )
      );
    end loop;
  end loop;
  return v_batch;
end
$$;

-- Keep T02's lease-owner + revision CAS. Locking the exact CAS row before
-- validating worker JSON makes conflict rejection and final mutation one
-- transaction while retaining the same stale-revision failure semantics.
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
  v_result_summary jsonb;
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
  if coalesce((p_result_summary->>'automaticSpendRupees')::numeric, 0) <> 0 then
    raise exception 'automatic trade research spend must remain zero';
  end if;

  select * into v_job
  from public.buyer_trade_research_jobs
  where id = p_job_id
    and lease_owner = p_worker_id
    and revision = p_revision
    and status in ('running', 'cancel_requested')
  for update;

  if v_job.id is null then
    raise exception using errcode = 'P0001', message = 'STALE_JOB_REVISION';
  end if;

  if v_job.research_context is null then
    if p_result_summary ? 'context' or p_result_summary ? 'contextFingerprint' then
      raise exception using errcode = 'P0001', message = 'LEGACY_JOB_CONTEXT_FORBIDDEN';
    end if;
    v_result_summary := p_result_summary;
  else
    if p_result_summary ? 'context'
       and p_result_summary->'context' is distinct from v_job.research_context then
      raise exception using errcode = 'P0001', message = 'RESULT_CONTEXT_CONFLICT';
    end if;
    if p_result_summary ? 'contextFingerprint'
       and p_result_summary->>'contextFingerprint' is distinct from v_job.context_fingerprint then
      raise exception using errcode = 'P0001', message = 'RESULT_CONTEXT_CONFLICT';
    end if;
    v_result_summary := (
      p_result_summary - 'context' - 'contextFingerprint'
    ) || jsonb_build_object(
      'context', v_job.research_context,
      'contextFingerprint', v_job.context_fingerprint
    );
  end if;

  update public.buyer_trade_research_jobs
  set status = p_status,
      stage = 'complete',
      outcome = p_outcome,
      result_summary = v_result_summary,
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
    jsonb_build_object(
      'status', v_job.status,
      'outcome', v_job.outcome,
      'revision', v_job.revision,
      'contextFingerprint', v_job.context_fingerprint
    )
  );

  perform public.recompute_buyer_trade_research_batch(v_job.batch_id);
  return v_job;
end
$$;

revoke all on function public.create_buyer_trade_research_batch(jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_buyer_trade_research_job_v2(
  uuid, text, bigint, text, text, jsonb, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_buyer_trade_research_batch(jsonb)
  to service_role;
grant execute on function public.finalize_buyer_trade_research_job_v2(
  uuid, text, bigint, text, text, jsonb, timestamptz
) to service_role;

notify pgrst, 'reload schema';
