-- TH07 — Thailand manual-evidence 42501 repair (option D).
--
-- Production: POST of Thai FDA / DBD / Customs manual evidence returned
-- HTTP 500 with PostgreSQL `42501 permission denied for schema mdf`.
--
-- Migration 0036's public RPCs are SECURITY INVOKER, EXECUTE only for
-- service_role, and `SET search_path = ''`. Their first statement named
-- `mdf.__thai_manual_evidence_lock_key(...)`. service_role does not have
-- USAGE ON SCHEMA mdf (0028 granted USAGE only to authenticated), so
-- name lookup failed before INSERT.
--
-- This migration redefines the two public RPCs with the lock-key
-- expression inlined. The algorithm is copied byte-for-byte from the
-- 0036 helper so advisory-lock keys stay compatible. The helper is
-- left in place; it is simply no longer called from the invoker RPCs.
--
-- Does NOT:
--   • GRANT USAGE ON SCHEMA mdf to service_role / authenticated / public
--   • GRANT ALL ON SCHEMA mdf
--   • switch the RPCs to SECURITY DEFINER
--   • drop the 0036 helper
--   • change signatures, leaf-check, insert shape, or grants
--   • touch Buyer Send, Hunter, scheduler, other countries, or 0037

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
  perform pg_advisory_xact_lock(
    ('x' || substr(
      md5(p_workspace_id::text || '|' || p_candidate_id::text || '|' || p_provider_id),
      1, 16
    ))::bit(64)::bigint
  );
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
  perform pg_advisory_xact_lock(
    ('x' || substr(
      md5(p_workspace_id::text || '|' || p_candidate_id::text || '|' || p_provider_id),
      1, 16
    ))::bit(64)::bigint
  );
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
