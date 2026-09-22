-- ============================================================================
-- MI1F.5 — READ-ONLY FULL CALIBRATION-COHORT VERIFICATION
-- BACI/OEC × HS17 090421 × annual bilateral imports × 2018–2024
-- Reporters: MY AE SA QA OM KW SG TH VN LK KR JP GB DE NL US CA AU
--
-- SAFETY CONTRACT
--   * Every executable statement starts with SELECT or WITH.
--   * No RPC, DML, DDL, provider request, or cohort endpoint is used.
--   * Provider-unavailable reporters remain terminally resolved by the runtime
--     contract; this proof verifies the presently persisted 18-country cohort.
--
-- Run each result set in order. The final result set rolls the proof up to
-- (check_id, status, details); any FAIL requires investigation.
-- ============================================================================

-- Evidence 1: the single safe BACI/OEC market source and its rights flags.
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

-- Evidence 2: one row per expected reporter, including observed periods and
-- the absence/presence of forbidden world rows.
with expected_reporters(reporter_country, ordinal) as (
  values
    ('MY', 1), ('AE', 2), ('SA', 3), ('QA', 4), ('OM', 5), ('KW', 6),
    ('SG', 7), ('TH', 8), ('VN', 9), ('LK', 10), ('KR', 11), ('JP', 12),
    ('GB', 13), ('DE', 14), ('NL', 15), ('US', 16), ('CA', 17), ('AU', 18)
), controlled_rows as (
  select o.*
  from public.market_trade_observations o
  where o.provider_id = 'baci_oec'
    and o.dataset_id = 'baci-hs17'
    and o.trade_flow = 'import'
    and o.hs_revision = 'HS17'
    and o.hs_code = '090421'
    and o.frequency = 'annual'
    and o.reporter_country in (select reporter_country from expected_reporters)
)
select
  'evidence:country_observation_counts' as evidence_id,
  e.ordinal,
  e.reporter_country,
  count(r.id) filter (where r.partner_country is not null) as bilateral_rows,
  count(distinct r.partner_country) filter (where r.partner_country is not null) as distinct_partners,
  count(r.id) filter (where r.partner_country is null) as world_rows,
  coalesce(
    array_agg(distinct r.period order by r.period) filter (where r.period is not null),
    array[]::text[]
  ) as observed_periods
from expected_reporters e
left join controlled_rows r on r.reporter_country = e.reporter_country
group by e.ordinal, e.reporter_country
order by e.ordinal;

