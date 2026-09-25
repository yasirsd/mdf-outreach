-- MDF Outreach — BI4F Phase 2A durable, zero-cost trade research engine.
-- Additive only. FDA FSVP is the sole Phase 2A provider. Research output
-- remains separate from Buyer Intelligence and is never shipment evidence.

create table public.buyer_trade_research_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_goal text not null check (requested_goal in ('screen_trade_activity','find_target_product','check_india_origin')),
  product_id text,
  country_code text,
  status text not null default 'queued' check (status in ('queued','running','cancel_requested','completed','partial','needs_review','failed','cancelled')),
  total_jobs integer not null default 0 check (total_jobs >= 0),
  queued_count integer not null default 0 check (queued_count >= 0),
  running_count integer not null default 0 check (running_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  partial_count integer not null default 0 check (partial_count >= 0),
  needs_review_count integer not null default 0 check (needs_review_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  cancelled_count integer not null default 0 check (cancelled_count >= 0),
  corroborated_count integer not null default 0 check (corroborated_count >= 0),
  automatic_spend_rupees numeric(12,2) not null default 0 check (automatic_spend_rupees = 0),
  created_by uuid not null references auth.users(id),
  planner_version text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (country_code is null or country_code ~ '^[A-Z]{2}$')
);

create table public.buyer_trade_research_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  product_id text,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  requested_goal text not null check (requested_goal in ('screen_trade_activity','find_target_product','check_india_origin')),
  status text not null default 'queued' check (status in ('queued','running','cancel_requested','completed','partial','needs_review','failed','cancelled')),
  stage text not null default 'preparing_identity' check (stage in ('preparing_identity','planning_sources','screening_sources','resolving_company_matches','checking_trade_activity','checking_product_evidence','checking_origin_evidence','performing_deep_lookup','deduplicating_evidence','classifying_evidence','finalizing','complete')),
  outcome text check (outcome is null or outcome in ('trade_activity_only','official_importer_program_corroboration','no_verified_evidence','unsupported_coverage','needs_review','partial','failed','cancelled')),
  planner_version text not null,
  classifier_version text,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  last_progress_at timestamptz,
  next_attempt_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  result_summary jsonb not null default '{}'::jsonb,
  supersedes_job_id uuid,
  automatic_spend_rupees numeric(12,2) not null default 0 check (automatic_spend_rupees = 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (batch_id, workspace_id) references public.buyer_trade_research_batches(id, workspace_id) on delete cascade,
  foreign key (candidate_id, workspace_id) references public.buyer_candidates(id, workspace_id) on delete cascade,
  foreign key (supersedes_job_id, workspace_id) references public.buyer_trade_research_jobs(id, workspace_id)
);

create table public.buyer_trade_research_provider_plans (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id text not null,
  provider_descriptor_version text not null,
  role text not null,
  sequence integer not null check (sequence > 0),
  eligibility text not null check (eligibility in ('eligible','ineligible')),
  decision_reason text not null check (decision_reason in ('eligible','wrong_country','wrong_role','paid','manual_only','unsupported','quota_unknown','terms_unapproved','cache_hit','not_food_import_relevant')),
  cost_class text not null check (cost_class in ('free','free_quota','manual_free','paid','unsupported')),
  automatic_spend_rupees numeric(12,2) not null default 0 check (automatic_spend_rupees = 0),
  terms_version text not null,
  dataset_version text,
  cache_key text,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (job_id, provider_id, role),
  foreign key (job_id, workspace_id) references public.buyer_trade_research_jobs(id, workspace_id) on delete cascade
);

create table public.buyer_trade_research_attempts (
  id uuid primary key default gen_random_uuid(),
  provider_plan_id uuid not null,
  job_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 3),
  state text not null check (state in ('planned','queued','running','completed','completed_no_match','skipped_cached','skipped_quota','skipped_cost','skipped_terms','failed_retryable','retry_wait','failed_terminal','cancelled')),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  safe_error_code text,
  record_count integer check (record_count is null or record_count >= 0),
  match_count integer check (match_count is null or match_count >= 0),
  automatic_spend_rupees numeric(12,2) not null default 0 check (automatic_spend_rupees = 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (provider_plan_id, attempt_number),
  foreign key (provider_plan_id, workspace_id) references public.buyer_trade_research_provider_plans(id, workspace_id) on delete cascade,
  foreign key (job_id, workspace_id) references public.buyer_trade_research_jobs(id, workspace_id) on delete cascade
);

create table public.buyer_trade_research_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid not null,
  job_id uuid,
  event_type text not null check (event_type in ('batch_created','job_created','job_started','stage_changed','provider_planned','provider_attempt_started','provider_attempt_completed','provider_attempt_skipped','match_resolved','job_partial','job_completed','job_failed','job_cancel_requested','job_cancelled','job_reclaimed','batch_completed')),
  safe_details jsonb not null default '{}'::jsonb,
  automatic_spend_rupees numeric(12,2) not null default 0 check (automatic_spend_rupees = 0),
  created_at timestamptz not null default now(),
  foreign key (batch_id, workspace_id) references public.buyer_trade_research_batches(id, workspace_id) on delete cascade,
  foreign key (job_id, workspace_id) references public.buyer_trade_research_jobs(id, workspace_id) on delete cascade
);

