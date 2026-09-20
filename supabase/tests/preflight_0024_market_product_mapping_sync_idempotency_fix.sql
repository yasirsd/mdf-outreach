-- READ-ONLY preflight for migration 0024.
-- Run before applying 0024. Performs SELECTs only and never invokes the RPC.

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
    case when count(*) = 1 then 'ok' else 'BLOCK: expected exactly one sync_product_trade_mappings(jsonb)' end as status
  from sync_function

  union all

  select '0023_text_weight_bug_present',
    case when definition ~* $re$v_existing\.weight::text$re$
      then 'ok: 0023 comparator found; 0024 is required'
      else 'BLOCK: current function does not match the expected 0023 implementation' end
  from sync_function

  union all

  select 'sync_rpc_definer',
    case when prosecdef then 'ok' else 'BLOCK: sync RPC is not SECURITY DEFINER' end
  from sync_function

  union all

  select 'sync_rpc_search_path',
    case when 'search_path=public, mdf, pg_temp' = any (proconfig)
      then 'ok' else 'BLOCK: sync RPC search_path is not fixed' end
  from sync_function

  union all

  select 'sync_rpc_service_role_grant',
    case when has_function_privilege('service_role', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'ok' else 'BLOCK: service_role missing EXECUTE' end

  union all

  select 'sync_rpc_authenticated_denied',
    case when has_function_privilege('authenticated', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'BLOCK: authenticated has EXECUTE' else 'ok' end

  union all

  select 'sync_rpc_anon_denied',
    case when has_function_privilege('anon', 'public.sync_product_trade_mappings(jsonb)', 'execute')
      then 'BLOCK: anon has EXECUTE' else 'ok' end

  union all

  select 'mapping_row_snapshot',
    'informational: total=' || count(*) || ', active=' || count(*) filter (where is_active)
  from public.product_trade_mappings
)
select * from report order by check_id;