-- Evidence 3: the authoritative reusable ledger chosen using the runtime's
-- exact/compatible cache rules. The latest row per fingerprint must itself be
-- successful/empty and fresh; older successes cannot hide a later failure.
with expected_reporters(reporter_country, ordinal) as (
  values
    ('MY', 1), ('AE', 2), ('SA', 3), ('QA', 4), ('OM', 5), ('KW', 6),
    ('SG', 7), ('TH', 8), ('VN', 9), ('LK', 10), ('KR', 11), ('JP', 12),
    ('GB', 13), ('DE', 14), ('NL', 15), ('US', 16), ('CA', 17), ('AU', 18)
), reporter_recent as (
  select
    l.*,
    row_number() over (
      partition by l.reporter_country
      order by l.fetched_at desc, l.created_at desc, l.id desc
    ) as reporter_recency
  from public.market_provider_fetch_ledger l
  where l.provider_id = 'baci_oec'
    and l.dataset_id = 'baci-hs17'
    and l.reporter_country in (select reporter_country from expected_reporters)
), latest_per_fingerprint as (
  select
    l.*,
    row_number() over (
      partition by l.reporter_country, l.query_fingerprint
      order by l.fetched_at desc, l.created_at desc, l.id desc
    ) as fingerprint_recency
  from reporter_recent l
  where (
      l.reporter_recency <= 25
      or l.query_fingerprint =
        'mi-query-v1|baci_oec|baci-hs17|' || l.reporter_country
        || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
    )
    and l.partner_country is null
    and l.trade_flow = 'import'
    and l.hs_revision = 'HS17'
    and cardinality(l.hs_codes) = 1
    and l.hs_codes[1] = '090421'
    and l.frequency = 'annual'
), reusable_candidates as (
  select l.*
  from latest_per_fingerprint l
  where l.fingerprint_recency = 1
    and l.outcome in ('success', 'empty')
    and l.fresh_until > now()
    and case when l.coverage_start ~ '^\d{4}$' then l.coverage_start::integer end <= 2018
    and case when l.coverage_end ~ '^\d{4}$' then l.coverage_end::integer end >= 2024
    and not exists (
      select 1
      from latest_per_fingerprint exact_block
      where exact_block.reporter_country = l.reporter_country
        and exact_block.query_fingerprint =
          'mi-query-v1|baci_oec|baci-hs17|' || l.reporter_country
          || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
        and exact_block.fresh_until > now()
        and exact_block.outcome not in ('success', 'empty')
    )
), ranked_reusable as (
  select
    r.*,
    row_number() over (
      partition by r.reporter_country
      order by
        case when r.query_fingerprint =
          'mi-query-v1|baci_oec|baci-hs17|' || r.reporter_country
          || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
          then 0 else 1 end,
        r.fetched_at desc,
        r.created_at desc,
        r.id desc
    ) as reporter_rank
  from reusable_candidates r
), authoritative_ledger as (
  select * from ranked_reusable where reporter_rank = 1
), observation_counts as (
  select o.reporter_country, count(*)::bigint as persisted_rows
  from public.market_trade_observations o
  where o.provider_id = 'baci_oec'
    and o.dataset_id = 'baci-hs17'
    and o.trade_flow = 'import'
    and o.hs_revision = 'HS17'
    and o.hs_code = '090421'
    and o.frequency = 'annual'
    and o.partner_country is not null
    and o.reporter_country in (select reporter_country from expected_reporters)
  group by o.reporter_country
)
select
  'evidence:authoritative_reusable_ledger' as evidence_id,
  e.ordinal,
  e.reporter_country,
  case
    when a.query_fingerprint =
      'mi-query-v1|baci_oec|baci-hs17|' || e.reporter_country
      || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
      then 'exact'
    when a.id is not null then 'compatible'
  end as reuse_class,
  a.query_fingerprint,
  a.outcome,
  a.rows_received,
  coalesce(o.persisted_rows, 0) as persisted_rows,
  a.coverage_start,
  a.coverage_end,
  a.fetched_at,
  a.fresh_until,
  case
    when a.id is null then 'FAIL: no reusable ledger'
    when a.rows_received <> coalesce(o.persisted_rows, 0) then 'FAIL: ledger/observation mismatch'
    else 'PASS'
  end as consistency_status
from expected_reporters e
left join authoritative_ledger a on a.reporter_country = e.reporter_country
left join observation_counts o on o.reporter_country = e.reporter_country
order by e.ordinal;

-- Evidence 4: period-by-period persisted coverage for operator inspection.
with expected_reporters(reporter_country, ordinal) as (
  values
    ('MY', 1), ('AE', 2), ('SA', 3), ('QA', 4), ('OM', 5), ('KW', 6),
    ('SG', 7), ('TH', 8), ('VN', 9), ('LK', 10), ('KR', 11), ('JP', 12),
    ('GB', 13), ('DE', 14), ('NL', 15), ('US', 16), ('CA', 17), ('AU', 18)
)
select
  'evidence:country_period_coverage' as evidence_id,
  e.ordinal,
  e.reporter_country,
  o.period,
  count(o.id) as bilateral_rows,
  count(distinct o.partner_country) as distinct_partners
from expected_reporters e
left join public.market_trade_observations o
  on o.reporter_country = e.reporter_country
 and o.provider_id = 'baci_oec'
 and o.dataset_id = 'baci-hs17'
 and o.partner_country is not null
 and o.trade_flow = 'import'
 and o.hs_revision = 'HS17'
 and o.hs_code = '090421'
 and o.frequency = 'annual'
