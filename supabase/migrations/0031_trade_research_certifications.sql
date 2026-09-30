-- T12 — Trade research snapshot certifications.
--
-- Additive only. Migrations 0025–0030 remain immutable.
--
-- Records a certification for each finalized research job: a
-- deterministic fingerprint of the material identity (context +
-- provider result versions + finalized result summary) plus a status
-- classifying trust:
--
--   * `certified`         — every required provenance field is
--                            present, canonical, and matches the
--                            stored fingerprint. The row is safe to
--                            treat as trusted current evidence.
--
--   * `legacy_unverified` — the finalized job predates required
--                            provenance (e.g. no research_context or
--                            missing providerPlanVersion). We
--                            preserve the record for audit but do
--                            NOT treat it as certified.
--
--   * `quarantined`       — finalized job WITH provenance that is
--                            invalid, mismatched, corrupted, or
--                            uses an incompatible parser/schema
--                            version. Preserved for audit but
--                            excluded from trusted / current
--                            selection until re-certified.
--
-- Immutability: `mdf.__trade_research_job_guard` already prevents
-- mutation of terminal jobs. Certification rows themselves are
-- inserted once; a re-certification with material changes creates a
-- NEW row (unique constraint on (job_id, snapshot_fingerprint) makes
-- the certification service idempotent for the same material state).

create table public.buyer_trade_research_certifications (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces(id) on delete cascade,
  job_id                    uuid not null,
  candidate_id              uuid not null,
  product_id                text,
  market_country_code       text not null check (market_country_code ~ '^[A-Z]{2}$'),
  research_goal             text not null check (research_goal in ('screen_trade_activity','find_target_product','check_india_origin')),
  provider_plan_version     text,
  interpretation_version    text,
  context_fingerprint       text,
  provider_results_digest   text not null,
  result_summary_digest     text not null,
  snapshot_fingerprint      text not null,
  status                    text not null check (status in ('certified','legacy_unverified','quarantined')),
  status_reason             text not null,
  certified_at              timestamptz,
  created_at                timestamptz not null default now(),
  automatic_spend_rupees    numeric(12,2) not null default 0 check (automatic_spend_rupees = 0),
  foreign key (job_id, workspace_id) references public.buyer_trade_research_jobs(id, workspace_id) on delete cascade,
  foreign key (candidate_id, workspace_id) references public.buyer_candidates(id, workspace_id) on delete cascade,
  -- Idempotency: the same finalized job + material state can only be
  -- certified once. Re-running certification is a no-op.
  unique (job_id, snapshot_fingerprint),
  -- Deterministic sanity: a certified row must carry certified_at,
  -- and non-certified rows must not.
  check ((status = 'certified' and certified_at is not null)
         or (status <> 'certified' and certified_at is null))
);

create index buyer_trade_research_certifications_workspace_status_idx
  on public.buyer_trade_research_certifications(workspace_id, status, created_at desc);

create index buyer_trade_research_certifications_candidate_idx
  on public.buyer_trade_research_certifications(workspace_id, candidate_id, created_at desc);

create index buyer_trade_research_certifications_job_idx
  on public.buyer_trade_research_certifications(job_id, created_at desc);

-- Immutability guard: certification rows are append-only. Status may
-- only transition `certified` → `quarantined` when the certification
-- service detects post-hoc corruption; that is a controlled service-
-- role UPDATE, so the guard forbids every OTHER mutation.
create or replace function mdf.__trade_research_certification_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'certified' and new.status not in ('certified','quarantined') then
    raise exception 'certified snapshots may only be quarantined, never downgraded';
  end if;
  if old.job_id <> new.job_id
     or old.snapshot_fingerprint <> new.snapshot_fingerprint
     or old.context_fingerprint is distinct from new.context_fingerprint
     or old.provider_results_digest <> new.provider_results_digest
     or old.result_summary_digest <> new.result_summary_digest
     or old.candidate_id <> new.candidate_id
     or old.product_id is distinct from new.product_id
     or old.market_country_code <> new.market_country_code
     or old.research_goal <> new.research_goal
     or old.provider_plan_version is distinct from new.provider_plan_version
     or old.interpretation_version is distinct from new.interpretation_version
     or old.workspace_id <> new.workspace_id
     or old.created_at <> new.created_at
     or old.automatic_spend_rupees <> new.automatic_spend_rupees then
    raise exception 'trade research certification identity fields are immutable';
  end if;
  return new;
end $$;

create trigger buyer_trade_research_certifications_guard
  before update on public.buyer_trade_research_certifications
  for each row execute function mdf.__trade_research_certification_guard();

create or replace function mdf.__trade_research_certifications_no_delete()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'trade research certifications are append-only'; end $$;
create trigger buyer_trade_research_certifications_no_delete
  before delete on public.buyer_trade_research_certifications
  for each row execute function mdf.__trade_research_certifications_no_delete();

-- Workspace-membership RLS + minimum privileges. Members SELECT
-- their own workspace's certifications; only service_role mutates.
alter table public.buyer_trade_research_certifications enable row level security;
create policy buyer_trade_research_certifications_member_select
  on public.buyer_trade_research_certifications
  for select to authenticated
  using (workspace_id = mdf.current_workspace_id());
revoke all on public.buyer_trade_research_certifications from public, anon, authenticated;
grant select on public.buyer_trade_research_certifications to authenticated;
grant select, insert, update on public.buyer_trade_research_certifications to service_role;

notify pgrst, 'reload schema';