-- Shared public-dataset cache. It is intentionally server-only and has no
-- workspace id because one FDA publication is reused across every workspace.
create table public.buyer_trade_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  dataset_id text not null,
  published_period text not null,
  source_url text not null,
  etag text,
  last_modified text,
  material_hash text not null,
  fetched_at timestamptz not null,
  retrieved_at timestamptz not null,
  expires_at timestamptz not null,
  row_count integer not null check (row_count >= 0),
  coverage jsonb not null default '{}'::jsonb,
  parse_version text not null,
  terms_version text not null,
  status text not null check (status in ('ready','failed')),
  safe_metadata jsonb not null default '{}'::jsonb,
  normalized_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(normalized_rows) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, dataset_id, material_hash)
);

create index buyer_trade_research_batches_workspace_created_idx on public.buyer_trade_research_batches(workspace_id, created_at desc);
create index buyer_trade_research_jobs_batch_status_idx on public.buyer_trade_research_jobs(batch_id, status);
create index buyer_trade_research_jobs_workspace_candidate_idx on public.buyer_trade_research_jobs(workspace_id, candidate_id, created_at desc);
create index buyer_trade_research_jobs_claim_idx on public.buyer_trade_research_jobs(status, next_attempt_at, created_at) where status in ('queued','running');
create unique index buyer_trade_research_jobs_one_active_scope_idx
  on public.buyer_trade_research_jobs(workspace_id, candidate_id, coalesce(product_id,''), country_code, requested_goal)
  where status in ('queued','running','cancel_requested');
create index buyer_trade_research_plans_job_idx on public.buyer_trade_research_provider_plans(job_id, sequence);
create index buyer_trade_research_attempts_job_idx on public.buyer_trade_research_attempts(job_id, attempt_number desc);
create index buyer_trade_research_attempts_lease_idx on public.buyer_trade_research_attempts(job_id, lease_expires_at) where state = 'running';
create index buyer_trade_research_events_batch_idx on public.buyer_trade_research_events(batch_id, id);
create index buyer_trade_research_events_job_idx on public.buyer_trade_research_events(job_id, id) where job_id is not null;
create index buyer_trade_source_snapshots_current_idx on public.buyer_trade_source_snapshots(provider_id, dataset_id, retrieved_at desc) where status = 'ready';

create or replace function mdf.__trade_research_job_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  old_rank integer;
  new_rank integer;
begin
  if old.status in ('completed','partial','needs_review','failed','cancelled') then
    raise exception 'terminal trade research jobs are immutable';
  end if;
  old_rank := array_position(array['preparing_identity','planning_sources','screening_sources','resolving_company_matches','checking_trade_activity','checking_product_evidence','checking_origin_evidence','performing_deep_lookup','deduplicating_evidence','classifying_evidence','finalizing','complete'], old.stage);
  new_rank := array_position(array['preparing_identity','planning_sources','screening_sources','resolving_company_matches','checking_trade_activity','checking_product_evidence','checking_origin_evidence','performing_deep_lookup','deduplicating_evidence','classifying_evidence','finalizing','complete'], new.stage);
  if new_rank < old_rank then raise exception 'trade research stage cannot move backward'; end if;
  if new.automatic_spend_rupees <> 0 then raise exception 'automatic trade research spend must remain zero'; end if;
  new.updated_at := now();
  return new;
