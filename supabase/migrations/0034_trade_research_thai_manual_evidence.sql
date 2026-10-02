-- TH04C — Thailand manual official-registry evidence.
--
-- Three MANUAL_ONLY sources (never scraped):
--
--   thai-dbd              — DBD DataWarehouse+ company lookup
--   thai-customs-operator — Thai Customs operator / AEO registry
--   thai-fda-importer     — Thai FDA food-importer licence lookup
--
-- Rows capture what a logged-in MDF operator read on the OFFICIAL
-- public source. The system NEVER automates these — this table is
-- an append-only audit trail; corrections ship as a NEW row that
-- supersedes the previous one.
--
-- Append-only: no DELETE, no UPDATE of identity fields.
-- Workspace-scoped RLS: authenticated member SELECT; service_role
-- INSERT only (writes go through server-side authenticated actions
-- that validate workspace membership before writing).
-- Spend is always ₹0: `automatic_spend_rupees = 0` check constraint.

create table public.buyer_trade_research_thai_manual_evidence (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete cascade,
  candidate_id             uuid not null,
  provider_id              text not null check (provider_id in (
    'thai-dbd','thai-customs-operator','thai-fda-importer'
  )),
  captured_at              timestamptz not null default now(),
  captured_by_user_id      uuid not null,
  source_url               text not null,
  source_label             text not null,
  evidence_payload         jsonb not null,
  evidence_status          text not null check (evidence_status in (
    'verified','not_found','inconclusive','withdrawn'
  )),
  supersedes_id            uuid references
                             public.buyer_trade_research_thai_manual_evidence(id)
                             on delete restrict,
  automatic_spend_rupees   numeric(12,2) not null default 0
                             check (automatic_spend_rupees = 0),
  created_at               timestamptz not null default now(),
  foreign key (candidate_id, workspace_id)
    references public.buyer_candidates(id, workspace_id) on delete cascade
);

create index buyer_trade_research_thai_manual_evidence_candidate_idx
  on public.buyer_trade_research_thai_manual_evidence(workspace_id, candidate_id, created_at desc);

create index buyer_trade_research_thai_manual_evidence_provider_idx
  on public.buyer_trade_research_thai_manual_evidence(workspace_id, provider_id, created_at desc);

create index buyer_trade_research_thai_manual_evidence_supersedes_idx
  on public.buyer_trade_research_thai_manual_evidence(supersedes_id);

-- At most ONE active (not superseded, not withdrawn) row per
-- (workspace, candidate, provider). This is a partial unique index
-- so an older row (superseded or withdrawn) does not block a new
-- active row from being inserted.
create unique index buyer_trade_research_thai_manual_evidence_active_unique
  on public.buyer_trade_research_thai_manual_evidence(workspace_id, candidate_id, provider_id)
  where supersedes_id is null and evidence_status <> 'withdrawn';

-- Identity + provenance immutability. The only legitimate field that
-- can change post-insert is `evidence_status`, and even that only to
-- transition into `withdrawn`. Any other UPDATE path raises.
create or replace function mdf.__trade_research_thai_manual_evidence_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.workspace_id <> new.workspace_id
     or old.candidate_id <> new.candidate_id
     or old.provider_id <> new.provider_id
     or old.captured_at <> new.captured_at
     or old.captured_by_user_id <> new.captured_by_user_id
     or old.source_url <> new.source_url
     or old.source_label <> new.source_label
     or old.evidence_payload::text <> new.evidence_payload::text
     or old.supersedes_id is distinct from new.supersedes_id
     or old.automatic_spend_rupees <> new.automatic_spend_rupees
     or old.created_at <> new.created_at then
    raise exception 'trade research thai manual evidence identity fields are immutable';
  end if;
  if old.evidence_status <> new.evidence_status
     and new.evidence_status <> 'withdrawn' then
    raise exception 'thai manual evidence may only transition to withdrawn in place; use supersedes_id for corrections';
  end if;
  return new;
end $$;

create trigger buyer_trade_research_thai_manual_evidence_guard
  before update on public.buyer_trade_research_thai_manual_evidence
  for each row execute function mdf.__trade_research_thai_manual_evidence_guard();

create or replace function mdf.__trade_research_thai_manual_evidence_no_delete()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'thai manual evidence is append-only'; end $$;
create trigger buyer_trade_research_thai_manual_evidence_no_delete
  before delete on public.buyer_trade_research_thai_manual_evidence
  for each row execute function mdf.__trade_research_thai_manual_evidence_no_delete();

alter table public.buyer_trade_research_thai_manual_evidence enable row level security;

create policy buyer_trade_research_thai_manual_evidence_member_select
  on public.buyer_trade_research_thai_manual_evidence
  for select to authenticated
  using (workspace_id = mdf.current_workspace_id());

revoke all on public.buyer_trade_research_thai_manual_evidence from public, anon, authenticated;
grant select on public.buyer_trade_research_thai_manual_evidence to authenticated;
grant select, insert, update on public.buyer_trade_research_thai_manual_evidence to service_role;

notify pgrst, 'reload schema';
