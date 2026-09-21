-- ============================================================================
-- MI1D.4 — READ-ONLY OPERATOR VERIFICATION
-- Controlled BACI proof: Malaysia × HS17 × 090421 × 2017–2024 (all exporters)
--
-- SAFETY CONTRACT (this file may be pasted into the Supabase SQL Editor):
--   • ONLY SELECT / WITH statements.
--   • NO INSERT / UPDATE / DELETE / MERGE / UPSERT.
--   • NO DDL (CREATE / DROP / ALTER / TRUNCATE).
--   • NO RPC / function-call side effects.
--   • Column and table names come from the applied immutable migration
--     supabase/migrations/0022_market_intelligence_foundation.sql (verified
--     during MI1D.4).
--
-- REPORTING SHAPE
--   Every check is emitted twice:
--     1) In the ROLLED-UP result set at the end of the file, with columns
--          (check_id text, status text, details text).
--     2) As its own evidence result set with the raw supporting rows, so
--        the operator can inspect the actual data instead of trusting a
--        pass/fail label.
--
--   status = 'PASS'  → the expectation held.
--   status = 'FAIL'  → the expectation did NOT hold; details name what
--                      changed. Investigate before running the proof again.
--   status = 'INFO'  → informational evidence (top origins, series). Never
--                      failing on its own.
--
--   No check writes anywhere.
-- ============================================================================


-- ============================================================================
-- Evidence: safe metadata for market_intelligence_sources (BACI/OEC).
-- Corresponds to CHECK 1 (market source row exists + rights flags).
-- ============================================================================
select
  'evidence:market_intelligence_source' as evidence_id,
  provider_id,
  dataset_id,
  source_tier,
  dataset_source,
  distribution_service,
  service_terms_verified,
  storage_allowed,
  redistribution_allowed,
  licence_verified_at is not null as licence_verified_at_present,
  safe_reference,
  retrieved_at
from public.market_intelligence_sources
where provider_id = 'baci_oec'
  and dataset_id = 'baci-hs17';


-- ============================================================================
-- Evidence: fetch ledger entry for the controlled proof scope.
-- Corresponds to CHECK 2 (append-only cache/coverage ledger).
-- ============================================================================
select
  'evidence:market_provider_fetch_ledger' as evidence_id,
  provider_id,
  dataset_id,
  query_fingerprint,
  reporter_country,
  partner_country,
  trade_flow,
  hs_revision,
  hs_codes,
  frequency,
  coverage_start,
  coverage_end,
  outcome,
  rows_received,
  fetched_at,
  fresh_until,
  safe_metadata
from public.market_provider_fetch_ledger
where provider_id = 'baci_oec'
  and dataset_id  = 'baci-hs17'
  and reporter_country = 'MY'
  and trade_flow  = 'import'
  and hs_revision = 'HS17'
  and 'baci_oec' is not null  -- keep as SELECT-only
  and '090421' = any(hs_codes)
order by fetched_at desc
limit 20;


-- ============================================================================
-- Evidence: annual counts of persisted raw bilateral observations for the
-- controlled proof scope (CHECK 3 + CHECK 4).
-- ============================================================================
select
  'evidence:mto_annual_counts' as evidence_id,
  period,
  count(*)             as observations,
  count(distinct partner_country) as distinct_partners,
  sum(trade_value_usd) as total_value_usd_by_year,
  sum(quantity)        as total_quantity_by_year
from public.market_trade_observations
where provider_id = 'baci_oec'
  and dataset_id  = 'baci-hs17'
  and reporter_country = 'MY'
  and trade_flow  = 'import'
  and hs_revision = 'HS17'
  and hs_code     = '090421'
  and frequency   = 'annual'
  and partner_country is not null
group by period
order by period;


-- ============================================================================
-- Evidence: India (IN) bilateral history (CHECK 5).
-- ============================================================================
select
  'evidence:mto_india_history' as evidence_id,
  period,
  partner_country,
  trade_value_usd,
  quantity,
  quantity_unit
from public.market_trade_observations
where provider_id = 'baci_oec'
  and dataset_id  = 'baci-hs17'
  and reporter_country = 'MY'
  and partner_country  = 'IN'
  and trade_flow  = 'import'
  and hs_revision = 'HS17'
  and hs_code     = '090421'
  and frequency   = 'annual'
order by period;


-- ============================================================================
-- Evidence: 2024 origin ranking derived read-only (CHECK 6).
-- ============================================================================
select
  'evidence:mto_2024_top_origins' as evidence_id,
  partner_country,
  trade_value_usd,
  quantity,
  quantity_unit,
  rank() over (order by trade_value_usd desc nulls last) as origin_rank
