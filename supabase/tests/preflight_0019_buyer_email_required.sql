-- READ-ONLY operator preflight for migration 0019.
-- Run manually before applying 0019. This file performs SELECTs only.

with conversion_counts as (
  select source_kind, count(*)::bigint as row_count
  from public.buyer_finder_candidate_conversions
  group by source_kind
), report as (
  select
    'conversion_total'::text as metric,
    null::text as source_kind,
    count(*)::bigint as row_count
  from public.buyer_finder_candidate_conversions

  union all

  select
    'conversion_by_source_kind',
    source_kind,
    row_count
  from conversion_counts

  union all

  select
    'historical_company_only',
    'company_only',
    count(*)::bigint
  from public.buyer_finder_candidate_conversions
  where source_kind = 'company_only'

  union all

  select
    'buyers_blank_or_whitespace_email',
    null,
    count(*)::bigint
  from public.buyers
  where btrim(email) = ''
)
select metric, source_kind, row_count
from report
order by metric, source_kind nulls first;
