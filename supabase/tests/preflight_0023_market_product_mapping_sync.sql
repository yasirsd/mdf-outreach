-- READ-ONLY operator preflight for migration 0023 (MI1C product mapping sync).
-- Run manually before applying 0023. Performs SELECTs only.
-- No writes, no external network I/O.
--
-- Verifies:
--   * 0022 MI tables still exist.
--   * product_trade_mappings exists.
--   * The three additive lifecycle columns (is_active, last_synced_at,
--     registry_version) are ABSENT before this apply.
--   * public.sync_product_trade_mappings does NOT already exist.
--   * MI1B.1 mutation-RPC grants remain service_role-only
--     (no unexpected widening).
--   * Buyer/BI foundation still intact.

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
), new_columns(name) as (
  values ('is_active'), ('last_synced_at'), ('registry_version')
), mi_mutation_rpcs(name, args) as (
  values
    ('ingest_market_intelligence_source', 'jsonb'),
    ('verify_market_intelligence_source', 'uuid, jsonb'),
    ('ingest_market_trade_observation',   'uuid, jsonb'),
    ('record_market_fetch_result',        'jsonb'),
    ('refresh_market_intelligence',       'text, text, jsonb')
), required_bi_tables(name) as (
  values
    ('buyers'),
    ('buyer_finder_candidate_conversions'),
    ('buyer_candidates'),
    ('buyer_intelligence_sources'),
    ('workspaces')
), report as (
  select 'mi_table_present'::text as check_id, t.name as detail,
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name and c.relkind = 'r'
    ) then 'ok' else 'BLOCK: 0022 table missing' end as status
  from mi_tables t

  union all

  select 'new_column_absent_before_apply', c.name,
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'product_trade_mappings'
        and column_name = c.name
    ) then 'BLOCK: column already exists' else 'ok' end
  from new_columns c

  union all

  select 'sync_rpc_absent_before_apply', 'sync_product_trade_mappings',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sync_product_trade_mappings'
    ) then 'BLOCK: sync RPC already exists' else 'ok' end

  union all

  -- 0022 boundary check: authenticated must have NO execute on the
  -- five mutation RPCs. Anything else is a regression to investigate.
  select 'mi_mutation_authenticated_denied', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'authenticated',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'BLOCK: authenticated has EXECUTE on mutation RPC — investigate'
      else 'ok' end
  from mi_mutation_rpcs r

  union all

  select 'mi_mutation_service_role_grant', r.name || '(' || r.args || ')',
    case when has_function_privilege(
      'service_role',
      format('public.%s(%s)', r.name, r.args),
      'execute'
    ) then 'ok'
      else 'BLOCK: service_role missing EXECUTE on 0022 mutation RPC' end
  from mi_mutation_rpcs r

  union all

  select 'required_bi_table_present', b.name,
    case when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = b.name
    ) then 'ok' else 'BLOCK: BI/BF foundation table missing' end
  from required_bi_tables b

  union all

  select 'mi_helper_present', 'mdf.current_workspace_id()',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'mdf' and p.proname = 'current_workspace_id'
    ) then 'ok' else 'BLOCK: mdf.current_workspace_id() missing' end
)
select * from report order by check_id, detail;