from public.market_trade_observations
where provider_id = 'baci_oec'
  and dataset_id  = 'baci-hs17'
  and reporter_country = 'MY'
  and trade_flow  = 'import'
  and hs_revision = 'HS17'
  and hs_code     = '090421'
  and frequency   = 'annual'
  and partner_country is not null
  and period      = '2024'
order by trade_value_usd desc nulls last
limit 10;


-- ============================================================================
-- FINAL: rolled-up PASS/FAIL/INFO checks (`check_id`, `status`, `details`).
-- ============================================================================
with
proof_rows as (
  select *
  from public.market_trade_observations
  where provider_id = 'baci_oec'
    and dataset_id  = 'baci-hs17'
    and reporter_country = 'MY'
    and trade_flow  = 'import'
    and hs_revision = 'HS17'
    and hs_code     = '090421'
    and frequency   = 'annual'
),
proof_bilateral as (
  select * from proof_rows where partner_country is not null
),
proof_world_rows as (
  -- If any row exists here, a fake all-partners aggregate was written.
  select * from proof_rows where partner_country is null
),
mi_source as (
  select *
  from public.market_intelligence_sources
  where provider_id = 'baci_oec' and dataset_id = 'baci-hs17'
),
fetch_ledger as (
  select *
  from public.market_provider_fetch_ledger
  where provider_id = 'baci_oec'
    and dataset_id  = 'baci-hs17'
    and reporter_country = 'MY'
    and trade_flow  = 'import'
    and hs_revision = 'HS17'
    and '090421' = any(hs_codes)
    and outcome  = 'success'
),
observations_by_year as (
  select period, count(*) as n from proof_bilateral group by period
),
observed_years as (
  select array_agg(period order by period)::text[] as years from observations_by_year
),
india_2024 as (
  select trade_value_usd
  from proof_bilateral
  where partner_country = 'IN' and period = '2024'
),
world_2024 as (
  select sum(trade_value_usd) as annual_value_usd,
         sum(quantity)        as annual_quantity_tonnes
  from proof_bilateral
  where period = '2024'
),
duplicate_identity as (
  -- Identity contract from migration 0022's unique index
  -- market_trade_observations_identity_uidx: (provider_id, dataset_id,
  -- reporter_country, partner_key, trade_flow, hs_revision, hs_code,
  -- frequency, period). partner_key = coalesce(partner_country, '__WORLD__').
  select
    provider_id, dataset_id, reporter_country,
    coalesce(partner_country, '__WORLD__') as partner_key,
    trade_flow, hs_revision, hs_code, frequency, period,
    count(*) as duplicate_count
  from proof_rows
  group by provider_id, dataset_id, reporter_country,
           coalesce(partner_country, '__WORLD__'),
           trade_flow, hs_revision, hs_code, frequency, period
  having count(*) > 1
),
proxy_hs_090422 as (
  select count(*) as n
  from public.market_trade_observations
  where provider_id = 'baci_oec'
    and reporter_country = 'MY'
    and hs_code = '090422'
),
fabricated_2017 as (
  select count(*) as n
  from proof_rows
  where period = '2017'
),
published_score as (
  select count(*) as n
  from public.market_product_scores
  where country_alpha2 = 'MY'
    and mdf_product_id = 'guntur-dry-red-chilli'
    and superseded_at is null
    and published_fit_score is not null
),
score_components as (
  select count(*) as n
  from public.market_product_score_components c
  join public.market_product_scores s on s.id = c.score_id
  where s.country_alpha2 = 'MY'
    and s.mdf_product_id = 'guntur-dry-red-chilli'
    and s.superseded_at is null
),
buyer_bti_hit as (
  -- Cross-table isolation guard: no buyer_trade_observations should
  -- reference a market_intelligence_sources.id. buyer_trade_observations
  -- has FKs to buyer_intelligence_sources; a shared id would still be
  -- a contract break we want visibility on.
  select count(*) as n
  from public.buyer_trade_observations b
  where b.source_id in (select id from mi_source)
),
buyer_scope_hit as (
  -- Additional narrow guard: any Buyer Intelligence row that names the
  -- controlled proof scope (Malaysia × 090421 × guntur-dry-red-chilli).
  select count(*) as n
  from public.buyer_trade_observations
  where (mdf_product_id  = 'guntur-dry-red-chilli' or hs_code_raw = '090421')
    and (destination_country_code = 'MY' or origin_country_code = 'MY')
),