end $$;

create trigger buyer_trade_research_jobs_guard before update on public.buyer_trade_research_jobs
for each row execute function mdf.__trade_research_job_guard();

create or replace function mdf.__trade_research_attempt_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state in ('completed','completed_no_match','skipped_cached','skipped_quota','skipped_cost','skipped_terms','failed_terminal','cancelled') then
    raise exception 'terminal trade research attempts are immutable';
  end if;
  if new.automatic_spend_rupees <> 0 then raise exception 'automatic trade research spend must remain zero'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger buyer_trade_research_attempts_guard before update on public.buyer_trade_research_attempts
for each row execute function mdf.__trade_research_attempt_guard();

create or replace function mdf.__trade_research_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'trade research events are append-only'; end $$;
create trigger buyer_trade_research_events_append_only before update or delete on public.buyer_trade_research_events
for each row execute function mdf.__trade_research_events_append_only();

create trigger buyer_trade_research_batches_updated_at before update on public.buyer_trade_research_batches
for each row execute function public.set_updated_at();
create trigger buyer_trade_source_snapshots_updated_at before update on public.buyer_trade_source_snapshots
for each row execute function public.set_updated_at();

create or replace function public.recompute_buyer_trade_research_batch(p_batch_id uuid)
returns public.buyer_trade_research_batches
language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_batches;
begin
  update public.buyer_trade_research_batches b set
    total_jobs = x.total_jobs,
    queued_count = x.queued_count,
    running_count = x.running_count,
    completed_count = x.completed_count,
    partial_count = x.partial_count,
    needs_review_count = x.needs_review_count,
    failed_count = x.failed_count,
    cancelled_count = x.cancelled_count,
    corroborated_count = x.corroborated_count,
    status = case
      when b.cancel_requested_at is not null and x.open_count = 0 and x.completed_count + x.partial_count + x.needs_review_count > 0 then 'partial'
      when b.cancel_requested_at is not null and x.open_count = 0 then 'cancelled'
      when x.open_count > 0 and x.running_count > 0 then 'running'
      when x.open_count > 0 then b.status
      when x.failed_count > 0 and x.completed_count + x.partial_count + x.needs_review_count = 0 then 'failed'
      when x.partial_count + x.failed_count + x.cancelled_count > 0 then 'partial'
      when x.needs_review_count > 0 then 'needs_review'
      else 'completed' end,
    completed_at = case when x.open_count = 0 then coalesce(b.completed_at, now()) else null end
  from (
    select count(*)::integer total_jobs,
      count(*) filter (where status='queued')::integer queued_count,
      count(*) filter (where status in ('running','cancel_requested'))::integer running_count,
      count(*) filter (where status='completed')::integer completed_count,
      count(*) filter (where status='partial')::integer partial_count,
      count(*) filter (where status='needs_review')::integer needs_review_count,
      count(*) filter (where status='failed')::integer failed_count,
      count(*) filter (where status='cancelled')::integer cancelled_count,
      count(*) filter (where outcome='official_importer_program_corroboration')::integer corroborated_count,
      count(*) filter (where status in ('queued','running','cancel_requested'))::integer open_count
    from public.buyer_trade_research_jobs where batch_id=p_batch_id
  ) x where b.id=p_batch_id returning b.* into v;
  return v;
end $$;

create or replace function public.create_buyer_trade_research_batch(p_input jsonb)
returns public.buyer_trade_research_batches
language plpgsql security invoker set search_path = '' as $$
declare
  v_batch public.buyer_trade_research_batches;
  v_job public.buyer_trade_research_jobs;
  item jsonb;
  plan jsonb;
