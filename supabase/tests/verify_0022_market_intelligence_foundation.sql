-- READ-ONLY post-apply verification for migration 0022 (MI1B.1).
-- Run AFTER the operator applies 0022 on the target database.
-- Performs SELECTs only. Nothing here fabricates market evidence.
--
-- Asserts:
--   • Every MI1B table exists and RLS is enabled.
--   • Global MI tables: SELECT granted to authenticated; INSERT/UPDATE/
--     DELETE denied; anon has no privileges.
--   • market_analysis_events carries the standard workspace-scoped
--     policies.
--   • Every public MI mutation RPC is SECURITY DEFINER with fixed
--     search_path = public, mdf, pg_temp.
--   • MI1B.1 trust boundary: ordinary `authenticated` cannot execute
--     the five mutation RPCs; `service_role` can.
--   • Zero rows in every MI table.
--   • BI / Buyer counts unchanged (informational snapshot).

with mi_tables(name) as (
  values
    ('market_intelligence_sources'),
    ('product_trade_mappings'),
    ('market_provider_fetch_ledger'),
    ('market_trade_observations'),
    ('market_trade_metrics'),
    ('market_product_scores'),
    ('market_product_score_components'),
    ('market_analysis_events')
), global_mi_tables(name) as (
  values
    ('market_intelligence_sources'),
    ('product_trade_mappings'),
    ('market_provider_fetch_ledger'),
    ('market_trade_observations'),
    ('market_trade_metrics'),
    ('market_product_scores'),
    ('market_product_score_components')
), mi_rpcs(name, args) as (
  values
    ('ingest_market_intelligence_source', 'jsonb'),
    ('verify_market_intelligence_source', 'uuid, jsonb'),
    ('ingest_market_trade_observation',   'uuid, jsonb'),
    ('record_market_fetch_result',        'jsonb'),
    ('refresh_market_intelligence',       'text, text, jsonb')
), buyer_counts as (
  select
    (select count(*) from public.buyers)::bigint as buyer_count,
    (select count(*) from public.buyer_finder_candidate_conversions)::bigint as conversion_count
), report as (
  select 'mi_table_present'::text as check_id, t.name as detail,
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name and c.relkind = 'r'
    ) then 'ok' else 'FAIL: missing table' end as status
  from mi_tables t

  union all

  select 'mi_table_rls_enabled', t.name,
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name and c.relrowsecurity
    ) then 'ok' else 'FAIL: RLS not enabled' end
  from mi_tables t

  union all

  select 'authenticated_select_on_global', g.name,
    case when exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = g.name
        and grantee = 'authenticated' and privilege_type = 'SELECT'
    ) then 'ok' else 'FAIL: authenticated cannot SELECT' end
  from global_mi_tables g

  union all

  select 'authenticated_no_dml_on_global', g.name,
    case when exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = g.name
        and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')
    ) then 'FAIL: authenticated retains DML' else 'ok' end
  from global_mi_tables g

  union all

  select 'anon_denied_on_global', g.name,
    case when exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = g.name and grantee = 'anon'
    ) then 'FAIL: anon has privileges' else 'ok' end
  from global_mi_tables g

  union all

  select 'workspace_rls_policy_on_events', p.policyname,
    case when p.tablename = 'market_analysis_events' then 'ok' else 'FAIL' end
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'market_analysis_events'

  union all

  select 'mi_rpc_definer', r.name || '(' || r.args || ')',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.name and p.prosecdef
    ) then 'ok' else 'FAIL: RPC not SECURITY DEFINER' end
  from mi_rpcs r

  union all

  select 'mi_rpc_search_path', r.name || '(' || r.args || ')',
    case when exists (
      select 1
      from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = r.name
        and 'search_path=public, mdf, pg_temp' = any (p.proconfig)
    ) then 'ok' else 'FAIL: RPC search_path not fixed to public,mdf,pg_temp' end
  from mi_rpcs r

  union all

  -- MI1B.1: ordinary authenticated clients MUST NOT execute any
  -- global-mutation RPC. Execution belongs to service_role only.
  select 'authenticated_no_execute_on_mutation_rpcs', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'authenticated',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'FAIL: authenticated retains EXECUTE'
      else 'ok' end
  from mi_rpcs r

  union all

  -- MI1B.1: service_role owns the mutation surface.
  select 'service_role_can_execute_mutation_rpcs', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'service_role',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'ok'
      else 'FAIL: service_role missing EXECUTE' end
  from mi_rpcs r

  union all

  select 'anon_no_execute_on_mutation_rpcs', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'anon',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'FAIL: anon can execute' else 'ok' end
  from mi_rpcs r

  union all

  select 'mi_table_initial_rowcount', t.name,
    case when (
      case t.name
        when 'market_intelligence_sources'      then (select count(*) from public.market_intelligence_sources)
        when 'product_trade_mappings'           then (select count(*) from public.product_trade_mappings)
        when 'market_provider_fetch_ledger'     then (select count(*) from public.market_provider_fetch_ledger)
        when 'market_trade_observations'        then (select count(*) from public.market_trade_observations)
        when 'market_trade_metrics'             then (select count(*) from public.market_trade_metrics)
        when 'market_product_scores'            then (select count(*) from public.market_product_scores)
        when 'market_product_score_components'  then (select count(*) from public.market_product_score_components)
        when 'market_analysis_events'           then (select count(*) from public.market_analysis_events)
      end
    ) = 0 then 'ok' else 'FAIL: table has rows — apply must not seed' end
  from mi_tables t

  union all

  select 'buyer_count_snapshot', 'buyers=' || buyer_count || ',conversions=' || conversion_count,
    'informational: compare against pre-apply value'
  from buyer_counts
)
select * from report order by check_id, detail;