-- CHECK 1: BACI/OEC market source exists with correct rights flags.
c1 as (
  select
    'CHECK 01 · market_intelligence_source' as check_id,
    case
      when not exists (select 1 from mi_source)
        then 'FAIL'
      when (select service_terms_verified from mi_source) is not true
        then 'FAIL'
      when (select storage_allowed        from mi_source) is not true
        then 'FAIL'
      when (select redistribution_allowed from mi_source) is not false
        then 'FAIL'
      when (select licence_verified_at    from mi_source) is null
        then 'FAIL'
      else 'PASS'
    end as status,
    case
      when not exists (select 1 from mi_source)
        then 'No public.market_intelligence_sources row for provider_id=baci_oec dataset_id=baci-hs17.'
      else
        'provider_id=baci_oec dataset_id=baci-hs17'
        || ' terms=' || coalesce((select service_terms_verified::text from mi_source), 'null')
        || ' storage=' || coalesce((select storage_allowed::text        from mi_source), 'null')
        || ' redistribution=' || coalesce((select redistribution_allowed::text from mi_source), 'null')
        || ' licence_verified_at=' || coalesce((select licence_verified_at::text from mi_source), 'null')
    end as details
),

-- CHECK 2: cache-fresh ledger entry exists for the proof.
c2 as (
  select
    'CHECK 02 · market_provider_fetch_ledger' as check_id,
    case
      when not exists (select 1 from fetch_ledger)
        then 'FAIL'
      when (select coverage_start from fetch_ledger order by fetched_at desc limit 1) <> '2017'
        then 'FAIL'
      when (select coverage_end   from fetch_ledger order by fetched_at desc limit 1) <> '2024'
        then 'FAIL'
      else 'PASS'
    end as status,
    coalesce(
      (
        select
          'rows_received=' || rows_received
          || ' outcome=' || outcome
          || ' coverage=' || coverage_start || '..' || coverage_end
          || ' fetched_at=' || fetched_at::text
          || ' fresh_until=' || fresh_until::text
        from fetch_ledger
        order by fetched_at desc
        limit 1
      ),
      'No successful ledger row for the controlled proof scope.'
    ) as details
),

-- CHECK 3: exactly 204 persisted observations at the controlled scope.
c3 as (
  select
    'CHECK 03 · observation_count_204' as check_id,
    case
      when (select count(*) from proof_bilateral) = 204
       and (select count(*) from proof_world_rows) = 0
        then 'PASS'
      else 'FAIL'
    end as status,
    'bilateral='  || (select count(*) from proof_bilateral)::text
      || ' world_rows=' || (select count(*) from proof_world_rows)::text
      || ' distinct_partners=' || (select count(distinct partner_country) from proof_bilateral)::text
    as details
),

-- CHECK 3.1: shape invariants on every persisted proof row.
c3_shape as (
  select
    'CHECK 03.1 · observation_shape' as check_id,
    case
      when exists (select 1 from proof_bilateral where reporter_country <> 'MY')                  then 'FAIL'
      when exists (select 1 from proof_bilateral where hs_code         <> '090421')               then 'FAIL'
      when exists (select 1 from proof_bilateral where hs_revision     <> 'HS17')                 then 'FAIL'
      when exists (select 1 from proof_bilateral where trade_flow      <> 'import')               then 'FAIL'
      when exists (select 1 from proof_bilateral where partner_country !~ '^[A-Z]{2}$')           then 'FAIL'
      when exists (select 1 from proof_bilateral where period          !~ '^[0-9]{4}$')           then 'FAIL'
      else 'PASS'
    end as status,
    'All proof rows must have reporter=MY hs=090421 HS17 import alpha-2 partner YYYY period.'
    as details
),

-- CHECK 4: period coverage returned is 2018..2024, with 2017 legitimately absent.
c4 as (
  select
    'CHECK 04 · period_coverage_2018_2024' as check_id,
    case
      when (select years from observed_years)
           = array['2018','2019','2020','2021','2022','2023','2024']
        then 'PASS'
      else 'FAIL'
    end as status,
    'observed_years=' || coalesce(
      array_to_string((select years from observed_years), ','),
      '(none)'
    ) as details
),

-- CHECK 4.1: no fabricated 2017 zero-row exists.
c4_no_2017 as (
  select
    'CHECK 04.1 · no_fabricated_2017' as check_id,
    case when (select n from fabricated_2017) = 0 then 'PASS' else 'FAIL' end as status,
    'rows_at_period_2017=' || (select n from fabricated_2017)::text as details
),