begin
  if p_input->>'requestedGoal' <> 'screen_trade_activity' then raise exception 'unsupported Phase 2A goal'; end if;
  if jsonb_typeof(p_input->'jobs') <> 'array' or jsonb_array_length(p_input->'jobs') = 0 then raise exception 'at least one job required'; end if;
  insert into public.buyer_trade_research_batches(
    workspace_id,requested_goal,product_id,country_code,created_by,planner_version,total_jobs,queued_count
  ) values (
    (p_input->>'workspaceId')::uuid,p_input->>'requestedGoal',nullif(p_input->>'productId',''),nullif(p_input->>'countryCode',''),
    (p_input->>'createdBy')::uuid,p_input->>'plannerVersion',jsonb_array_length(p_input->'jobs'),jsonb_array_length(p_input->'jobs')
  ) returning * into v_batch;
  insert into public.buyer_trade_research_events(workspace_id,batch_id,event_type,safe_details)
    values(v_batch.workspace_id,v_batch.id,'batch_created',jsonb_build_object('jobCount',v_batch.total_jobs,'goal',v_batch.requested_goal));
  for item in select value from jsonb_array_elements(p_input->'jobs') loop
    insert into public.buyer_trade_research_jobs(
      batch_id,workspace_id,candidate_id,product_id,country_code,requested_goal,planner_version,supersedes_job_id
    ) values (
      v_batch.id,v_batch.workspace_id,(item->>'candidateId')::uuid,nullif(item->>'productId',''),item->>'countryCode',
      v_batch.requested_goal,v_batch.planner_version,nullif(item->>'supersedesJobId','')::uuid
    ) returning * into v_job;
    insert into public.buyer_trade_research_events(workspace_id,batch_id,job_id,event_type,safe_details)
      values(v_batch.workspace_id,v_batch.id,v_job.id,'job_created',jsonb_build_object('candidateId',v_job.candidate_id));
    for plan in select value from jsonb_array_elements(item->'plans') loop
      insert into public.buyer_trade_research_provider_plans(
        job_id,workspace_id,provider_id,provider_descriptor_version,role,sequence,eligibility,decision_reason,
        cost_class,terms_version,dataset_version,cache_key
      ) values (
        v_job.id,v_batch.workspace_id,plan->>'providerId',plan->>'providerDescriptorVersion',plan->>'role',
        (plan->>'sequence')::integer,plan->>'eligibility',plan->>'decisionReason',plan->>'costClass',
        plan->>'termsVersion',nullif(plan->>'datasetVersion',''),nullif(plan->>'cacheKey','')
      );
      insert into public.buyer_trade_research_events(workspace_id,batch_id,job_id,event_type,safe_details)
        values(v_batch.workspace_id,v_batch.id,v_job.id,'provider_planned',jsonb_build_object(
          'providerId',plan->>'providerId','eligibility',plan->>'eligibility','reason',plan->>'decisionReason','costClass',plan->>'costClass'
        ));
    end loop;
  end loop;
  return v_batch;
end $$;

