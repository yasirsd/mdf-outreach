-- TH06 Step 0 — multi-root race prevention + lookup-basis provenance.
--
-- TH05 fixed supersession forks (unique index on supersedes_id) but
-- two independent ROOT inserts for the same (workspace, candidate,
-- provider) could still race. This migration:
--
--   1. Adds `lookup_basis` + `lookup_basis_detail` columns to
--      capture HOW an operator performed the registry lookup so
--      aggregation can decide when a `not_found` note is a
--      reliable negative. Additive; nullable; existing rows
--      preserve historical semantics (conservative).
--
--   2. Introduces `public.create_thai_manual_evidence` and
--      replaces the TH05 supersession RPC with one that uses the
--      SAME transaction-scoped PostgreSQL advisory lock derived
--      deterministically from (workspace, candidate, provider).
--      Both root creation and supersession serialize on the same
--      lock. Two concurrent `create` or `supersede` attempts for
--      the same tuple cannot both commit a root/leaf.
--
--   3. Extends the identity-immutability guard to freeze the new
--      columns on UPDATE (same policy as every other identity
--      field in 0034).
--
-- Append-only history preserved; TH05's chain-integrity index
-- (`UNIQUE (supersedes_id) WHERE NOT NULL`) remains in force.

-- 1. Add the new columns. NULL means "historical row recorded
--    before lookup_basis was collected" — the aggregator treats
--    those conservatively (never promotes to authoritative
--    not_found).
alter table public.buyer_trade_research_thai_manual_evidence
  add column lookup_basis text check (lookup_basis is null or lookup_basis in (
    'juristic_number',
    'license_number',
    'exact_legal_name',
    'name_search',
    'other'
  )),
  add column lookup_basis_detail text;

-- 2. Extend the identity-immutability guard.
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
     or old.created_at <> new.created_at
     or old.lookup_basis is distinct from new.lookup_basis
     or old.lookup_basis_detail is distinct from new.lookup_basis_detail then
    raise exception 'trade research thai manual evidence identity fields are immutable';
  end if;
  if old.evidence_status <> new.evidence_status
     and new.evidence_status <> 'withdrawn' then
    raise exception 'thai manual evidence may only transition to withdrawn in place; use supersedes_id for corrections';
  end if;
  return new;
end $$;

-- 3. Helper — derive a deterministic 64-bit advisory-lock key from
--    (workspace, candidate, provider). Hashing concatenation of the
--    three stable identifiers; collisions across unrelated tuples
--    are negligible in practice and would at worst cause harmless
--    serialization.
create or replace function mdf.__thai_manual_evidence_lock_key(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_provider_id text
) returns bigint language sql immutable set search_path = '' as $$
  select ('x' || substr(
    md5(p_workspace_id::text || '|' || p_candidate_id::text || '|' || p_provider_id),
    1, 16
  ))::bit(64)::bigint;
$$;

-- 4. Transactional ROOT-create. Takes the (workspace, candidate,
--    provider) advisory lock, rejects when a current leaf already
--    exists, then inserts a root row (supersedes_id = null).
create or replace function public.create_thai_manual_evidence(
  p_workspace_id            uuid,
  p_candidate_id            uuid,
  p_provider_id             text,
  p_captured_by_user_id     uuid,
  p_source_url              text,
  p_source_label            text,
  p_evidence_payload        jsonb,
  p_evidence_status         text,
  p_lookup_basis            text default null,
  p_lookup_basis_detail     text default null
)
returns public.buyer_trade_research_thai_manual_evidence
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_leaf_exists boolean;
  v_new public.buyer_trade_research_thai_manual_evidence;