-- CHECK 4.2: excluded HS17 090422 is not persisted for the proof scope.
c4_no_090422 as (
  select
    'CHECK 04.2 · no_090422_in_scope' as check_id,
    case when (select n from proxy_hs_090422) = 0 then 'PASS' else 'FAIL' end as status,
    'rows_at_hs_090422=' || (select n from proxy_hs_090422)::text as details
),

-- CHECK 5: India bilateral history is present across the returned years.
c5 as (
  select
    'CHECK 05 · india_history_present' as check_id,
    case
      when (
        select count(distinct period)
        from proof_bilateral
        where partner_country = 'IN'
      ) >= 6 then 'PASS'
      else 'FAIL'
    end as status,
    'india_years='
    || coalesce(
      (
        select string_agg(period, ',' order by period)
        from proof_bilateral
        where partner_country = 'IN'
      ), '(none)'
    ) as details
),

-- CHECK 6: 2024 top origins ranking (informational, plus explicit CN/IN presence).
c6 as (
  select
    'CHECK 06 · top_origins_2024' as check_id,
    case
      when exists (
        select 1 from proof_bilateral where period = '2024' and partner_country = 'CN'
      ) and exists (
        select 1 from proof_bilateral where period = '2024' and partner_country = 'IN'
      )
        then 'INFO'
      else 'FAIL'
    end as status,
    'top1='
    || coalesce(
      (
        select partner_country
        from proof_bilateral
        where period = '2024'
        order by trade_value_usd desc nulls last
        limit 1
      ), '(none)'
    )
    || ' top2='
    || coalesce(
      (
        select partner_country
        from proof_bilateral
        where period = '2024'
        order by trade_value_usd desc nulls last
        offset 1 limit 1
      ), '(none)'
    ) as details
),

-- CHECK 7: derived 2024 world total (bilateral sum only; NOT persisted).
c7 as (
  select
    'CHECK 07 · derived_world_2024' as check_id,
    'INFO' as status,
    'annual_value_usd=' || coalesce((select annual_value_usd::text from world_2024), 'null')
    || ' annual_quantity_tonnes=' || coalesce((select annual_quantity_tonnes::text from world_2024), 'null')
    || ' expected≈117349258 USD, ≈48753.344 tonnes'
    as details
),

-- CHECK 8: India 2024 value + India-share of 2024 total (bilateral sum only).
c8 as (
  select
    'CHECK 08 · derived_india_share_2024' as check_id,
    'INFO' as status,
    'india_value=' || coalesce((select trade_value_usd::text from india_2024), 'null')
    || ' india_share=' ||
      coalesce(
        (
          select
            case when (select annual_value_usd from world_2024) > 0
              then ((select trade_value_usd from india_2024) / (select annual_value_usd from world_2024))::text
              else 'null'
            end
        ), 'null'
      )
    || ' expected≈50939611 USD, share≈0.4340855'
    as details
),

-- CHECK 9: no duplicate identity per the immutable unique-index contract.
c9 as (
  select
    'CHECK 09 · no_duplicate_identity' as check_id,
    case when (select count(*) from duplicate_identity) = 0 then 'PASS' else 'FAIL' end as status,
    'duplicate_identities=' || (select count(*) from duplicate_identity)::text as details
),

-- CHECK 10: no Market Fit publication for this scope.
c10 as (
  select
    'CHECK 10 · no_market_fit_publication' as check_id,
    case
      when (select n from published_score) = 0
       and (select n from score_components) = 0
        then 'PASS'
      else 'FAIL'
    end as status,
    'published_current_scores=' || (select n from published_score)::text
    || ' score_components=' || (select n from score_components)::text
    as details
),

-- CHECK 11: no Buyer Intelligence contamination.
c11 as (
  select
    'CHECK 11 · no_buyer_contamination' as check_id,
    case
      when (select n from buyer_bti_hit) = 0
       and (select n from buyer_scope_hit) = 0
        then 'PASS'
      else 'FAIL'
    end as status,
    'buyer_bti_referencing_mi_source=' || (select n from buyer_bti_hit)::text
    || ' buyer_bti_in_proof_scope=' || (select n from buyer_scope_hit)::text
    as details
)

select check_id, status, details from c1
union all select check_id, status, details from c2
union all select check_id, status, details from c3
union all select check_id, status, details from c3_shape
union all select check_id, status, details from c4
union all select check_id, status, details from c4_no_2017
union all select check_id, status, details from c4_no_090422
union all select check_id, status, details from c5
union all select check_id, status, details from c6
union all select check_id, status, details from c7
union all select check_id, status, details from c8
union all select check_id, status, details from c9
union all select check_id, status, details from c10
union all select check_id, status, details from c11
order by check_id;
