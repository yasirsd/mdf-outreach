-- READ-ONLY post-apply verification for migration 0025.
with expected(name) as (values
  ('buyer_trade_research_batches'),('buyer_trade_research_jobs'),('buyer_trade_research_provider_plans'),
  ('buyer_trade_research_attempts'),('buyer_trade_research_events'),('buyer_trade_source_snapshots')
), workspace_tables(name) as (values
  ('buyer_trade_research_batches'),('buyer_trade_research_jobs'),('buyer_trade_research_provider_plans'),
  ('buyer_trade_research_attempts'),('buyer_trade_research_events')
), report as (
  select 'tables_present'::text check_id, case when count(*) filter (where to_regclass('public.' || name) is null)=0 then 'ok' else 'FAIL: table missing' end status from expected
  union all select 'rls_enabled', case when count(*) filter (where not c.relrowsecurity)=0 then 'ok' else 'FAIL: RLS disabled' end
    from expected e join pg_class c on c.oid=to_regclass('public.' || e.name)
  union all select 'authenticated_select_only', case when count(*) filter (
    where not has_table_privilege('authenticated','public.' || name,'select')
       or has_table_privilege('authenticated','public.' || name,'insert,update,delete')
  )=0 then 'ok' else 'FAIL: authenticated grants incorrect' end from workspace_tables
  union all select 'anon_denied', case when count(*) filter (where has_table_privilege('anon','public.' || name,'select'))=0 then 'ok' else 'FAIL: anon can read' end from expected
  union all select 'snapshots_server_only', case when not has_table_privilege('authenticated','public.buyer_trade_source_snapshots','select') then 'ok' else 'FAIL: snapshot cache browser-readable' end
  union all select 'automatic_spend_zero', case when
    (select count(*) from public.buyer_trade_research_batches where automatic_spend_rupees<>0) +
    (select count(*) from public.buyer_trade_research_jobs where automatic_spend_rupees<>0) +
    (select count(*) from public.buyer_trade_research_provider_plans where automatic_spend_rupees<>0) +
    (select count(*) from public.buyer_trade_research_attempts where automatic_spend_rupees<>0) +
    (select count(*) from public.buyer_trade_research_events where automatic_spend_rupees<>0) = 0 then 'ok' else 'FAIL: nonzero automatic spend' end
  union all select 'claim_service_role_only', case when
    has_function_privilege('service_role','public.claim_buyer_trade_research_job(text,timestamp with time zone)','execute')
    and not has_function_privilege('authenticated','public.claim_buyer_trade_research_job(text,timestamp with time zone)','execute')
    and not has_function_privilege('anon','public.claim_buyer_trade_research_job(text,timestamp with time zone)','execute')
    then 'ok' else 'FAIL: claim RPC grants incorrect' end
)
select * from report order by check_id;

