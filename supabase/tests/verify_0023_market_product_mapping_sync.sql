-- READ-ONLY post-apply verification for migration 0023 (MI1C).
-- Run AFTER the operator applies 0023. Performs SELECTs only.
-- Does NOT invoke the sync RPC.
--
-- Asserts:
--   • The three new lifecycle columns exist on product_trade_mappings.
--   • public.sync_product_trade_mappings exists, is SECURITY DEFINER
--     with the fixed search_path, granted to service_role only.
--   • 0022 mutation-RPC grants unchanged.
--   • Migration seeded NO product_trade_mappings rows.
--   • Buyer / MI evidence rowcounts unchanged (informational snapshot).

with new_columns(name) as (
  values ('is_active'), ('last_synced_at'), ('registry_version')
), mi_mutation_rpcs(name, args) as (
  values
    ('ingest_market_intelligence_source', 'jsonb'),
    ('verify_market_intelligence_source', 'uuid, jsonb'),
    ('ingest_market_trade_observation',   'uuid, jsonb'),
    ('record_market_fetch_result',        'jsonb'),
    ('refresh_market_intelligence',       'text, text, jsonb')
), rowcounts as (
  select
    (select count(*) from public.product_trade_mappings)::bigint as mappings_count,
    (select count(*) from public.market_trade_observations)::bigint as observations_count,
    (select count(*) from public.market_product_scores)::bigint as scores_count,
    (select count(*) from public.buyers)::bigint as buyer_count,
    (select count(*) from public.buyer_finder_candidate_conversions)::bigint as conversion_count
), report as (
  select 'lifecycle_column_present'::text as check_id, c.name as detail,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'product_trade_mappings'
        and column_name = c.name
    ) then 'ok' else 'FAIL: column missing' end as status
  from new_columns c

  union all

  select 'sync_rpc_definer', 'sync_product_trade_mappings(jsonb)',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sync_product_trade_mappings' and p.prosecdef
    ) then 'ok' else 'FAIL: sync RPC missing / not SECURITY DEFINER' end

  union all

  select 'sync_rpc_search_path', 'sync_product_trade_mappings(jsonb)',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sync_product_trade_mappings'
        and 'search_path=public, mdf, pg_temp' = any (p.proconfig)
    ) then 'ok' else 'FAIL: sync RPC search_path not fixed to public,mdf,pg_temp' end

  union all

  select 'sync_rpc_service_role_grant', 'sync_product_trade_mappings(jsonb)',
    case when has_function_privilege('service_role', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'ok' else 'FAIL: service_role missing EXECUTE' end

  union all

  select 'sync_rpc_authenticated_denied', 'sync_product_trade_mappings(jsonb)',
    case when has_function_privilege('authenticated', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'FAIL: authenticated retains EXECUTE' else 'ok' end

  union all

  select 'sync_rpc_anon_denied', 'sync_product_trade_mappings(jsonb)',
    case when has_function_privilege('anon', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'FAIL: anon can execute' else 'ok' end

  union all

  select '0022_mutation_authenticated_denied', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'authenticated',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'FAIL: 0022 grant regressed — authenticated has EXECUTE'
      else 'ok' end
  from mi_mutation_rpcs r

  union all

  select '0022_mutation_service_role_present', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'service_role',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'ok'
      else 'FAIL: 0022 grant regressed — service_role missing EXECUTE' end
  from mi_mutation_rpcs r

  union all

  select 'product_trade_mappings_not_seeded', 'row_count',
    case when mappings_count = 0 then 'ok'
      else 'FAIL: migration must not seed product_trade_mappings' end
  from rowcounts

  union all

  select 'mi_evidence_unchanged', 'observations_count=' || observations_count || ',scores_count=' || scores_count,
    'informational: compare against pre-apply snapshot'
  from rowcounts

  union all

  select 'buyer_snapshot', 'buyers=' || buyer_count || ',conversions=' || conversion_count,
    'informational: compare against pre-apply snapshot'
  from rowcounts
)
select * from report order by check_id, detail;