begin
  perform pg_advisory_xact_lock(mdf.__thai_manual_evidence_lock_key(p_workspace_id, p_candidate_id, p_provider_id));
  select exists (
    select 1
    from public.buyer_trade_research_thai_manual_evidence r
    where r.workspace_id = p_workspace_id
      and r.candidate_id = p_candidate_id
      and r.provider_id = p_provider_id
      and r.evidence_status <> 'withdrawn'
      and not exists (
        select 1 from public.buyer_trade_research_thai_manual_evidence c
          where c.supersedes_id = r.id
      )
  ) into v_leaf_exists;
  if v_leaf_exists then
    raise exception 'MANUAL_EVIDENCE_ACTIVE_EXISTS' using errcode = 'P0001';
  end if;
  insert into public.buyer_trade_research_thai_manual_evidence(
    workspace_id, candidate_id, provider_id,
    captured_by_user_id, source_url, source_label,
    evidence_payload, evidence_status, supersedes_id,
    automatic_spend_rupees, lookup_basis, lookup_basis_detail
  ) values (
    p_workspace_id, p_candidate_id, p_provider_id,
    p_captured_by_user_id, p_source_url, p_source_label,
    p_evidence_payload, p_evidence_status, null,
    0, p_lookup_basis, p_lookup_basis_detail
  ) returning * into v_new;
  return v_new;
end $$;

revoke all on function public.create_thai_manual_evidence(uuid, uuid, text, uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.create_thai_manual_evidence(uuid, uuid, text, uuid, text, text, jsonb, text, text, text) to service_role;

-- 5. Replace the TH05 supersession RPC with one that acquires the
--    SAME advisory lock before locking the previous row FOR UPDATE,
--    so a concurrent create / supersede on the same tuple
--    serializes. New signature carries the lookup_basis columns.
--
--    DROP + CREATE keeps the semantic contract explicit; the TH05
--    migration 0035 remains intact for audit.
drop function if exists public.supersede_thai_manual_evidence(uuid, uuid, uuid, text, uuid, text, text, jsonb, text);

create or replace function public.supersede_thai_manual_evidence(
  p_previous_id             uuid,
  p_workspace_id            uuid,
  p_candidate_id            uuid,
  p_provider_id             text,
  p_captured_by_user_id     uuid,
  p_source_url              text,
  p_source_label            text,
  p_evidence_payload        jsonb,
  p_evidence_status         text,
  p_lookup_basis            text default null,
  p_lookup_basis_detail     text default null
)
returns public.buyer_trade_research_thai_manual_evidence
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous public.buyer_trade_research_thai_manual_evidence;
  v_child_exists boolean;
  v_new public.buyer_trade_research_thai_manual_evidence;
begin
  perform pg_advisory_xact_lock(mdf.__thai_manual_evidence_lock_key(p_workspace_id, p_candidate_id, p_provider_id));
  select * into v_previous
    from public.buyer_trade_research_thai_manual_evidence
    where id = p_previous_id
      and workspace_id = p_workspace_id
      and candidate_id = p_candidate_id
      and provider_id = p_provider_id
    for update;
  if not found then
    raise exception 'MANUAL_EVIDENCE_PREVIOUS_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_previous.evidence_status = 'withdrawn' then
    raise exception 'MANUAL_EVIDENCE_PREVIOUS_WITHDRAWN' using errcode = 'P0001';
  end if;
  select exists (
    select 1 from public.buyer_trade_research_thai_manual_evidence
      where supersedes_id = p_previous_id
  ) into v_child_exists;
  if v_child_exists then
    raise exception 'MANUAL_EVIDENCE_PREVIOUS_NOT_LEAF' using errcode = 'P0001';
  end if;
  insert into public.buyer_trade_research_thai_manual_evidence(
    workspace_id, candidate_id, provider_id,
    captured_by_user_id, source_url, source_label,
    evidence_payload, evidence_status, supersedes_id,
    automatic_spend_rupees, lookup_basis, lookup_basis_detail
  ) values (
    p_workspace_id, p_candidate_id, p_provider_id,
    p_captured_by_user_id, p_source_url, p_source_label,
    p_evidence_payload, p_evidence_status, p_previous_id,
    0, p_lookup_basis, p_lookup_basis_detail
  ) returning * into v_new;
  return v_new;
end $$;

revoke all on function public.supersede_thai_manual_evidence(uuid, uuid, uuid, text, uuid, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.supersede_thai_manual_evidence(uuid, uuid, uuid, text, uuid, text, text, jsonb, text, text, text) to service_role;

notify pgrst, 'reload schema';
