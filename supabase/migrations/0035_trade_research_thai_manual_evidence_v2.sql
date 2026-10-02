-- TH05 Step 0 — manual-evidence chain integrity + atomic supersession.
--
-- TH04C defined active rows incorrectly (any row with
-- `supersedes_id = <previous>` was treated as inactive) and its
-- supersession path was non-transactional (withdraw-then-insert as
-- two independent writes). This migration:
--
--   • removes the TH04C partial unique index that keyed activity on
--     `supersedes_id IS NULL` — that was the wrong semantic;
--   • adds a unique index on `supersedes_id WHERE NOT NULL` so no
--     two rows can supersede the same parent (fork-race safe);
--   • adds a transactional RPC `supersede_thai_manual_evidence`
--     that locks the previous row FOR UPDATE, verifies it is still
--     a leaf AND not withdrawn, and inserts the replacement in the
--     same transaction. Either both land or neither does.
--
-- Append-only identity-immutability from 0034 is preserved; this
-- migration adds a safe write path and a chain-integrity guard
-- without rewriting any existing row.

-- 1. Drop the (semantically wrong) partial unique index. Historical
-- rows remain untouched. The new leaf-uniqueness invariant is
-- enforced below (one child per parent + RPC-mediated supersession).
drop index if exists public.buyer_trade_research_thai_manual_evidence_active_unique;

-- 2. Chain-integrity: at most one child per parent. This prevents
-- two concurrent supersession attempts from forking the chain.
create unique index buyer_trade_research_thai_manual_evidence_supersedes_unique
  on public.buyer_trade_research_thai_manual_evidence(supersedes_id)
  where supersedes_id is not null;

-- 3. Transactional supersession RPC. Service-role only (writes). The
-- caller passes the previous row id and the full new-row payload;
-- the function locks the previous row, enforces chain-leaf and not-
-- withdrawn status, and inserts the replacement atomically. The
-- previous row stays active (append-only historical) until the
-- insert succeeds — a failure of either step rolls everything back
-- and the previous leaf remains the current leaf.
create or replace function public.supersede_thai_manual_evidence(
  p_previous_id             uuid,
  p_workspace_id            uuid,
  p_candidate_id            uuid,
  p_provider_id             text,
  p_captured_by_user_id     uuid,
  p_source_url              text,
  p_source_label            text,
  p_evidence_payload        jsonb,
  p_evidence_status         text
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
  -- Lock the previous row so a concurrent attempt cannot race.
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
  -- Reject when the previous row is already superseded.
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
    automatic_spend_rupees
  ) values (
    p_workspace_id, p_candidate_id, p_provider_id,
    p_captured_by_user_id, p_source_url, p_source_label,
    p_evidence_payload, p_evidence_status, p_previous_id,
    0
  ) returning * into v_new;
  return v_new;
end $$;

revoke all on function public.supersede_thai_manual_evidence(uuid, uuid, uuid, text, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.supersede_thai_manual_evidence(uuid, uuid, uuid, text, uuid, text, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