group by e.ordinal, e.reporter_country, o.period
order by e.ordinal, o.period;

-- FINAL: rolled-up PASS/FAIL verification.
with expected_reporters(reporter_country, ordinal) as (
  values
    ('MY', 1), ('AE', 2), ('SA', 3), ('QA', 4), ('OM', 5), ('KW', 6),
    ('SG', 7), ('TH', 8), ('VN', 9), ('LK', 10), ('KR', 11), ('JP', 12),
    ('GB', 13), ('DE', 14), ('NL', 15), ('US', 16), ('CA', 17), ('AU', 18)
), controlled_rows as (
  select o.*
  from public.market_trade_observations o
  where o.provider_id = 'baci_oec'
    and o.dataset_id = 'baci-hs17'
    and o.trade_flow = 'import'
    and o.hs_revision = 'HS17'
    and o.hs_code = '090421'
    and o.frequency = 'annual'
    and o.reporter_country in (select reporter_country from expected_reporters)
), bilateral_rows as (
  select * from controlled_rows where partner_country is not null
), country_counts as (
  select e.reporter_country, count(b.id)::bigint as persisted_rows
  from expected_reporters e
  left join bilateral_rows b on b.reporter_country = e.reporter_country
  group by e.reporter_country
), reporter_recent as (
  select
    l.*,
    row_number() over (
      partition by l.reporter_country
      order by l.fetched_at desc, l.created_at desc, l.id desc
    ) as reporter_recency
  from public.market_provider_fetch_ledger l
  where l.provider_id = 'baci_oec'
    and l.dataset_id = 'baci-hs17'
    and l.reporter_country in (select reporter_country from expected_reporters)
), latest_per_fingerprint as (
  select
    l.*,
    row_number() over (
      partition by l.reporter_country, l.query_fingerprint
      order by l.fetched_at desc, l.created_at desc, l.id desc
    ) as fingerprint_recency
  from reporter_recent l
  where (
      l.reporter_recency <= 25
      or l.query_fingerprint =
        'mi-query-v1|baci_oec|baci-hs17|' || l.reporter_country
        || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
    )
    and l.partner_country is null
    and l.trade_flow = 'import'
    and l.hs_revision = 'HS17'
    and cardinality(l.hs_codes) = 1
    and l.hs_codes[1] = '090421'
    and l.frequency = 'annual'
), reusable_candidates as (
  select l.*
  from latest_per_fingerprint l
  where l.fingerprint_recency = 1
    and l.outcome in ('success', 'empty')
    and l.fresh_until > now()
    and case when l.coverage_start ~ '^\d{4}$' then l.coverage_start::integer end <= 2018
    and case when l.coverage_end ~ '^\d{4}$' then l.coverage_end::integer end >= 2024
    and not exists (
      select 1
      from latest_per_fingerprint exact_block
      where exact_block.reporter_country = l.reporter_country
        and exact_block.query_fingerprint =
          'mi-query-v1|baci_oec|baci-hs17|' || l.reporter_country
          || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
        and exact_block.fresh_until > now()
        and exact_block.outcome not in ('success', 'empty')
    )
), ranked_reusable as (
  select
    r.*,
    row_number() over (
      partition by r.reporter_country
      order by
        case when r.query_fingerprint =
          'mi-query-v1|baci_oec|baci-hs17|' || r.reporter_country
          || '|*|import|HS17|090421|annual|2018|2024|mi-select-v2'
          then 0 else 1 end,
        r.fetched_at desc,
        r.created_at desc,
        r.id desc
    ) as reporter_rank
  from reusable_candidates r
), authoritative_ledger as (
  select * from ranked_reusable where reporter_rank = 1
), duplicate_identities as (
  select
    provider_id,
    dataset_id,
    reporter_country,
    coalesce(partner_country, '__WORLD__') as partner_key,
    trade_flow,
    hs_revision,
    hs_code,
    frequency,
    period,
    count(*) as copies
  from public.market_trade_observations
  where provider_id = 'baci_oec'
    and dataset_id = 'baci-hs17'
    and reporter_country in (select reporter_country from expected_reporters)
  group by
    provider_id, dataset_id, reporter_country,
    coalesce(partner_country, '__WORLD__'),
    trade_flow, hs_revision, hs_code, frequency, period
  having count(*) > 1
), source_stats as (
  select
    count(*) as source_count,
    bool_and(service_terms_verified) as terms_verified,
    bool_and(storage_allowed) as storage_allowed,
    bool_and(not redistribution_allowed) as redistribution_disallowed,
    bool_and(licence_verified_at is not null) as licence_verified
  from public.market_intelligence_sources
  where provider_id = 'baci_oec' and dataset_id = 'baci-hs17'
), reporter_stats as (
  select
    count(*) filter (where persisted_rows > 0) as present_count,
    sum(persisted_rows) as total_rows
  from country_counts
), ledger_stats as (
  select
    count(*) as reusable_count,
    count(*) filter (where outcome = 'success') as success_count,
    count(*) filter (where fresh_until > now()) as fresh_count
  from authoritative_ledger
), consistency_stats as (
  select
    count(*) filter (
      where a.id is not null
        and a.rows_received = c.persisted_rows
        and (
          (a.outcome = 'success' and c.persisted_rows > 0)
          or (a.outcome = 'empty' and c.persisted_rows = 0)
        )
    ) as consistent_count
  from country_counts c
  left join authoritative_ledger a on a.reporter_country = c.reporter_country
), invalid_shape as (
  select count(*) as n
  from public.market_trade_observations o
  where o.provider_id = 'baci_oec'
    and o.dataset_id = 'baci-hs17'
    and o.reporter_country in (select reporter_country from expected_reporters)
    and (
      o.trade_flow <> 'import'
      or o.hs_revision <> 'HS17'
      or o.hs_code <> '090421'
      or o.frequency <> 'annual'
    )
), invalid_period as (
  select count(*) as n
  from controlled_rows
  where period not in ('2018', '2019', '2020', '2021', '2022', '2023', '2024')
), unexpected_reporter as (
  select count(*) as n
  from public.market_trade_observations o
  where o.provider_id = 'baci_oec'
    and o.dataset_id = 'baci-hs17'
    and o.trade_flow = 'import'
    and o.hs_revision = 'HS17'
    and o.hs_code = '090421'
    and o.frequency = 'annual'
    and o.reporter_country not in (select reporter_country from expected_reporters)
), invalid_country_code as (
  select count(*) as n
  from controlled_rows
  where reporter_country !~ '^[A-Z]{2}$'
     or (partner_country is not null and partner_country !~ '^[A-Z]{2}$')
), world_rows as (
  select count(*) as n from controlled_rows where partner_country is null
), proxy_rows as (
  select count(*) as n
  from public.market_trade_observations
  where provider_id = 'baci_oec'
    and dataset_id = 'baci-hs17'
    and reporter_country in (select reporter_country from expected_reporters)
    and hs_code = '090422'
), published_scores as (
  select count(*) as n
  from public.market_product_scores
  where country_alpha2 in (select reporter_country from expected_reporters)
    and mdf_product_id = 'guntur-dry-red-chilli'
    and published_fit_score is not null
), published_components as (
  select count(*) as n
  from public.market_product_score_components c
  join public.market_product_scores s on s.id = c.score_id
  where s.country_alpha2 in (select reporter_country from expected_reporters)
    and s.mdf_product_id = 'guntur-dry-red-chilli'
    and s.published_fit_score is not null
), buyer_baci_sources as (
  select count(*) as n
  from public.buyer_intelligence_sources
  where provider_id = 'baci_oec'
), buyer_baci_rows as (
  select count(*) as n
  from public.buyer_trade_observations b
  join public.buyer_intelligence_sources s on s.id = b.source_id
  where s.provider_id = 'baci_oec'
), buyer_scope_rows as (
  select count(*) as n
  from public.buyer_trade_observations
  where (mdf_product_id = 'guntur-dry-red-chilli' or hs_code_raw in ('090421', '090422'))
    and (
      destination_country_code in (select reporter_country from expected_reporters)
      or origin_country_code in (select reporter_country from expected_reporters)
    )
), cross_domain_source_ids as (
  select count(*) as n
  from public.buyer_trade_observations
  where source_id in (
    select id from public.market_intelligence_sources
    where provider_id = 'baci_oec' and dataset_id = 'baci-hs17'
  )
), checks(check_id, status, details) as (
  select
    'market_source_rights',
    case when source_count = 1
                   and terms_verified is true
                   and storage_allowed is true
                   and redistribution_disallowed is true
                   and licence_verified is true then 'PASS' else 'FAIL' end,
    'source_count=' || source_count
      || ' terms=' || coalesce(terms_verified::text, 'null')
      || ' storage=' || coalesce(storage_allowed::text, 'null')
      || ' redistribution_disallowed=' || coalesce(redistribution_disallowed::text, 'null')
      || ' licence_verified=' || coalesce(licence_verified::text, 'null')
  from source_stats

  union all
  select
    'all_18_reporters_present',
    case when present_count = 18 then 'PASS' else 'FAIL' end,
    'reporters_with_bilateral_rows=' || present_count || '/18 total_rows=' || coalesce(total_rows, 0)
  from reporter_stats

  union all
  select
    'all_reporters_have_reusable_success',
    case when reusable_count = 18 and success_count = 18 and fresh_count = 18 then 'PASS' else 'FAIL' end,
    'reusable=' || reusable_count || '/18 success=' || success_count || '/18 fresh=' || fresh_count || '/18'
  from ledger_stats

  union all
  select
    'observation_ledger_consistency',
    case when consistent_count = 18 then 'PASS' else 'FAIL' end,
    'consistent_country_ledgers=' || consistent_count || '/18'
  from consistency_stats

  union all
  select
    'controlled_observation_shape',
    case when n = 0 then 'PASS' else 'FAIL' end,
    'unexpected_shape_rows=' || n
  from invalid_shape

  union all
  select
    'periods_within_2018_2024',
    case when n = 0 then 'PASS' else 'FAIL' end,
    'out_of_window_rows=' || n
  from invalid_period

  union all
  select
    'no_unexpected_reporters',
    case when n = 0 then 'PASS' else 'FAIL' end,
    'unexpected_reporter_rows=' || n
  from unexpected_reporter

  union all
  select
    'no_duplicate_observation_identity',
    case when not exists (select 1 from duplicate_identities) then 'PASS' else 'FAIL' end,
    'duplicate_identity_groups=' || (select count(*) from duplicate_identities)

  union all
  select
    'canonical_country_codes',
    case when n = 0 then 'PASS' else 'FAIL' end,
    'noncanonical_country_code_rows=' || n
  from invalid_country_code

  union all
  select
    'no_world_rows',
    case when n = 0 then 'PASS' else 'FAIL' end,
    'world_rows=' || n
  from world_rows

  union all
  select
    'no_090422_contamination',
    case when n = 0 then 'PASS' else 'FAIL' end,
    'hs_090422_rows=' || n
  from proxy_rows

  union all
  select
    'no_market_fit_publication',
    case when p.n = 0 and c.n = 0 then 'PASS' else 'FAIL' end,
    'published_scores=' || p.n || ' published_score_components=' || c.n
  from published_scores p cross join published_components c

  union all
  select
    'no_buyer_intelligence_contamination',
    case when s.n = 0 and b.n = 0 and q.n = 0 and x.n = 0 then 'PASS' else 'FAIL' end,
    'baci_buyer_sources=' || s.n
      || ' baci_buyer_rows=' || b.n
      || ' equivalent_scope_rows=' || q.n
      || ' cross_domain_source_ids=' || x.n
  from buyer_baci_sources s
  cross join buyer_baci_rows b
  cross join buyer_scope_rows q
  cross join cross_domain_source_ids x
)
select check_id, status, details
from checks
order by check_id;