create or replace function public.claim_buyer_trade_research_job(p_worker text, p_now timestamptz default now())
returns public.buyer_trade_research_jobs
language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_jobs; was_reclaim boolean; v_batch uuid;
begin
  if nullif(trim(p_worker),'') is null then raise exception 'worker id required'; end if;
  for v_batch in
    select distinct batch_id from public.buyer_trade_research_jobs j
    where j.status='cancel_requested' and j.lease_expires_at < p_now
      and j.heartbeat_at < p_now - interval '60 seconds'
      and not exists (select 1 from public.buyer_trade_research_attempts a where a.job_id=j.id and a.state='running' and a.lease_expires_at >= p_now)
  loop
    with cancelled as (
      update public.buyer_trade_research_jobs j set status='cancelled',stage='complete',outcome='cancelled',completed_at=p_now,
        lease_owner=null,lease_expires_at=null,revision=revision+1
      where j.batch_id=v_batch and j.status='cancel_requested' and j.lease_expires_at < p_now
        and j.heartbeat_at < p_now - interval '60 seconds'
        and not exists (select 1 from public.buyer_trade_research_attempts a where a.job_id=j.id and a.state='running' and a.lease_expires_at >= p_now)
      returning j.*
    )
    insert into public.buyer_trade_research_events(workspace_id,batch_id,job_id,event_type,safe_details)
      select workspace_id,batch_id,id,'job_cancelled',jsonb_build_object('reason','stale_cancel_recovery') from cancelled;
    perform public.recompute_buyer_trade_research_batch(v_batch);
  end loop;
  select j.* into v
  from public.buyer_trade_research_jobs j
  join public.buyer_trade_research_batches b on b.id=j.batch_id
  where b.cancel_requested_at is null and (
    (j.status='queued' and coalesce(j.next_attempt_at,p_now) <= p_now) or
    (j.status='running' and coalesce(j.next_attempt_at,p_now) <= p_now and (
      j.lease_owner is null or (j.lease_expires_at < p_now and j.heartbeat_at < p_now - interval '60 seconds'
        and not exists (select 1 from public.buyer_trade_research_attempts a where a.job_id=j.id and a.state='running' and a.lease_expires_at >= p_now))
    ))
  ) order by case when j.status='running' then 0 else 1 end, j.created_at
  for update of j skip locked limit 1;
  if v.id is null then return null; end if;
  was_reclaim := v.status='running';
  update public.buyer_trade_research_jobs set status='running', lease_owner=p_worker,
    lease_expires_at=p_now+interval '60 seconds', heartbeat_at=p_now,
    last_progress_at=coalesce(last_progress_at,p_now), started_at=coalesce(started_at,p_now),
    revision=revision+1 where id=v.id returning * into v;
  update public.buyer_trade_research_batches set status='running', started_at=coalesce(started_at,p_now) where id=v.batch_id and status='queued';
  insert into public.buyer_trade_research_events(workspace_id,batch_id,job_id,event_type,safe_details)
    values(v.workspace_id,v.batch_id,v.id,case when was_reclaim then 'job_reclaimed' else 'job_started' end,jsonb_build_object('worker',p_worker,'revision',v.revision));
  perform public.recompute_buyer_trade_research_batch(v.batch_id);
  return v;
end $$;

create or replace function public.release_buyer_trade_research_job(p_job_id uuid, p_worker text, p_revision bigint, p_next_attempt_at timestamptz)
returns public.buyer_trade_research_jobs language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_jobs;
begin
  update public.buyer_trade_research_jobs set lease_owner=null,lease_expires_at=null,next_attempt_at=p_next_attempt_at,revision=revision+1
  where id=p_job_id and lease_owner=p_worker and revision=p_revision and status='running' returning * into v;
  return v;
end $$;

create or replace function public.heartbeat_buyer_trade_research_job(p_job_id uuid, p_worker text, p_revision bigint, p_now timestamptz default now())
returns public.buyer_trade_research_jobs language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_jobs;
begin
  update public.buyer_trade_research_jobs set heartbeat_at=p_now, lease_expires_at=p_now+interval '60 seconds', revision=revision+1
  where id=p_job_id and lease_owner=p_worker and revision=p_revision and status in ('running','cancel_requested') returning * into v;
  return v;
end $$;

create or replace function public.advance_buyer_trade_research_job(p_job_id uuid, p_worker text, p_revision bigint, p_stage text, p_now timestamptz default now())
returns public.buyer_trade_research_jobs language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_jobs;
begin
  update public.buyer_trade_research_jobs set stage=p_stage, last_progress_at=p_now, heartbeat_at=p_now,
    lease_expires_at=p_now+interval '60 seconds', revision=revision+1
  where id=p_job_id and lease_owner=p_worker and revision=p_revision and status='running' returning * into v;
  if v.id is not null then
    insert into public.buyer_trade_research_events(workspace_id,batch_id,job_id,event_type,safe_details)
      values(v.workspace_id,v.batch_id,v.id,'stage_changed',jsonb_build_object('stage',v.stage,'revision',v.revision));
  end if;
  return v;
end $$;

