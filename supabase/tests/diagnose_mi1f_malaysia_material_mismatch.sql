-- MI1F.1 read-only operator diagnostic. Do not execute from application code.
-- This exposes the persisted side of the immutable 0022 equality contract;
-- the rejected incoming payload was not stored, so its differing value cannot
-- be reconstructed from the historical RPC response alone.

with malaysia_rows as (
  select
    o.id,
    o.provider_id,
    o.dataset_id,
    o.reporter_country,
    o.partner_country,
    o.partner_key,
    o.trade_flow,
    o.hs_revision,
    o.hs_code,
    o.frequency,
    o.period,
    o.trade_value_usd,
    o.quantity,
    o.quantity_unit,
    o.net_weight_kg,
    o.source_period,
    o.source_url,
    o.safe_source_ref,
    o.retrieved_at,
    o.metadata
  from public.market_trade_observations o
  where o.provider_id = 'baci_oec'
    and o.dataset_id = 'baci-hs17'
    and o.reporter_country = 'MY'
    and o.trade_flow = 'import'
    and o.hs_revision = 'HS17'
    and o.hs_code = '090421'
    and o.frequency = 'annual'
    and o.partner_country is not null
)
select *
from malaysia_rows
order by period, partner_country;

select
  provider_id,
  dataset_id,
  reporter_country,
  partner_country,
  trade_flow,
  hs_revision,
  hs_codes,
  frequency,
  coverage_start,
  coverage_end,
  query_fingerprint,
  fetched_at,
  fresh_until,
  outcome,
  rows_received,
  safe_metadata
from public.market_provider_fetch_ledger
where provider_id = 'baci_oec'
  and dataset_id = 'baci-hs17'
  and reporter_country = 'MY'
order by fetched_at desc;

select
  id,
  provider_id,
  dataset_id,
  service_terms_verified,
  storage_allowed,
  licence_verified_at,
  source_url,
  safe_reference,
  retrieved_at,
  metadata
from public.market_intelligence_sources
where provider_id = 'baci_oec'
  and dataset_id = 'baci-hs17';

select pg_get_functiondef(
  'public.ingest_market_trade_observation(uuid,jsonb)'::regprocedure
) as immutable_observation_ingest_contract;

