-- READ-ONLY post-apply verification for migration 0024.
-- Run after applying 0024. Performs SELECTs only and never invokes the RPC.

with sync_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'sync_product_trade_mappings'
    and pg_get_function_identity_arguments(p.oid) = 'p_input jsonb'
), report as (
  select 'sync_rpc_present'::text as check_id,
    case when count(*) = 1 then 'ok' else 'FAIL: expected exactly one sync_product_trade_mappings(jsonb)' end as status
  from sync_function

  union all

  select 'weight_uses_null_safe_numeric_equality',
    case when definition ~* $re$v_existing\.weight\s+is\s+not\s+distinct\s+from\s+nullif\(v_row->>'weight',\s*''\)::numeric$re$
      then 'ok' else 'FAIL: numeric NULL-safe weight comparator missing' end
  from sync_function

  union all

  select 'text_weight_comparator_removed',
    case when definition ~* $re$v_existing\.weight::text$re$
      then 'FAIL: text weight comparator remains' else 'ok' end
  from sync_function

  union all

  select 'sync_rpc_definer',
    case when prosecdef then 'ok' else 'FAIL: sync RPC is not SECURITY DEFINER' end
  from sync_function

  union all

  select 'sync_rpc_search_path',
    case when 'search_path=public, mdf, pg_temp' = any (proconfig)
      then 'ok' else 'FAIL: sync RPC search_path is not fixed' end
  from sync_function

  union all

  select 'sync_rpc_service_role_grant',
    case when has_function_privilege('service_role', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'ok' else 'FAIL: service_role missing EXECUTE' end

  union all

  select 'sync_rpc_authenticated_denied',
    case when has_function_privilege('authenticated', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'FAIL: authenticated has EXECUTE' else 'ok' end

  union all

  select 'sync_rpc_anon_denied',
    case when has_function_privilege('anon', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'FAIL: anon has EXECUTE' else 'ok' end

  union all

  select 'mapping_row_snapshot',
    'informational: total=' || count(*) || ', active=' || count(*) filter (where is_active)
  from public.product_trade_mappings
)
select * from report order by check_id;