create or replace function public.finalize_buyer_trade_research_job(p_job_id uuid, p_worker text, p_status text, p_outcome text, p_result jsonb, p_now timestamptz default now())
returns public.buyer_trade_research_jobs language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_jobs; ev text;
begin
  if p_status not in ('completed','partial','needs_review','failed','cancelled') then raise exception 'invalid terminal status'; end if;
  update public.buyer_trade_research_jobs set status=p_status, stage='complete', outcome=p_outcome,
    result_summary=coalesce(p_result,'{}'::jsonb), lease_owner=null, lease_expires_at=null,
    heartbeat_at=p_now, last_progress_at=p_now, completed_at=p_now, revision=revision+1
  where id=p_job_id and lease_owner=p_worker and status in ('running','cancel_requested') returning * into v;
  if v.id is null then return null; end if;
  ev := case when p_status='failed' then 'job_failed' when p_status='cancelled' then 'job_cancelled' when p_status='partial' then 'job_partial' else 'job_completed' end;
  insert into public.buyer_trade_research_events(workspace_id,batch_id,job_id,event_type,safe_details)
    values(v.workspace_id,v.batch_id,v.id,ev,jsonb_build_object('status',v.status,'outcome',v.outcome,'revision',v.revision));
  perform public.recompute_buyer_trade_research_batch(v.batch_id);
  return v;
end $$;

create or replace function public.request_buyer_trade_research_batch_cancel(p_batch_id uuid, p_workspace_id uuid, p_now timestamptz default now())
returns public.buyer_trade_research_batches language plpgsql security invoker set search_path = '' as $$
declare v public.buyer_trade_research_batches;
begin
  update public.buyer_trade_research_batches set status='cancel_requested', cancel_requested_at=coalesce(cancel_requested_at,p_now)
    where id=p_batch_id and workspace_id=p_workspace_id and status in ('queued','running','cancel_requested') returning * into v;
  if v.id is null then return null; end if;
  update public.buyer_trade_research_jobs set status='cancelled', stage='complete', outcome='cancelled', completed_at=p_now, revision=revision+1
    where batch_id=p_batch_id and status='queued';
  update public.buyer_trade_research_jobs set status='cancel_requested', revision=revision+1
    where batch_id=p_batch_id and status='running';
  insert into public.buyer_trade_research_events(workspace_id,batch_id,event_type,safe_details)
    values(p_workspace_id,p_batch_id,'job_cancel_requested',jsonb_build_object('scope','batch'));
  return public.recompute_buyer_trade_research_batch(p_batch_id);
end $$;

-- Workspace members can read their research state. All mutation remains on
-- the server through the service_role-only tables/functions below.
do $$ declare t text; begin
  foreach t in array array[
    'buyer_trade_research_batches','buyer_trade_research_jobs','buyer_trade_research_provider_plans',
    'buyer_trade_research_attempts','buyer_trade_research_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (workspace_id = mdf.current_workspace_id())', t || '_member_select', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

alter table public.buyer_trade_source_snapshots enable row level security;
revoke all on public.buyer_trade_source_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.buyer_trade_source_snapshots to service_role;

revoke all on function public.recompute_buyer_trade_research_batch(uuid) from public, anon, authenticated;
revoke all on function public.create_buyer_trade_research_batch(jsonb) from public, anon, authenticated;
revoke all on function public.claim_buyer_trade_research_job(text,timestamptz) from public, anon, authenticated;
revoke all on function public.heartbeat_buyer_trade_research_job(uuid,text,bigint,timestamptz) from public, anon, authenticated;
revoke all on function public.release_buyer_trade_research_job(uuid,text,bigint,timestamptz) from public, anon, authenticated;
revoke all on function public.advance_buyer_trade_research_job(uuid,text,bigint,text,timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_buyer_trade_research_job(uuid,text,text,text,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.request_buyer_trade_research_batch_cancel(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.recompute_buyer_trade_research_batch(uuid) to service_role;
grant execute on function public.create_buyer_trade_research_batch(jsonb) to service_role;
grant execute on function public.claim_buyer_trade_research_job(text,timestamptz) to service_role;
grant execute on function public.heartbeat_buyer_trade_research_job(uuid,text,bigint,timestamptz) to service_role;
grant execute on function public.release_buyer_trade_research_job(uuid,text,bigint,timestamptz) to service_role;
grant execute on function public.advance_buyer_trade_research_job(uuid,text,bigint,text,timestamptz) to service_role;
grant execute on function public.finalize_buyer_trade_research_job(uuid,text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.request_buyer_trade_research_batch_cancel(uuid,uuid,timestamptz) to service_role;

notify pgrst, 'reload schema';
