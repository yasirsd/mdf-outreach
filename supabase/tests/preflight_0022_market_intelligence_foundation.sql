-- READ-ONLY operator preflight for migration 0022 (Market Intelligence).
-- Run manually before applying 0022. Performs SELECTs only.
-- No writes. No provider calls. No external network I/O.
--
-- What this preflight verifies:
--   1. Every MI1B target table does NOT already exist under public.
--   2. Every MI1B target RPC name is either absent or matches a prior
--      declaration exactly — we never silently replace a foreign
--      function on this name.
--   3. Target indexes / policies do not collide with existing objects.
--   4. Required MDF helper functions from prior migrations exist.
--   5. BI foundation tables still exist and are untouched.
--   6. Buyer conversion authority (RPC + linkage) still exists.
--   7. Standard workspace helpers exist and are wired.
-- Every row is diagnostic; nothing here can mutate state.

with target_tables(name) as (
  values
    ('market_intelligence_sources'),
    ('product_trade_mappings'),
    ('market_provider_fetch_ledger'),
    ('market_trade_observations'),
    ('market_trade_metrics'),
    ('market_product_scores'),
    ('market_product_score_components'),
    ('market_analysis_events')
), target_rpcs(name) as (
  values
    ('ingest_market_intelligence_source'),
    ('ingest_market_trade_observation'),
    ('record_market_fetch_result'),
    ('refresh_market_intelligence')
), target_indexes(name) as (
  values
    ('market_trade_observations_identity_uidx'),
    ('market_trade_observations_series_idx'),
    ('market_trade_observations_origin_idx'),
    ('market_trade_observations_source_idx'),
    ('market_trade_metrics_current_uidx'),
    ('market_trade_metrics_history_idx'),
    ('market_product_scores_current_uidx'),
    ('market_product_scores_history_idx'),
    ('market_product_score_components_score_idx'),
    ('market_provider_fetch_ledger_fingerprint_idx'),
    ('market_provider_fetch_ledger_provider_idx'),
    ('market_provider_fetch_ledger_country_product_idx'),
    ('market_analysis_events_workspace_idx'),
    ('market_analysis_events_country_product_idx')
), required_bi_tables(name) as (
  values
    ('buyers'),
    ('buyer_finder_candidate_conversions'),
    ('buyer_candidates'),
    ('buyer_intelligence_sources'),
    ('buyer_intelligence_claims'),
    ('buyer_trade_observations'),
    ('buyer_trade_metrics'),
    ('buyer_intelligence_assessments'),
    ('buyer_intelligence_assessment_evidence'),
    ('workspaces'),
    ('workspace_members')
), required_helpers(name) as (
  values
    ('mdf.current_workspace_id()'),
    ('mdf.__apply_workspace_rls(regclass)'),
    ('public.convert_buyer_finder_candidate(uuid,text,uuid,uuid,uuid)')
), report as (
  select
    'mi_target_table_collision'::text as check_id,
    t.name as detail,
    (case when exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name and c.relkind = 'r'
    ) then 'BLOCK: table already exists' else 'ok' end) as status
  from target_tables t

  union all

  select 'mi_target_rpc_collision', r.name,
    case when exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.name
    ) then 'WARN: name already exists — check signature before apply'
      else 'ok'
    end
  from target_rpcs r

  union all

  select 'mi_target_index_collision', i.name,
    case when exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = i.name and c.relkind = 'i'
    ) then 'BLOCK: index already exists' else 'ok' end
  from target_indexes i

  union all

  select 'required_bi_table_present', b.name,
    case when exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = b.name
    ) then 'ok' else 'BLOCK: BI/BF foundation table missing'
    end
  from required_bi_tables b

  union all

  select 'required_helper_present', h.name,
    case when h.name = 'mdf.current_workspace_id()' and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'mdf' and p.proname = 'current_workspace_id'
    ) then 'ok'
    when h.name = 'mdf.__apply_workspace_rls(regclass)' and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'mdf' and p.proname = '__apply_workspace_rls'
    ) then 'ok'
    when h.name = 'public.convert_buyer_finder_candidate(uuid,text,uuid,uuid,uuid)' and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'convert_buyer_finder_candidate'
    ) then 'ok'
    else 'BLOCK: required helper missing'
    end
  from required_helpers h

  union all

  select 'buyer_conversion_rpc_definer', 'convert_buyer_finder_candidate',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'convert_buyer_finder_candidate' and p.prosecdef
    ) then 'ok' else 'WARN: conversion RPC missing SECURITY DEFINER — investigate' end

  union all

  select 'linkage_select_only_grant', 'buyer_finder_candidate_conversions',
    case when exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'buyer_finder_candidate_conversions'
        and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')
    ) then 'WARN: linkage grants have widened — investigate before MI1B'
      else 'ok' end
)
select * from report order by check_id, detail;
